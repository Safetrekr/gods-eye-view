// Builds the standalone Trip Twin prototype page alongside the main app,
// without changing the existing config: `npx vite build --config vite.twin.config.js`.
// Dev: `npx vite --config vite.twin.config.js` adds the weather proxy.
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import baseConfig from './server/standalone/vite.config.js';
import { twinWeatherProxy } from './server/tripTwin/weatherProxy.js';
import { twinRoutingProxy } from './server/tripTwin/routingProxy.js';
import { twinSyncRelay } from './server/tripTwin/syncRelay.js';
import { twinStreetPhotoProxy } from './server/tripTwin/streetPhotoProxy.js';
import { twinCameraProxy } from './server/tripTwin/cameraProxy.js';
import { twinVoiceProxy } from './server/tripTwin/voiceProxy.js';
import { terrainHeightsProxy } from './server/providers/terrain.js';
import {
  machineNames,
  parseAllowedHosts,
} from './server/tripTwin/twinHosts.js';
import { readBonjourName } from './server/tripTwin/twinHostCheck.js';

/**
 * The terrain proxy allows 90 requests a minute per IP, and each wall asks for
 * camera ground heights in about 18 at load. A six-wall room, the All-in-one
 * and the remote share one IP on the host machine, so each gets a share.
 */
const TWIN_TERRAIN_PER_MIN = 90 * 8;

/**
 * The base config answers only the Host names it lists (IP addresses
 * always). Walls reach this machine by its own names too
 * (Jesses-Mac-Studio.local), so add the exact names Trip Twin's host check
 * already answers to: no wildcards.
 */
function twinAllowedHosts(list) {
  if (list === true) return true;
  const names = [
    ...machineNames({ hostname: os.hostname(), bonjour: readBonjourName() }),
    ...parseAllowedHosts(process.env.TRIP_TWIN_ALLOWED_HOSTS).entries.map(
      (entry) => entry.name,
    ),
  ];
  return [...new Set([...(list || []), ...names])];
}

export default async (env) => {
  const config =
    typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
  const base = (config.plugins || [])
    .flat()
    .map((plugin) =>
      plugin?.name === 'terrain-heights-proxy'
        ? terrainHeightsProxy({ ratePerMin: TWIN_TERRAIN_PER_MIN })
        : plugin,
    );
  // Ahead of the base config's api-not-found plugin, which answers every
  // /api path that no earlier plugin took.
  const at = base.findIndex((plugin) => plugin?.name === 'api-not-found');
  const end = at < 0 ? base.length : at;
  return {
    ...config,
    server: {
      ...config.server,
      allowedHosts: twinAllowedHosts(config.server?.allowedHosts),
    },
    preview: {
      ...config.preview,
      allowedHosts: twinAllowedHosts(config.preview?.allowedHosts),
    },
    plugins: [
      ...base.slice(0, end),
      twinWeatherProxy(),
      twinRoutingProxy(),
      // Street photos (review/street-photos P5): one search and one render
      // for the room.
      twinStreetPhotoProxy(),
      // Traffic cameras (review/traffic-cameras T5): one fetch per camera for
      // the room, over upstream's own routes.
      twinCameraProxy(),
      // SOC multi-view (phase 10): screens + remote. LAN devices need
      // HOST=0.0.0.0 npx vite --config vite.twin.config.js
      twinSyncRelay(),
      // Fitzroy V1: the remote on this computer reaches the local voice
      // service (voice-lab/run_fitzroy.sh) same-origin; dev server only.
      twinVoiceProxy(),
      ...base.slice(end),
    ],
    build: {
      ...(config.build || {}),
      rollupOptions: {
        ...(config.build?.rollupOptions || {}),
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          twin: fileURLToPath(new URL('./twin.html', import.meta.url)),
          twinRemote: fileURLToPath(
            new URL('./twin-remote.html', import.meta.url),
          ),
          // SafeTrekr Executive (B2, EP-35 §6): its own pages, only under
          // TRIP_TWIN_PRODUCT=executive; the school build is unchanged.
          ...(process.env.TRIP_TWIN_PRODUCT === 'executive'
            ? {
                twinExecutive: fileURLToPath(
                  new URL('./twin-executive.html', import.meta.url),
                ),
                twinPhone: fileURLToPath(
                  new URL('./twin-phone.html', import.meta.url),
                ),
                // B4: the presenter's iPad page.
                twinExecutiveRemote: fileURLToPath(
                  new URL('./twin-executive-remote.html', import.meta.url),
                ),
                // B6: the printable day's record and white-label sheet.
                twinExecutiveRecord: fileURLToPath(
                  new URL('./twin-executive-record.html', import.meta.url),
                ),
              }
            : {}),
        },
      },
    },
  };
};
