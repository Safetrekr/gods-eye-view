// Trip Twin relay test kit (Phase CF K1; cf/06-qa.md QA-2): fake sockets,
// a fake HTTP upgrade, a session host on a fake clock, and a small script
// runner for multi-device sequences. Tests only: no network, no Vite, no
// files. Lives in src/ so the shared `npm test` runner finds the tests that
// use it (PHASE-CF-PLAN S-3). K3 adds a tiny connect-style middleware stack
// and a live loopback server for real `ws` and HTTP tests (SEC-15).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createSessionHost } from './twinSessionHost.js';

/**
 * Tests never write to the live ~/Library/Logs/trip-twin/ (K3): if no test
 * chose TRIP_TWIN_AUDIT_DIR, a throwaway folder is set before any relay or
 * proxy plugin is built through the kit.
 */
export function scratchAuditDir() {
  if (!process.env.TRIP_TWIN_AUDIT_DIR) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-audit-test-'));
    process.env.TRIP_TWIN_AUDIT_DIR = dir;
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return process.env.TRIP_TWIN_AUDIT_DIR;
}

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
  ws.close = (code = 1000) => {
    if (ws.readyState === 3) return;
    ws.readyState = 3;
    ws.closeCode = code; // K4: 4002 (second hello), 4003 (replaced)
    ws.emit('close', code);
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
  encrypted = false,
  localPort = undefined,
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
  if (encrypted) socket.encrypted = true;
  if (localPort) socket.localPort = localPort;
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

/**
 * The relay's Vite plugin on a fake dev server (Phase CF K2): a real
 * configureServer, so the store opens as it does under Vite. `root` is
 * Vite's root (fenced by the store); `logs` collects the relay's log lines.
 * `hello(msg)` upgrades, says one message and resolves the first reply.
 */
export function fakeViteRelay(
  plugin,
  { root = '/nonexistent-vite-root' } = {},
) {
  scratchAuditDir();
  const httpServer = new EventEmitter();
  httpServer.address = () => ({ port: 4173 });
  const logs = [];
  const logger = {
    info: (m) => logs.push(m),
    warn: (m) => logs.push(m),
    error: (m) => logs.push(m),
  };
  const server = {
    httpServer,
    middlewares: { use() {} },
    config: { server: { host: 'localhost' }, root, logger },
  };
  plugin.configureServer(server);
  const upgrade = (opts) => {
    const u = fakeUpgrade(opts);
    httpServer.emit('upgrade', u.req, u.socket, u.head);
    return u;
  };
  return {
    logs,
    upgrade,
    /** Say each message on one new socket; resolve every frame it got. */
    async talk(msgs, opts = {}) {
      const u = upgrade(opts);
      for (const m of [].concat(msgs)) u.socket.emit('data', clientFrame(m));
      await new Promise((r) => setTimeout(r, 20));
      return serverFrames(u.socket.written);
    },
    async hello(msg, opts) {
      const frames = await this.talk(msg, opts);
      return frames.find((m) => m.t === 'welcome' || m.t === 'setup');
    },
    // Stops the 5 s presence tick and flushes the store, as Vite's close.
    close: () => httpServer.emit('close'),
  };
}

/**
 * A connect-style middleware stack, as Vite's `server.middlewares`: a
 * route matches case-insensitively when the next character is `/`, `.` or
 * the end; the route is cut from `req.url`, `req.originalUrl` keeps it.
 */
export function miniConnect() {
  const stack = [];
  const app = {
    use(route, fn) {
      if (typeof route === 'function') [route, fn] = ['', route];
      stack.push({ route: String(route).replace(/\/$/, ''), fn });
      return app;
    },
    handle(req, res) {
      const full = req.url;
      req.originalUrl = req.originalUrl || full;
      let i = 0;
      const next = (err) => {
        req.url = full;
        const layer = stack[i++];
        if (!layer) {
          res.statusCode = err ? 500 : 404;
          return res.end(err ? 'error' : 'not found');
        }
        const p = full.split('?')[0];
        const r = layer.route;
        if (r) {
          if (p.toLowerCase().slice(0, r.length) !== r.toLowerCase())
            return next(err);
          const c = p[r.length];
          if (c && c !== '/' && c !== '.') return next(err);
          const rest = full.slice(r.length);
          req.url = rest.startsWith('/') ? rest : `/${rest}`;
        }
        try {
          layer.fn(req, res, next);
        } catch (e) {
          next(e);
        }
      };
      next();
    },
  };
  return app;
}

/**
 * Trip Twin plugins on a real loopback HTTP server (no Vite): their
 * configureServer runs against a fake dev server whose middlewares are
 * miniConnect() and whose httpServer is real, so real `ws` clients and
 * HTTP requests reach the real handlers. `before(server)` runs first (to
 * inject a host check). Resolves {port, url, logs, request, close}.
 */
export async function liveTwinServer({
  plugins = [],
  root = '/nonexistent-vite-root',
  host = '0.0.0.0',
  before = () => {},
} = {}) {
  scratchAuditDir();
  const app = miniConnect();
  const httpServer = http.createServer((req, res) => app.handle(req, res));
  const logs = [];
  const logger = {
    info: (m) => logs.push(m),
    warn: (m) => logs.push(m),
    error: (m) => logs.push(m),
  };
  const server = {
    httpServer,
    middlewares: app,
    config: { server: { host }, root, logger },
  };
  before(server);
  for (const p of plugins) p.configureServer(server);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const { port } = httpServer.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    logs,
    server,
    /** One HTTP request with any headers (Host included); resolves {status, headers, body}. */
    request(pathname, { method = 'GET', headers = {}, body } = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: pathname, method, headers },
          (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (d) => (text += d));
            res.on('end', () => {
              let json = null;
              try {
                json = JSON.parse(text);
              } catch {
                json = null;
              }
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: text,
                json,
              });
            });
          },
        );
        req.on('error', reject);
        if (body != null) req.write(body);
        req.end();
      });
    },
    close: () =>
      new Promise((r) => {
        httpServer.closeAllConnections?.();
        httpServer.close(() => r());
      }),
  };
}

