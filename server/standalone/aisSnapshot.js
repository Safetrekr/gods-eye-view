import WebSocket from 'ws';
import { getCache } from '@vercel/functions';
import {
  ingestAisStreamEnvelope,
  aisStreamRows,
  newestAisPositionAt,
} from '../providers/vessels/ais-store.js';

let inFlight;
const CACHE_KEY = 'ais-world-sample-v1';
/** Bounded sampling: Vercel workers cannot own an always-on AIS connection. */
async function sample() {
  let cached;
  try {
    cached = await getCache().get(CACHE_KEY);
  } catch {
    /* Cache is optional locally. */
  }
  if (cached && Date.now() - cached.sampledAt < 60000) return cached;
  let received = 0;
  let failed = false;
  await new Promise((resolve) => {
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream', {
      handshakeTimeout: 8000,
    });
    const finish = () => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.terminate();
      resolve();
    };
    const timeout = setTimeout(finish, 12000);
    socket.on('open', () =>
      socket.send(
        JSON.stringify({
          APIKey: process.env.AISSTREAM_API_KEY,
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FilterMessageTypes: [
            'PositionReport',
            'StandardClassBPositionReport',
            'ExtendedClassBPositionReport',
            'ShipStaticData',
            'StaticDataReport',
          ],
        }),
      ),
    );
    socket.on('message', (data) => {
      try {
        const envelope = JSON.parse(String(data));
        if (envelope.error || envelope.Error) {
          failed = true;
          finish();
          return;
        }
        if (ingestAisStreamEnvelope(envelope)) received++;
        if (received >= 4000) finish();
      } catch {
        /* Ignore malformed upstream messages. */
      }
    });
    socket.on('error', () => {
      failed = true;
      finish();
    });
    socket.on('close', finish);
  });
  const byId = new Map((cached?.rows || []).map((row) => [row.mmsi, row]));
  for (const row of aisStreamRows(3000)) byId.set(row.mmsi, row);
  const rows = [...byId.values()]
    .filter((row) => row.last_position_epoch * 1000 > Date.now() - 900000)
    .sort((a, b) => b.last_position_epoch - a.last_position_epoch)
    .slice(0, 3000);
  const snapshot = {
    rows,
    source: 'AISStream · 12-second samples, refreshed at most once a minute',
    sampledAt: Date.now(),
    newestPositionAt: newestAisPositionAt(rows),
    lastMessageAt: received ? Date.now() : cached?.lastMessageAt || null,
    status: received ? 'live' : 'stale',
    refreshing: false,
    error: received
      ? null
      : failed
        ? 'AISStream connection unavailable'
        : 'No AIS reports received in this sample',
    staleAfterMs: 120000,
    sampling: true,
  };
  try {
    await getCache().set(CACHE_KEY, snapshot, { ttl: 900 });
  } catch {
    /* Next request may sample again. */
  }
  return snapshot;
}

export async function aisSnapshot(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (new URL(req.url, 'http://localhost').pathname !== '/') {
    res.statusCode = 404;
    res.end(
      JSON.stringify({
        error: 'Historical vessel tracks are not available on this deployment',
        samples: [],
      }),
    );
    return;
  }
  if (!process.env.AISSTREAM_API_KEY) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        rows: [],
        status: 'missing-key',
        error: 'AISSTREAM_API_KEY is not set',
      }),
    );
    return;
  }
  if (!inFlight)
    inFlight = sample().finally(() => {
      inFlight = null;
    });
  res.end(JSON.stringify(await inFlight));
}
