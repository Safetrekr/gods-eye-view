// Trip Twin street photos (review/street-photos P5): one fixed flat view out
// of a 360° equirectangular photo, rendered once on the server for every
// wall. Each output pixel's ray is sampled through upstream's `rayToUv`, the
// same mapping the All-in-one's draggable viewer uses, so a wall shows exactly
// what the viewer shows at that yaw. Pure: raw pixels in, raw pixels out.
import { rayToUv } from '../../src/layers/streetLevel/panorama.js';

/**
 * @param {{data: Uint8Array, width: number, height: number, channels: number}} src
 *   the equirectangular image, its centre column the camera's heading
 * @param {{yaw?: number, pitch?: number, fov?: number, outW: number, outH: number}} view
 *   yaw/pitch in degrees from the heading; fov is the horizontal field of view
 * @returns {Buffer} RGB, outW × outH
 */
export function projectEquirect(
  src,
  { yaw = 0, pitch = 0, fov = 75, outW, outH },
) {
  const { data, width: W, height: H, channels: C } = src;
  const out = Buffer.alloc(outW * outH * 3);
  const tx = Math.tan(((fov / 2) * Math.PI) / 180);
  const ty = (tx * outH) / outW;
  const at = (x, y, c) => data[(y * W + x) * C + c];
  for (let j = 0; j < outH; j++) {
    const ry = (1 - (2 * (j + 0.5)) / outH) * ty;
    for (let i = 0; i < outW; i++) {
      const rx = ((2 * (i + 0.5)) / outW - 1) * tx;
      const [u, v] = rayToUv([rx, ry, -1], { yaw, pitch });
      // Bilinear, wrapping around in longitude and clamped at the poles.
      const fx = u * W - 0.5;
      const fy = Math.min(H - 1, Math.max(0, v * H - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const xa = ((x0 % W) + W) % W;
      const xb = (xa + 1) % W;
      const yb = Math.min(H - 1, y0 + 1);
      const o = (j * outW + i) * 3;
      for (let c = 0; c < 3; c++) {
        const top = at(xa, y0, c) * (1 - ax) + at(xb, y0, c) * ax;
        const bot = at(xa, yb, c) * (1 - ax) + at(xb, yb, c) * ax;
        out[o + c] = Math.round(top * (1 - ay) + bot * ay);
      }
    }
  }
  return out;
}

/**
 * The source width a view needs: the output's pixels per degree over the
 * whole 360°, never more than the photo has. Decoding an 8,000 px panorama
 * to show 60° of it at 960 px would spend 96 MB for nothing.
 */
export function sourceWidthFor({ fov, outW, srcW }) {
  return Math.min(srcW, Math.ceil((360 * outW) / fov / 2) * 2);
}
