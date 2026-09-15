import { saveCameraPack, loadCameraPack } from '../providers/camera-packs.js';

function localRequest(req) {
  const address = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    return (
      ['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) &&
      !host.username &&
      !host.password
    );
  } catch {
    return false;
  }
}

/** Configuration presence only; keys and source URLs never leave the server. */
export function operationsProviders({
  root = process.cwd(),
  invalidateCameras = () => {},
  allowCameraEditing = true,
} = {}) {
  return {
    name: 'safetrekr-operations-providers',
    configureServer(server) {
      server.middlewares.use('/api/safetrekr/providers', (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify({
            google: Boolean(
              process.env.GOOGLE_MAPS_API_KEY || process.env.CESIUM_ION_TOKEN,
            ),
            flights: Boolean(
              process.env.OPENSKY_CLIENT_ID &&
              process.env.OPENSKY_CLIENT_SECRET,
            ),
            traffic: Boolean(process.env.TOMTOM_API_KEY),
            fires: Boolean(process.env.FIRMS_MAP_KEY),
            ships: Boolean(process.env.AISSTREAM_API_KEY),
            cameraEditing: allowCameraEditing && localRequest(req),
          }),
        );
      });
      server.middlewares.use('/api/safetrekr/cameras', async (req, res) => {
        const send = (status, value) => {
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify(value));
        };
        if (!allowCameraEditing || !localRequest(req)) {
          send(403, {
            error: 'Camera editing is available only on this local computer.',
          });
          return;
        }
        if (req.method === 'GET') {
          try {
            send(200, { count: loadCameraPack(root).length });
          } catch {
            send(500, { error: 'Could not read the local camera pack.' });
          }
          return;
        }
        if (req.method !== 'POST') {
          send(405, { error: 'Method not allowed.' });
          return;
        }
        const expectedOrigin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
        if (
          req.headers.origin !== expectedOrigin ||
          req.headers['content-type']?.split(';')[0] !== 'application/json'
        ) {
          send(403, { error: 'Use the camera form in this local app.' });
          return;
        }
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 256 * 1024) {
              send(413, { error: 'Camera pack exceeds 256 KB.' });
              return;
            }
            chunks.push(chunk);
          }
          const result = saveCameraPack(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
            root,
          );
          await invalidateCameras();
          send(200, result);
        } catch (error) {
          send(400, {
            error:
              error instanceof SyntaxError
                ? 'Import a valid JSON array.'
                : error.message,
          });
        }
      });
    },
  };
}