// ---- A browser for twinSync.js (Phase CF K4) ---------------------------

/** A Storage stand-in (getItem, setItem, removeItem) over a Map. */
export function memStorage(from = null) {
  const m = new Map(from ? from.entries() : []);
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    entries: () => m.entries(),
  };
}

/**
 * Web Locks as one browser profile sees them (per origin): `ifAvailable`
 * gives null when held; `steal` takes a held lock and rejects the old
 * holder's request with an AbortError, as the spec says.
 */
export function fakeLocks() {
  const held = new Map(); // name → {reject}
  return {
    held,
    request(name, opts, cb) {
      const cur = held.get(name);
      if (cur && opts?.ifAvailable) return Promise.resolve(cb(null));
      if (cur && !opts?.steal)
        return Promise.reject(new Error('fakeLocks: queueing not modelled'));
      if (cur) {
        held.delete(name);
        const e = new Error('stolen');
        e.name = 'AbortError';
        cur.reject(e);
      }
      return new Promise((resolve, reject) => {
        const entry = { reject };
        held.set(name, entry);
        Promise.resolve(cb({ name })).then(
          (v) => {
            if (held.get(name) === entry) held.delete(name);
            resolve(v);
          },
          (e) => {
            if (held.get(name) === entry) held.delete(name);
            reject(e);
          },
        );
      });
    },
  };
}

/** Timers on a fake clock: `run(ms)` fires what falls due, in order. */
export function fakeTimers(start = 1_000_000) {
  let t = start;
  let seq = 0;
  const due = new Map(); // handle → {at, fn, every}
  const add = (fn, ms, every) => {
    const h = ++seq;
    due.set(h, { at: t + Math.max(0, ms || 0), fn, every });
    return h;
  };
  return {
    now: () => t,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearTimeout: (h) => due.delete(h),
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms || 1)),
    clearInterval: (h) => due.delete(h),
    /** Advance the clock by ms, firing timers (and settling between). */
    async run(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [h, d] of due)
          if (d.at <= end && (!next || d.at < next[1].at)) next = [h, d];
        if (!next) break;
        const [h, d] = next;
        t = Math.max(t, d.at);
        if (d.every) d.at += d.every;
        else due.delete(h);
        d.fn();
        await settle();
      }
      t = end;
    },
    pending: () => due.size,
  };
}

