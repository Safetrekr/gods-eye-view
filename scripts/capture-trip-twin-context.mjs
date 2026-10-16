#!/usr/bin/env node
// One-time recorder for the Trip Twin wider area (phase 8, BACKLOG "more of
// the city in 3D"): a context ring of buildings and main streets out to
// RING_M around each hotel, and corridors along walking paths from the hotel
// to each venue and to the nearest emergency hospital. Writes
// scripts/fixtures/trip-twin/<city>.context.json (compact: rounded
// coordinates, heights only). Data © OpenStreetMap contributors, ODbL.
// Paths come from the dev server's /api/route (run the twin dev server).
// Usage: node scripts/capture-trip-twin-context.mjs [city...]
import { readFile, writeFile } from 'node:fs/promises';
import { haversineM } from '../src/operations/tripTwin/twinData.js';
import { TWIN_CITIES } from '../src/operations/tripTwin/twinCities.js';
import { TWIN_VENUES } from '../src/operations/tripTwin/twinSites.js';

const RING_M = 1200;
const CORRIDOR_M = 150;
const DEV = process.env.TWIN_DEV || 'http://127.0.0.1:4173';
const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const MAIN =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|footway|steps';

async function overpass(query) {
  let last;
  for (const url of MIRRORS)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'safetrekr-trip-twin-fixture-recorder/1.0',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(180000),
        });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /error|timed out/i.test(json.remark))
          throw new Error(`${url} ${json.remark}`);
        return json;
      } catch (error) {
        last = error;
        console.warn('  retry:', String(error.message).slice(0, 120));
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      }
    }
  throw last;
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Overpass elements → compact {buildings: [{id,h,l,c}], roads: [{id,k,n,c}]}. */
function compact(elements) {
  const buildings = [];
  const roads = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const t = el.tags || {};
    const c = el.geometry.map((p) => [r6(p.lat), r6(p.lon)]);
    if (t.building || t['building:part'])
      buildings.push({
        id: el.id,
        h: num(t.height),
        l: num(t['building:levels']),
        c,
      });
    else if (t.highway)
      roads.push({
        id: el.id,
        k: t.highway,
        n: t.name || null,
        // Walkability (review/phase8 N5): tunnel, access, foot, sidewalk.
        ...(t.tunnel && t.tunnel !== 'no' ? { t: 1 } : {}),
        ...(t.access ? { a: t.access } : {}),
        ...(t.foot ? { f: t.foot } : {}),
        ...(t.footway ? { w: t.footway } : {}),
        c,
      });
  }
  return { buildings, roads };
}

/** Keep every Nth point so the Overpass "around" polyline stays short. */
function thin(pts, max = 50) {
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max);
  const out = pts.filter((_, i) => i % step === 0);
  out.push(pts[pts.length - 1]);
  return out;
}

async function walkPath(from, to) {
  const coords = [from, to].map(
    (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`,
  );
  const res = await fetch(
    `${DEV}/api/route?profile=foot&coords=${coords.join(';')}`,
  );
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'route failed');
  return json.geometry.map(([lon, lat]) => ({ lat, lon }));
}

async function captureCity(key) {
  const city = TWIN_CITIES[key];
  const hotel = city.center;
  const at = `${hotel.lat.toFixed(5)},${(hotel.lon ?? hotel.lng).toFixed(5)}`;
  console.log(`${key}: ring ${RING_M} m`);
  const ring = compact(
    (
      await overpass(
        `[out:json][timeout:170];(way(around:${RING_M},${at})["building"];way(around:${RING_M},${at})["highway"~"^(${MAIN})$"];);out geom qt;`,
      )
    ).elements,
  );
  // Corridors: hotel → each venue in this city, hotel → nearest hospital.
  const targets = Object.values(TWIN_VENUES)
    .filter((v) => v.city === key)
    .map((v) => ({
      key: v.key,
      label: v.short,
      kind: 'venue',
      to: v.anchors?.inside || v.center,
    }));
  const pois = JSON.parse(
    await readFile(
      new URL(`./fixtures/trip-twin/${key}.pois.json`, import.meta.url),
      'utf8',
    ),
  ).pois;
  const hospital = pois
    .filter((p) => p.kind === 'hospital')
    .map((p) => ({ p, d: haversineM(hotel, p) }))
    .sort(
      (a, b) =>
        Number(b.p.emergency === 'yes') - Number(a.p.emergency === 'yes') ||
        a.d - b.d,
    )[0]?.p;
  if (hospital)
    targets.push({
      key: 'hospital',
      label: hospital.name,
      kind: 'hospital',
      to: { lat: hospital.lat, lon: hospital.lon },
    });
  const corridors = [];
  for (const t of targets) {
    try {
      const path = await walkPath(
        { lat: hotel.lat, lon: hotel.lon ?? hotel.lng },
        t.to,
      );
      const line = thin(path)
        .map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
        .join(',');
      const data = compact(
        (
          await overpass(
            `[out:json][timeout:170];(way(around:${CORRIDOR_M},${line})["building"];way(around:${CORRIDOR_M},${line})["highway"~"^(${MAIN})$"];);out geom qt;`,
          )
        ).elements,
      );
      corridors.push({
        key: t.key,
        label: t.label,
        kind: t.kind,
        path: path.map((p) => [r6(p.lat), r6(p.lon)]),
        ...data,
      });
      console.log(
        `  corridor → ${t.label}: ${data.buildings.length} buildings, ${data.roads.length} roads`,
      );
    } catch (error) {
      console.warn(`  corridor → ${t.label} skipped:`, error.message);
    }
  }
  const out = {
    meta: {
      city: key,
      ringM: RING_M,
      corridorM: CORRIDOR_M,
      fetchedAt: new Date().toISOString(),
      attribution: 'Map data © OpenStreetMap contributors, ODbL 1.0',
    },
    ring,
    corridors,
  };
  const file = new URL(
    `./fixtures/trip-twin/${key}.context.json`,
    import.meta.url,
  );
  await writeFile(file, JSON.stringify(out));
  console.log(
    `  ring: ${ring.buildings.length} buildings, ${ring.roads.length} roads`,
  );
}

const keys = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(TWIN_CITIES);
for (const k of keys) await captureCity(k);
