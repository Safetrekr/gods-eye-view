import { cctvProxy, overpassProxy } from '../server/providers/local.js';
import { openSkyProxy } from '../server/providers/aircraft/opensky.js';
import { adsbLolProxy } from '../server/providers/aircraft/adsb-lol.js';
import { adsbdbProxy } from '../server/providers/aircraft/enrichment.js';
import { celestrakProxy } from '../server/providers/space.js';
import { terrainHeightsProxy } from '../server/providers/terrain.js';
import { tomtomProxy } from '../server/providers/traffic.js';
import { firmsProxy } from '../server/providers/firms.js';
import { operationsProviders } from '../server/standalone/operationsProviders.js';
import { staffCoreProxy } from '../server/standalone/staffCoreProxy.js';
import {
  issueProviderSession,
  validProviderSession,
  clearProviderSession,
} from '../server/standalone/providerSession.js';
import {
  aisSnapshot,
  refreshAisSnapshot,
} from '../server/standalone/aisSnapshot.js';

let routes;
function registeredRoutes() {
  if (routes) return routes;
  const registry = [];
  const server = {
    config: { root: process.cwd() },
    middlewares: { use: (prefix, handle) => registry.push({ prefix, handle }) },
  };
  // Deliberate allowlist: no key editor, AI endpoint, arbitrary proxy or file writes.
  const plugins = [
    staffCoreProxy({
      coreUrl: process.env.SAFETREKR_CORE_URL,
      onAuthorized: (res) =>
        issueProviderSession(res, process.env.PROVIDER_SESSION_SECRET),
    }),
    operationsProviders({ allowCameraEditing: false }),
    openSkyProxy(),
    adsbLolProxy(),
    adsbdbProxy(),
    celestrakProxy(),
    terrainHeightsProxy(),
    tomtomProxy(),
    firmsProxy(),
    overpassProxy(),
    cctvProxy(),
  ];
  for (const plugin of plugins) plugin.configureServer(server);
  registry.push({ prefix: '/api/ais-live', handle: aisSnapshot });
  routes = registry;
  return routes;
}

/** Vercel's Node req/res API preserves the existing streaming provider middleware. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const input = new URL(req.url, 'https://localhost');
  const forwardedPath = input.searchParams.get('path');
  input.searchParams.delete('path');
  const pathname = forwardedPath ? `/api/${forwardedPath}` : input.pathname;
  if (pathname === '/api/safetrekr/logout' && req.method === 'POST') {
    clearProviderSession(res);
    res.statusCode = 204;
    res.end();
    return;
  }
  if (pathname === '/api/safetrekr/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        service: 'safetrekr-gods-eye',
        configured: Boolean(
          process.env.SAFETREKR_CORE_URL && process.env.PROVIDER_SESSION_SECRET,
        ),
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      }),
    );
    return;
  }
  const isCollector =
    Boolean(process.env.CRON_SECRET) &&
    req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (pathname === '/api/safetrekr/ais-refresh') {
    if (!isCollector || req.method !== 'GET') {
      res.statusCode = 401;
      res.end();
      return;
    }
    try {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(await refreshAisSnapshot()));
    } catch {
      console.error('[SafeTrekr AIS] Scheduled collection failed');
      res.statusCode = 502;
      res.end('{"error":"AIS collection failed"}');
    }
    return;
  }
  const isAction =
    /^\/api\/safetrekr\/operations\/trips\/[a-f0-9-]{36}\/(broadcast|direct-group)$/i.test(
      pathname,
    );
  const isCore = pathname === '/api/safetrekr/operations' || isAction;
  const isSharedAis =
    pathname === '/api/ais-live' && isCollector && req.method === 'GET';
  if (
    !isCore &&
    !isSharedAis &&
    !validProviderSession(
      req.headers.cookie,
      process.env.PROVIDER_SESSION_SECRET,
    )
  ) {
    res.statusCode = 401;
    res.end('{"error":"Sign in with an authorized SafeTrekr staff account"}');
    return;
  }
  if (
    !['GET', 'HEAD'].includes(req.method) &&
    !(isAction && req.method === 'POST') &&
    !(
      req.method === 'POST' &&
      ['/api/overpass', '/api/terrain/heights'].includes(pathname)
    )
  ) {
    res.statusCode = 405;
    res.end();
    return;
  }
  try {
    const route = registeredRoutes().find(
      ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (!route) {
      res.statusCode = 404;
      res.end();
      return;
    }
    req.url = `${pathname.slice(route.prefix.length) || '/'}${input.search}`;
    await new Promise((resolve, reject) => {
      res.once('finish', resolve);
      res.once('close', resolve);
      Promise.resolve(
        route.handle(req, res, () => {
          res.statusCode = 404;
          res.end();
        }),
      ).catch(reject);
    });
  } catch {
    console.error(
      '[SafeTrekr gateway] Provider request failed',
      pathname.split('/').slice(0, 3).join('/'),
    );
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
    }
    if (!res.writableEnded)
      res.end('{"error":"Provider temporarily unavailable"}');
  }
}
