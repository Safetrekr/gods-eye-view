import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createBrowserViteConfig } from '../../build/vite.js';
import {
  localProviderPlugins,
  invalidateCctvSources,
} from '../providers/local.js';
import { staffCoreProxy } from './staffCoreProxy.js';
import { operationsProviders } from './operationsProviders.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return createBrowserViteConfig({
    plugins: [
      staffCoreProxy({ coreUrl: process.env.SAFETREKR_CORE_URL }),
      operationsProviders({ root, invalidateCameras: invalidateCctvSources }),
      ...localProviderPlugins(),
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
  });
});
