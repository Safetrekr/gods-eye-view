import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export const CAMERA_PACK_FILE = 'config/cctv_sources.safetrekr.local.json';

export function normalizeCameraPack(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw new Error('Import an array of 1–100 camera entries.');
  return input.map((item, index) => {
    const text = (key, max = 160) => {
      const value = String(item?.[key] ?? '').trim();
      if (!value || value.length > max || /[\x00-\x1f]/.test(value))
        throw new Error(
          `Camera ${index + 1}: ${key} is required (maximum ${max} characters).`,
        );
      return value;
    };
    const coordinate = (key, max) => {
      const raw = item?.[key];
      const value = Number(raw);
      if (
        raw === null ||
        raw === undefined ||
        String(raw).trim() === '' ||
        !Number.isFinite(value) ||
        Math.abs(value) > max
      )
        throw new Error(`Camera ${index + 1}: invalid ${key}.`);
      return value;
    };
    const url = publicCameraUrl(text('url', 2048));
    if (item.feedType && item.feedType !== 'image')
      throw new Error(
        'The local importer accepts snapshot image feeds. Streaming sites require an adapter.',
      );
    const sourceId = item.id
      ? text('id', 80).replace(/^custom-/, '')
      : randomUUID();
    if (!/^[a-zA-Z0-9_-]+$/.test(sourceId))
      throw new Error(
        'Camera IDs may contain letters, numbers, underscores, and hyphens.',
      );
    return {
      id: `custom-${sourceId}`,
      name: text('name'),
      city: text('city'),
      cityId: `custom-${text('city')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 70)}`,
      provider: text('provider'),
      license: text('license', 300),
      lat: coordinate('lat', 90),
      lon: coordinate('lon', 180),
      feedType: 'image',
      sourceKind: 'local-camera-pack',
      url: url.href,
    };
  });
}

export function publicCameraUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Use a complete HTTPS snapshot URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !url.hostname.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname)
  )
    throw new Error(
      'Use a public HTTPS snapshot URL without credentials or a custom port.',
    );
  if (isIP(url.hostname) && !isPublicCameraAddress(url.hostname))
    throw new Error('Camera address is not public.');
  return url;
}

export function isPublicCameraAddress(address) {
  // IPv6 is intentionally limited to global unicast; no mapped IPv4, link-local,
  // unique-local, documentation, transition, or special-purpose ranges.
  if (address.includes(':')) {
    if (isIP(address) !== 6) return false;
    const [a, b] = address.split(':').map((part) => parseInt(part || '0', 16));
    return (
      a >= 0x2000 &&
      a < 0x4000 &&
      a !== 0x2002 &&
      a !== 0x3fff &&
      !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8))
    );
  }
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)
  )
    return false;
  const [a, b, c] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** Resolve on every frame and pin the public address through the actual socket. */
export async function fetchPublicCameraImage(
  value,
  { lookupImpl = lookup, requestImpl = https.request } = {},
) {
  const url = publicCameraUrl(value);
  const addresses = await lookupImpl(url.hostname, {
    all: true,
    verbatim: true,
  });
  if (
    !addresses.length ||
    addresses.some((row) => !isPublicCameraAddress(row.address))
  )
    throw new Error('Camera address is not public.');
  return new Promise((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'SafeTrekr-public-camera/1.0',
          Accept: 'image/*',
        },
        lookup(_host, options, callback) {
          if (options?.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      },
      (response) => {
        // Require a direct image endpoint; redirects aren't followed into a new host.
        if (
          response.statusCode !== 200 ||
          !String(response.headers['content-type']).startsWith('image/')
        ) {
          response.destroy();
          reject(new Error('Camera did not return a direct image.'));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) {
            response.destroy();
            reject(new Error('Camera frame exceeds 5 MB.'));
          } else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              headers: { 'Content-Type': response.headers['content-type'] },
            }),
          ),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

export function loadCameraPack(root = process.cwd()) {
  const filename = path.join(root, CAMERA_PACK_FILE);
  try {
    if (
      fs.lstatSync(filename).isSymbolicLink() ||
      fs.statSync(filename).size > 512 * 1024
    )
      throw new Error('Invalid local camera file.');
    const rows = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!Array.isArray(rows) || rows.length > 300)
      throw new Error('Invalid local camera pack.');
    return rows.length ? rows.flatMap((row) => normalizeCameraPack([row])) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('The local camera pack could not be read.');
  }
}

export function saveCameraPack(input, root = process.cwd()) {
  const incoming = normalizeCameraPack(input);
  const existing = loadCameraPack(root);
  const merged = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) merged.set(row.id, row);
  if (merged.size > 300)
    throw new Error('The local camera pack is limited to 300 entries.');
  const content = JSON.stringify([...merged.values()], null, 2) + '\n';
  if (Buffer.byteLength(content) > 512 * 1024)
    throw new Error('The saved camera pack is limited to 512 KB.');
  const filename = path.join(root, CAMERA_PACK_FILE);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { added: incoming.length, total: merged.size };
}
