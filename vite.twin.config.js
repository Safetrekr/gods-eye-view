// Builds the standalone Trip Twin prototype page alongside the main app,
// without changing the existing config: `npx vite build --config vite.twin.config.js`.
// Dev: `npx vite --config vite.twin.config.js` adds the weather proxy.
import { fileURLToPath } from 'node:url';
import baseConfig from './server/standalone/vite.config.js';
import { twinWeatherProxy } from './server/tripTwin/weatherProxy.js';
import { twinRoutingProxy } from './server/tripTwin/routingProxy.js';

export default async (env) => {
  const config =
    typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      twinWeatherProxy(),
      twinRoutingProxy(),
    ],
    build: {
      ...(config.build || {}),
      rollupOptions: {
        ...(config.build?.rollupOptions || {}),
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          twin: fileURLToPath(new URL('./twin.html', import.meta.url)),
        },
      },
    },
  };
};
