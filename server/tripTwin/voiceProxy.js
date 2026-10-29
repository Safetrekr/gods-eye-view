// Fitzroy V1 (plans/trip-twin/FITZROY-V1-HOWTO.md; VOICE-CONTROL §2, §4):
// the remote page on this computer reaches the local voice service
// (voice-lab/src/v1/service.py, 127.0.0.1 only) through this same-origin
// route, so the browser never makes a cross-origin call. Dev server only
// (apply: 'serve'). Behind the Trip Twin Host guard and localOnly (§4.4):
// a loopback peer, a loopback Host and a same-origin fetch, else 403 and an
// `http.refused` event. iPads and phones are V3 (HTTPS first).
//
// Paths: GET /api/twin-voice/health, POST /api/twin-voice/turn | /speak |
// /reset. Bodies pass through as they are and are never logged (a turn
// carries the utterance; its answer, the transcript).
import http from 'node:http';
import { hostCheckFor } from './twinHostCheck.js';
import { twinHostGuard, twinLocalOnly } from './twinHosts.js';

export const VOICE_PATHS = Object.freeze({
  'GET /health': '/health',
  'POST /turn': '/turn',
  'POST /speak': '/speak',
  'POST /reset': '/reset',
});
const MAX_BODY = 4 * 1024 * 1024;

function reply(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

/** One request to the voice service; resolves with {status, body}. */
export function forward({ port, method, path, body = null, timeoutMs }) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': body.length,
            }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 502,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    const down = () =>
      resolve({
        status: 503,
        body: Buffer.from(JSON.stringify({ ok: false, error: 'Voice down' })),
      });
    req.on('timeout', () => {
      req.destroy();
      down();
    });
    req.on('error', down);
    if (body) req.write(body);
    req.end();
  });
}

/** The handler (exported for tests); `port` is the voice service's. */
export function voiceHandler({ port }) {
  return async function tripTwinVoice(req, res) {
    const sub = String(req.url || '/').split('?')[0];
    const target = VOICE_PATHS[`${req.method} ${sub}`];
    if (!target) return reply(res, 404, { ok: false, error: 'not found' });
    let body = null;
    if (req.method === 'POST') {
      const chunks = [];
      let n = 0;
      for await (const c of req) {
        n += c.length;
        if (n > MAX_BODY)
          return reply(res, 413, { ok: false, error: 'too long' });
        chunks.push(c);
      }
      body = Buffer.concat(chunks);
    }
    const r = await forward({
      port,
      method: req.method,
      path: target,
      body,
      timeoutMs: sub === '/health' ? 2000 : 30000,
    });
    res.writeHead(r.status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(r.body);
  };
}

export function twinVoiceProxy({
  port = Number(process.env.TRIP_TWIN_VOICE_PORT) || 8788,
} = {}) {
  return {
    name: 'safetrekr-trip-twin-voice',
    apply: 'serve',
    configureServer(server) {
      const check = hostCheckFor(server);
      server.middlewares.use('/api/twin-voice', twinHostGuard({ check }));
      server.middlewares.use(
        '/api/twin-voice',
        twinLocalOnly({ check, handler: voiceHandler({ port }) }),
      );
    },
  };
}
