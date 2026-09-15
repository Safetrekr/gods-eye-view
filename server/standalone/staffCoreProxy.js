// Fixed upstream and route. The browser sends its Supabase access token;
// only Core resolves the trusted staff role and organization.
export function staffCoreProxy({
  coreUrl = 'http://127.0.0.1:8001',
  onAuthorized,
} = {}) {
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
      const input = new URL(req.url, 'http://localhost');
      const action =
        /^\/trips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(broadcast|direct-group)$/i.test(
          input.pathname,
        );
      const snapshot = input.pathname === '/' || input.pathname === '';
      if (!snapshot && !action) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method !== (action ? 'POST' : 'GET')) {
        res.writeHead(405, { Allow: action ? 'POST' : 'GET' });
        res.end();
        return;
      }
      const authorization = req.headers.authorization;
      if (!/^Bearer [^\s]+$/.test(authorization || '')) {
        res.writeHead(401);
        res.end();
        return;
      }
      let body;
      if (action) {
        if (
          !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')
        ) {
          res.writeHead(415);
          res.end();
          return;
        }
        if (req.headers.origin) {
          try {
            if (new URL(req.headers.origin).host !== req.headers.host)
              throw new Error();
          } catch {
            res.writeHead(403);
            res.end();
            return;
          }
        }
        try {
          if (req.body !== undefined)
            body =
              typeof req.body === 'string'
                ? req.body
                : JSON.stringify(req.body);
          else {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              size += Buffer.byteLength(chunk);
              if (size > 16384) {
                res.writeHead(413);
                res.end();
                return;
              }
              chunks.push(Buffer.from(chunk));
            }
            body = Buffer.concat(chunks).toString('utf8');
          }
          if (Buffer.byteLength(body) > 16384) {
            res.writeHead(413);
            res.end();
            return;
          }
          JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
      }
      const target = new URL(
        `/v1/staff/operations${action ? input.pathname : ''}`,
        upstream,
      );
      for (const key of action ? [] : ['trip_id', 'window', 'offset', 'limit'])
        if (input.searchParams.has(key))
          target.searchParams.set(key, input.searchParams.get(key));
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        action ? 55000 : 30000,
      );
      const abort = () => controller.abort();
      res.on('close', abort);
      try {
        const result = await fetch(target, {
          method: req.method,
          headers: {
            Authorization: authorization,
            Accept: 'application/json',
            ...(action ? { 'Content-Type': 'application/json' } : {}),
          },
          body,
          redirect: 'error',
          signal: controller.signal,
        });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json');
        const retry = result.headers.get('retry-after');
        if (retry) res.setHeader('Retry-After', retry);
        const responseBody = await result.text();
        if (result.ok && !action) onAuthorized?.(res);
        res.end(responseBody);
      } catch {
        if (!res.destroyed) {
          res.writeHead(502);
          res.end(
            JSON.stringify({
              error: action
                ? 'Send result unknown. Check the trip alerts before sending again.'
                : 'Core unavailable',
            }),
          );
        }
      } finally {
        clearTimeout(timeout);
        res.off('close', abort);
      }
    });
  };
  return {
    name: 'safetrekr-core-bridge',
    configureServer: install,
    configurePreviewServer: install,
  };
}