/** Let queued microtasks and immediates run (socket events, lock grants). */
export async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

/**
 * One browser profile on one computer, talking to a relay. Windows share
 * localStorage and Web Locks per origin; each window has its own
 * sessionStorage (window.open and a duplicated tab copy the opener's). A
 * window's `env` is what twinSync.js takes instead of the page globals.
 * `relay` may be swapped (a restart with another host); `drop()` closes
 * every socket from the server side, as a restart does.
 */
export function fakeBrowser({ relay, locks = true, timers = fakeTimers() }) {
  const origins = new Map(); // origin → {local, locks}
  const originOf = (href) => new URL(href).origin;
  const site = (origin) => {
    if (!origins.has(origin))
      origins.set(origin, { local: memStorage(), locks: fakeLocks() });
    return origins.get(origin);
  };
  const b = {
    relay,
    timers,
    sockets: [], // every client socket ever opened
    up: true,
    site,
    local: (href = 'http://localhost:4173/') => site(originOf(href)).local,
    /** Close every open socket from the server's side (1006). */
    drop() {
      for (const s of b.sockets) s.serverClose(1006);
    },
    window({ href, opener = null, withLocks = locks } = {}) {
      const where = site(originOf(href));
      const session = memStorage(opener ? opener.session.map : null);
      const u = new URL(href);
      const location = {
        href: u.href,
        protocol: u.protocol,
        host: u.host,
        hostname: u.hostname,
        search: u.search,
        replaced: null,
        replace(to) {
          location.replaced = to;
        },
      };
      const w = { session, location, sockets: [] };
      class FakeWebSocket {
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          this.sent = [];
          this.listeners = {};
          b.sockets.push(this);
          w.sockets.push(this);
          queueMicrotask(() => this.connect());
        }
        connect() {
          if (this.readyState !== 0) return;
          if (!b.up) {
            this.readyState = 3;
            return this.emit('close', { code: 1006 });
          }
          const srv = fakeSocket();
          this.srv = srv;
          srv.send = (s) => {
            srv.out.push(JSON.parse(s));
            queueMicrotask(() => {
              if (this.readyState === 1) this.emit('message', { data: s });
            });
          };
          srv.close = (code = 1000) => {
            if (srv.readyState === 3) return;
            srv.readyState = 3;
            srv.closeCode = code;
            srv.emit('close', code);
            queueMicrotask(() => this.closed(code));
          };
          b.relay.attach(srv, { isLocal: true });
          this.readyState = 1;
          this.emit('open', {});
        }
        addEventListener(t, fn) {
          (this.listeners[t] ||= []).push(fn);
        }
        emit(t, e) {
          for (const fn of this.listeners[t] || []) fn(e);
        }
        send(s) {
          if (this.readyState !== 1) throw new Error('not open');
          this.sent.push(JSON.parse(s));
          this.srv.emit('message', s);
        }
        closed(code) {
          if (this.readyState === 3) return;
          this.readyState = 3;
          this.emit('close', { code });
        }
        /** The client closes (page code). */
        close(code = 1000) {
          if (this.readyState === 3) return;
          if (this.srv && this.srv.readyState !== 3) {
            this.srv.readyState = 3;
            this.srv.emit('close', code);
          }
          this.closed(code);
        }
        /** The server side goes away (restart). */
        serverClose(code) {
          if (this.srv && this.srv.readyState !== 3) this.srv.close(code);
          else this.closed(code);
        }
        get hellos() {
          return this.sent.filter((m) => m.t === 'hello');
        }
      }
      const safe = (s) => ({
        get: (k) => s.getItem(k),
        set: (k, v) => (v == null ? s.removeItem(k) : s.setItem(k, v)),
      });
      w.env = {
        local: safe(where.local),
        session: safe(session),
        locks: withLocks ? where.locks : null,
        crypto: globalThis.crypto,
        location,
        WebSocket: FakeWebSocket,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        now: timers.now,
      };
      return w;
    },
  };
  return b;
}
