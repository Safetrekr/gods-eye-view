// Fixed upstream and route. The browser sends its Supabase access token;
// only Core resolves the trusted staff role and organization.
export function staffCoreProxy({ coreUrl = 'http://127.0.0.1:8001' } = {}) {
  const upstream = new URL(coreUrl);
  if (
    !['http:', 'https:'].includes(upstream.protocol) ||
    upstream.username ||
    upstream.password
  )
    throw new Error('Invalid SAFETREKR_CORE_URL');
  const install = (server) => {
    server.middlewares.use('/api/safetrekr/operations', async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end();
        return;
      }
      const authorization = req.headers.authorization;
      if (!/^Bearer [^\s]+$/.test(authorization || '')) {
        res.writeHead(401);
        res.end();
        return;
      }
      const target = new URL('/v1/staff/operations', upstream);
      const input = new URL(req.url, 'http://localhost');
      if (input.pathname !== '/' && input.pathname !== '') {
        res.writeHead(404);
        res.end();
        return;
      }
      for (const key of ['trip_id', 'window', 'offset', 'limit'])
        if (input.searchParams.has(key))
          target.searchParams.set(key, input.searchParams.get(key));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const abort = () => controller.abort();
      res.on('close', abort);
      try {
        const result = await fetch(target, {
          headers: { Authorization: authorization, Accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json');
        const retry = result.headers.get('retry-after');
        if (retry) res.setHeader('Retry-After', retry);
        res.end(await result.text());
      } catch {
        if (!res.destroyed) {
          res.writeHead(502);
          res.end('{"error":"Core unavailable"}');
        }
      } finally {
        clearTimeout(timeout);
        res.off('close', abort);
      }
    });
  };
  return {
    name: 'safetrekr-read-only-core',
    configureServer: install,
    configurePreviewServer: install,
  };
}
