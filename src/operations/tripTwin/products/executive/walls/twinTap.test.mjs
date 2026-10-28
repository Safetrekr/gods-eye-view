// SafeTrekr Executive B3: the WebSocket tap (EP-51 open item 1). The
// executive walls hear the relay's loop messages only because twinSync.js
// connectSync opens its socket with globalThis.WebSocket as it is when it
// connects (twinIdentity.js browserEnv). If that ever changes (a socket
// class captured at import time, or a different global), the walls go
// silent: these tests fail first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installTap, RELAY_PATH } from './tap.js';

class FakeSocket {
  static OPEN = 1;
  static made = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = {};
    FakeSocket.made.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(text) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
    for (const fn of this.listeners.close || []) fn({ code: 1000 });
  }
  emit(type, e = {}) {
    if (type === 'open') this.readyState = 1;
    for (const fn of this.listeners[type] || []) fn(e);
  }
}

async function withGlobals(fn) {
  const saved = {
    WebSocket: globalThis.WebSocket,
    location: globalThis.location,
  };
  globalThis.WebSocket = FakeSocket;
  globalThis.location = {
    protocol: 'http:',
    host: 'localhost:4173',
    hostname: 'localhost',
    href: 'http://localhost:4173/twin-executive.html?view=screen&slot=1',
    replace() {},
  };
  FakeSocket.made = [];
  try {
    return await fn();
  } finally {
    globalThis.WebSocket = saved.WebSocket;
    if (saved.location === undefined) delete globalThis.location;
    else globalThis.location = saved.location;
  }
}

test('B3 tap: connectSync opens its socket with globalThis.WebSocket as it is at connect time', async () => {
  const { connectSync } = await import('../../../twinSync.js');
  await withGlobals(async () => {
    const heard = [];
    const Tapped = installTap((m) => heard.push(m));
    assert.notEqual(Tapped, FakeSocket, 'the tap swapped the global');
    const got = [];
    const sync = connectSync({
      kind: 'screen',
      slot: 2,
      on: {
        loop: (m) => got.push(['loop', m.rev]),
        'loop-role': (m) => got.push(['role', m.role]),
        state: (m) => got.push(['state', m.rev]),
      },
    });
    // connectSync opens once the window's identity is ready (a microtask).
    for (let i = 0; i < 20 && !FakeSocket.made.length; i++)
      await new Promise((r) => setTimeout(r, 5));
    const ws = FakeSocket.made.at(-1);
    assert.ok(ws, 'connectSync opened a socket');
    assert.ok(
      ws instanceof Tapped,
      'the socket is the tapped class: connectSync read globalThis.WebSocket when it connected',
    );
    assert.match(ws.url, RELAY_PATH);
    ws.emit('open');
    const frames = [
      '{"t":"loop","view":"loop","rev":7,"loop":{}}',
      '{"t":"loop-role","slot":2,"role":"verify"}',
      '{"t":"state","rev":3,"state":{}}',
      'not json',
    ];
    for (const data of frames) ws.emit('message', { data });
    // The wall's own handler saw every message, unchanged and in order.
    assert.deepEqual(got, [
      ['loop', 7],
      ['role', 'verify'],
      ['state', 3],
    ]);
    // The tap heard the executive ones only.
    assert.deepEqual(
      heard.map((m) => m.t),
      ['loop', 'loop-role'],
    );
    sync.close?.();
  });
});

test('B3 tap: one wrap only, other sockets untouched, a throwing wall never breaks the socket', async () => {
  await withGlobals(() => {
    const Tapped = installTap(() => {
      throw new Error('a drawing error');
    });
    assert.equal(
      installTap(() => {}),
      Tapped,
      'a second install keeps the first',
    );
    const quiet = globalThis.console.error;
    globalThis.console.error = () => {};
    try {
      const other = new globalThis.WebSocket('ws://localhost:4173/api/other');
      assert.equal(other.listeners.message, undefined);
      const relay = new globalThis.WebSocket(
        'ws://localhost:4173/api/twin-sync',
      );
      let seen = 0;
      relay.addEventListener('message', () => (seen += 1));
      relay.emit('message', { data: '{"t":"loop-clock","clock":{}}' });
      assert.equal(seen, 1, 'the next listener still ran');
    } finally {
      globalThis.console.error = quiet;
    }
  });
});
