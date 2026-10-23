// Trip Twin relay test kit (Phase CF K1; cf/06-qa.md QA-2): fake sockets,
// a fake HTTP upgrade, a session host on a fake clock, and a small script
// runner for multi-device sequences. Tests only: no network, no Vite, no
// files. Lives in src/ so the shared `npm test` runner finds the tests that
// use it (PHASE-CF-PLAN S-3).
import { EventEmitter } from 'node:events';
import { createSessionHost } from './twinSessionHost.js';

/**
 * A WebSocket stand-in for createRelay().attach: records what the relay
 * sends (`out`), says a message as the client (`say`), finds the last
 * message of a type (`last`, `all`) and closes like a real socket.
 */
export function fakeSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.out = [];
  ws.send = (s) => ws.out.push(JSON.parse(s));
  ws.say = (m) => ws.emit('message', JSON.stringify(m));
  ws.last = (t) => [...ws.out].reverse().find((m) => m.t === t);
  ws.all = (t) => ws.out.filter((m) => m.t === t);
  ws.close = () => {
    if (ws.readyState === 3) return;
    ws.readyState = 3;
    ws.emit('close');
  };
  return ws;
}

/**
 * The (req, socket, head) an HTTP server hands its 'upgrade' listeners.
 * The socket is just real enough for `ws` to complete a handshake, so a
 * test can tell an accepted upgrade (a 101 written) from a refused one
 * (destroyed with nothing written).
 */
export function fakeUpgrade({
  host = 'localhost:4173',
  origin = 'http://localhost:4173',
  remoteAddress = '127.0.0.1',
  url = '/api/twin-sync',
} = {}) {
  const headers = {
    host,
    upgrade: 'websocket',
    connection: 'Upgrade',
    'sec-websocket-version': '13',
    // A fixed, valid key (16 bytes, base64): deterministic on purpose.
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
  };
  if (origin != null) headers.origin = origin;
  const socket = new EventEmitter();
  socket.remoteAddress = remoteAddress;
  socket.readable = true;
  socket.writable = true;
  socket.destroyed = false;
  socket.written = []; // the handshake (a string), then frames
  socket.write = (chunk, cb) => {
    socket.written.push(chunk);
    if (typeof cb === 'function') cb();
    return true;
  };
  socket.cork = () => {};
  socket.uncork = () => {};
  socket.destroy = () => {
    socket.destroyed = true;
    socket.readable = false;
    socket.writable = false;
  };
  socket.end = socket.destroy;
  socket.setTimeout = () => socket;
  socket.setNoDelay = () => socket;
  socket.unshift = () => {};
  socket.pause = () => socket;
  socket.resume = () => socket;
  const req = { method: 'GET', url, headers, socket };
  return {
    req,
    socket,
    head: Buffer.alloc(0),
    /** 'accepted' (101 written), 'refused' (destroyed, nothing written). */
    get verdict() {
      if (
        socket.written.some(
          (w) => typeof w === 'string' && w.startsWith('HTTP/1.1 101'),
        )
      )
        return 'accepted';
      if (socket.destroyed && !socket.written.length) return 'refused';
      return socket.written.length ? 'error' : 'untouched';
    },
  };
}

/** One masked client → server text frame (what a browser sends). */
export function clientFrame(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  if (body.length > 65535) throw new Error('clientFrame: message too long');
  const mask = Buffer.from([1, 2, 3, 4]);
  const head =
    body.length < 126
      ? Buffer.from([0x81, 0x80 | body.length])
      : Buffer.from([0x81, 0x80 | 126, body.length >> 8, body.length & 255]);
  const masked = Buffer.from(body.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([head, mask, masked]);
}

/** The JSON text frames a server wrote to a fakeUpgrade socket. */
export function serverFrames(written) {
  // ws writes a frame head as a Buffer and may write its text as a string;
  // only the handshake itself is skipped.
  const buf = Buffer.concat(
    written
      .filter((w) => !(typeof w === 'string' && w.startsWith('HTTP/1.1 ')))
      .map((w) => Buffer.from(w)),
  );
  const out = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const op = buf[i] & 15;
    let len = buf[i + 1] & 127;
    let at = i + 2;
    if (len === 126) {
      len = buf.readUInt16BE(at);
      at += 2;
    } else if (len === 127) {
      len = Number(buf.readBigUInt64BE(at));
      at += 8;
    }
    if (op === 1) out.push(JSON.parse(buf.subarray(at, at + len).toString()));
    i = at + len;
  }
  return out;
}

/**
 * A session host on a fake clock with a seeded random (moved here from
 * twinSession.test.mjs; same defaults, so the same codes and tokens).
 */
export function clockHost({ start = 1_000_000, seed = 0.123, count = 4 } = {}) {
  let t = start;
  let s = seed;
  const host = createSessionHost({
    now: () => t,
    random: () => {
      s = (s * 9301 + 0.49297) % 1;
      return s;
    },
  });
  const setup = host.setup({ count }).setup;
  return { host, tick: (ms) => (t += ms), now: () => t, setup };
}

/**
 * Run a multi-device sequence against a relay. Each step is
 * `{as, say?, close?, local?}` or a function of the sockets so far that
 * returns one (or nothing). `say` may also be a function of the sockets,
 * so a step can use what an earlier one received (a setup token, a code).
 * A socket is attached the first time its name appears; `local: false`
 * attaches it as a LAN device. Returns the sockets by name.
 */
export function script(relay, steps) {
  const socks = {};
  const sock = (name, local) => {
    if (!socks[name]) {
      socks[name] = fakeSocket();
      relay.attach(socks[name], { isLocal: local !== false });
    }
    return socks[name];
  };
  for (const raw of steps) {
    const step = typeof raw === 'function' ? raw(socks) : raw;
    if (!step) continue;
    const ws = sock(step.as, step.local);
    if (step.say)
      ws.say(typeof step.say === 'function' ? step.say(socks) : step.say);
    if (step.close) ws.close();
  }
  return socks;
}

/** The setup token a launcher socket was given (script helper). */
export const setupOf = (ws) => ws?.last('setup')?.setup;
