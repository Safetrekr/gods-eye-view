#!/usr/bin/env node
// One-time recorder for Trip Twin OSM fixtures (03 §6.2). Reads public
// OpenStreetMap data through public Overpass mirrors and writes
// scripts/fixtures/trip-twin/<site>.overpass.json (+ <site>.pois.json).
// Sites are hotels (city keys) and venues (phase 3). Data © OpenStreetMap
// contributors, ODbL. Usage: node scripts/capture-trip-twin-osm.mjs [site...]
// Prints each site's placement anchors (computeAnchors) for twinSites.js.
import { writeFile } from 'node:fs/promises';
import {
  buildTwinQuery,
  makeProjector,
  parseOverpassElements,
  projectBuildings,
  AIRSIDE_DETAIL_M,
  haversineM,
  selectHotelFootprint,
  siteRadiusM,
} from '../src/operations/tripTwin/twinData.js';
import { TWIN_CITIES } from '../src/operations/tripTwin/twinCities.js';
import {
  TWIN_VENUES,
  computeAnchors,
  siteConfig,
} from '../src/operations/tripTwin/twinSites.js';

const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

async function overpass(query) {
  let last;
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'safetrekr-trip-twin-fixture-recorder/1.0',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /error|timed out/i.test(json.remark))
          throw new Error(`${url} ${json.remark}`);
        return { json, url };
      } catch (error) {
        last = error;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }
  throw last;
}

/**
 * An airside site's far buildings (beyond AIRSIDE_DETAIL_M) as footprints
 * only: their outline and `building`, coordinates to 6 decimals (~0.1 m),
 * no heights, names or other tags. Keeps a 2.75 km airport fixture small
 * and the wall light; near buildings keep every tag.
 */
function thinFarBuildings(elements, center) {
  let thinned = 0;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = elements.map((el) => {
    const t = el.tags || {};
    if (!t.building || el.type !== 'way' || !Array.isArray(el.geometry))
      return el;
    const c = centroid(el.geometry);
    if (haversineM(center, c) <= AIRSIDE_DETAIL_M) return el;
    thinned += 1;
    return {
      type: 'way',
      id: el.id,
      tags: { building: t.building },
      geometry: el.geometry.map((p) => ({ lat: r6(p.lat), lon: r6(p.lon) })),
    };
  });
  return { elements: out, thinned };
}

function centroid(geometry) {
  let lat = 0;
  let lon = 0;
  const pts = geometry.slice(0, -1);
  for (const p of pts) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}

async function capture(key) {
  const city = siteConfig(key);
  const [type, id] = city.osm.split('/');
  const hotel = await overpass(
    `[out:json][timeout:25];${type}(${id});out center tags;`,
  );
  const el = hotel.json.elements[0];
  const center = el?.center
    ? { lat: el.center.lat, lon: el.center.lon }
    : el?.geometry
      ? centroid(el.geometry)
      : null;
  if (!center) throw new Error(`${key}: site ${city.osm} has no geometry`);
  // A site's own radius and airside terms (Heathrow T5), else the default.
  const radiusM = siteRadiusM(city);
  const query = buildTwinQuery(center, radiusM, {
    airside: Boolean(city.airside),
  });
  const site = await overpass(query);
  const file = new URL(
    `./fixtures/trip-twin/${key}.overpass.json`,
    import.meta.url,
  );
  const out = {
    meta: {
      city: key,
      hotel: {
        osm_id: city.osm,
        name: el.tags?.name || city.label,
        center,
        tags: el.tags || {},
      },
      timezone: city.timezone,
      radius_m: radiusM,
      query,
      fetched_at: new Date().toISOString(),
      source: site.url,
      attribution:
        'Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
    },
    elements: site.json.elements,
  };
  if (city.airside) {
    const thin = thinFarBuildings(out.elements, center);
    out.elements = thin.elements;
    out.meta.thinned = { beyondM: AIRSIDE_DETAIL_M, buildings: thin.thinned };
  }
  // Anchors from the recorded footprint (deterministic, offline-repeatable).
  const proj = makeProjector(center);
  const parsed = parseOverpassElements(out.elements);
  const projected = projectBuildings(parsed.buildings, proj, center);
  const sel = selectHotelFootprint(
    projected.buildings,
    parsed.hotels,
    { ...center, osm_id: city.osm },
    proj,
  );
  const others = projected.buildings
    .filter((b) => b.id !== sel.building.id)
    .map((b) => b.rings[0]);
  out.meta.anchors = computeAnchors(sel.building.rings[0], others, {
    towardDeg: city.assemblyToward ?? null,
  });
  await writeFile(file, JSON.stringify(out));
  console.log(`${key} anchors:`, JSON.stringify(out.meta.anchors));
  const kinds = {};
  for (const e of out.elements) kinds[e.type] = (kinds[e.type] || 0) + 1;
  console.log(
    `${key}: ${out.meta.hotel.name} @ ${center.lat.toFixed(5)},${center.lon.toFixed(5)} via ${site.url} →`,
    kinds,
    `${Math.round(JSON.stringify(out).length / 1024)} KB`,
  );
}

// Real public safety resources and open squares near each hotel. Used by the
// sample trip as hospitals/police/fire POIs and as places for fictional rally
// points (03 §6.1). Pharmacies are captured but the fixture omits them on
// purpose (coverage-gap demo, 02 §6).
async function capturePois(key) {
  const city = siteConfig(key);
  const { lat, lon } = city.center;
  const near = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const query = [
    '[out:json][timeout:25];',
    '(',
    `nwr(around:5000,${near})["amenity"="hospital"];`,
    `nwr(around:3000,${near})["amenity"="police"];`,
    `nwr(around:3000,${near})["amenity"="fire_station"];`,
    `nwr(around:1500,${near})["amenity"="pharmacy"];`,
    `nwr(around:3000,${near})["office"="diplomatic"];`,
    `nwr(around:900,${near})["leisure"="park"];`,
    `nwr(around:900,${near})["place"="square"];`,
    `nwr(around:900,${near})["highway"="pedestrian"]["area"="yes"];`,
    ');',
    'out center tags qt;',
  ].join('\n');
  const res = await overpass(query);
  const pois = res.json.elements
    .map((e) => ({
      osm_id: `${e.type}/${e.id}`,
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
      name: e.tags?.name || '',
      kind:
        e.tags?.amenity ||
        (e.tags?.office === 'diplomatic'
          ? 'diplomatic'
          : e.tags?.leisure || e.tags?.place || 'pedestrian_area'),
      emergency: e.tags?.emergency || null,
      phone: e.tags?.phone || e.tags?.['contact:phone'] || null,
      address:
        [e.tags?.['addr:housenumber'], e.tags?.['addr:street']]
          .filter(Boolean)
          .join(' ') || null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const file = new URL(
    `./fixtures/trip-twin/${key}.pois.json`,
    import.meta.url,
  );
  await writeFile(
    file,
    JSON.stringify({
      meta: {
        city: key,
        query,
        fetched_at: new Date().toISOString(),
        source: res.url,
        attribution: 'Map data © OpenStreetMap contributors, ODbL 1.0',
      },
      pois,
    }),
  );
  const kinds = {};
  for (const p of pois) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
  console.log(`${key} POIs:`, kinds);
}

const keys = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [...Object.keys(TWIN_CITIES), ...Object.keys(TWIN_VENUES)];
const poisOnly = process.env.POIS_ONLY === '1';
for (const key of keys) {
  if (!poisOnly) await capture(key);
  await capturePois(key);
}
