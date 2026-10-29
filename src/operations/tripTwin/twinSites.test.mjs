import test from 'node:test';
import assert from 'node:assert/strict';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import {
  computeAnchors,
  siteConfig,
  siteCounts,
  siteCountsLine,
  siteNoun,
  siteOptionLabel,
  sitesForCity,
} from './twinSites.js';
import { readFileSync } from 'node:fs';
import {
  distanceToRing,
  makeProjector,
  parseOverpassElements,
  pointInRing,
  projectBuildings,
  selectHotelFootprint,
} from './twinData.js';

/** A site's recorded footprint (ring in metres) and the other buildings. */
function footprint(key) {
  const site = siteConfig(key);
  const f = JSON.parse(
    readFileSync(
      new URL(
        `../../../scripts/fixtures/trip-twin/${key}.overpass.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const center = f.meta.hotel.center;
  const proj = makeProjector(center);
  const parsed = parseOverpassElements(f.elements);
  const projected = projectBuildings(parsed.buildings, proj, center);
  const sel = selectHotelFootprint(
    projected.buildings,
    parsed.hotels,
    { ...center, osm_id: site.osm },
    proj,
  );
  return {
    f,
    sel,
    proj,
    ring: sel.building.xy[0],
    others: projected.buildings
      .filter((b) => b.id !== sel.building.id)
      .map((b) => b.xy[0]),
  };
}

test('every city has its hotel first, then venues by day', () => {
  for (const city of ['austin', 'dc', 'london']) {
    const s = sitesForCity(city);
    assert.equal(s[0].kind, 'lodging');
    assert.equal(s[0].key, city);
    // London's trip starts at Heathrow T5 on Day 1 (Demo C, 29 Oct 2026).
    assert.equal(s.length, city === 'london' ? 4 : 3);
    assert.deepEqual(
      s.slice(1).map((v) => v.day),
      city === 'london' ? [1, 2, 3] : [2, 3],
    );
    for (const v of s) assert.ok(v.anchors?.assembly, `${v.key} anchors`);
  }
  assert.deepEqual(
    sitesForCity('london').map((s) => [s.key, s.role]),
    [
      ['london', 'lodging'],
      ['london-heathrow-t5', 'arrival'],
      ['london-festival-hall', 'performance'],
      ['london-abbey', 'visit'],
    ],
  );
  assert.equal(
    siteOptionLabel(siteConfig('london-heathrow-t5')),
    'Heathrow T5 (Day 1, 07:30)',
  );
  assert.equal(siteConfig('london-heathrow-t5').timezone, 'Europe/London');
  assert.equal(siteNoun(siteConfig('london-heathrow-t5')), 'terminal');
  assert.equal(siteNoun(siteConfig('london-abbey')), 'venue');
  assert.equal(siteNoun(siteConfig('london')), 'hotel');
  assert.equal(
    siteOptionLabel(siteConfig('austin-long-center')),
    'Long Center (Day 2, 19:00)',
  );
  assert.equal(
    siteOptionLabel(siteConfig('austin')),
    'Fairmont Austin (hotel)',
  );
  assert.equal(siteConfig('nope'), null);
});

test('snapshot carries venue places, itinerary and per-venue safety points', () => {
  const s = tripTwinDemoSnapshot('austin', 'baseline', { elapsed: 0 });
  assert.deepEqual(
    s.places.map((p) => [p.kind, p.site_key]),
    [
      ['lodging', 'austin'],
      ['venue', 'austin-long-center'],
      ['venue', 'austin-capitol'],
    ],
  );
  assert.equal(s.itinerary.length, 2);
  assert.equal(s.itinerary[0].start_time, '19:00');
  for (const v of s.places.filter((p) => p.kind === 'venue'))
    assert.deepEqual(v.room_assignments, [], 'rooming only for lodging');
});

test('Demo B: nobody is dropped from the per-site counts', () => {
  const s = tripTwinDemoSnapshot('austin', 'b', { elapsed: 0 });
  const c = siteCounts(s.participants, sitesForCity('austin'));
  const sum =
    c.bySite.reduce((n, x) => n + x.n, 0) +
    c.between +
    c.elsewhere +
    c.notLocated;
  assert.equal(sum, 27);
  assert.equal(c.bySite.find((x) => x.key === 'austin-long-center').n, 20);
  assert.equal(c.bySite.find((x) => x.key === 'austin').n, 3);
  assert.equal(c.between, 2);
  assert.equal(c.notLocated, 1);
  assert.equal(
    siteCountsLine(c, 'austin-long-center'),
    'Group across 2 sites: Long Center 20 · Fairmont Austin 3 · between sites 2 · elsewhere 1 · not located 1 · of 27',
  );
});

test('anchors: deepest inside point, edge inside the wall, assembly outside', () => {
  // 100 m × 60 m box at the equator-ish (degrees ≈ metres / 111 km).
  const d = (m) => m / 111320;
  const ring = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: d(100) },
    { lat: d(60), lon: d(100) },
    { lat: d(60), lon: 0 },
  ];
  const a = computeAnchors(ring, [], { towardDeg: 0 });
  assert.ok(Math.abs(a.insideClearanceM - 30) < 2);
  assert.ok(a.assembly.lat > d(60) + d(40), 'north of the wall by ≥ 40 m');
  assert.ok(a.edge.lat < d(60) && a.edge.lat > d(48), 'edge 6–10 m inside');
});

test('an incident at another site is never hidden ("No incident" never shown)', async () => {
  const { assessSnapshot, deriveMode, withTripIncidents } =
    await import('./twinData.js');
  const { makeProjector } = await import('./twinData.js');
  const s = tripTwinDemoSnapshot('austin', 'a', { elapsed: 0 });
  const venue = s.places.find((p) => p.site_key === 'austin-long-center');
  const v = siteConfig('austin-long-center');
  const projector = makeProjector(v.center);
  const ring = [
    [-30, -30],
    [30, -30],
    [30, 30],
    [-30, 30],
  ];
  const a = assessSnapshot(s, { xy: ring, approximate: false }, projector, {
    reportedLabel: null,
    placeId: venue.id,
  });
  const base = deriveMode(a, {});
  assert.match(base.topLine, /^No incident reported/);
  const m = withTripIncidents(base, {
    snapshot: s,
    activePlaceId: venue.id,
    siteName: (id) => (id === venue.id ? 'Long Center' : 'Fairmont Austin'),
    rows: a.rows,
  });
  assert.equal(m.chip, 'INCIDENT · OTHER SITE');
  assert.doesNotMatch(m.topLine, /No incident/);
  assert.match(
    m.topLine,
    /^Smoke reported at Fairmont Austin, floor 9 \(hotel desk, not verified\) — \d+ at or above by phone estimate there/,
  );
  assert.equal(m.groups[0].key, 'elsewhere_above');
  assert.ok(m.groups[0].rows.length >= 2, 'M.R. and A.K. by phone estimate');
});

test('Heathrow T5: the recorded terminal footprint carries its anchors', () => {
  const site = siteConfig('london-heathrow-t5');
  const { f, sel, proj, ring, others } = footprint('london-heathrow-t5');
  assert.equal(sel.source, 'osm_id');
  assert.equal(sel.building.id, 'way/23231957');
  assert.equal(sel.approximate, false);
  // The pasted anchors are the capture script's (computeAnchors).
  assert.deepEqual(site.anchors, f.meta.anchors);
  const xy = (p) => proj.toXY(p.lat, p.lon);
  const A = site.anchors;
  // inside: deep in the terminal (room for indoor accuracy circles).
  assert.ok(pointInRing(xy(A.inside), ring));
  assert.ok(distanceToRing(xy(A.inside), ring) >= 40);
  // edge: 6–10 m inside the wall, on the forecourt side.
  assert.ok(pointInRing(xy(A.edge), ring));
  const e = distanceToRing(xy(A.edge), ring);
  assert.ok(e >= 6 && e <= 10, `edge ${e.toFixed(1)} m inside`);
  // assembly: outdoors, 40–80 m off the wall, on no other building, west
  // (the arrivals forecourt and coach pick-up side).
  const S = xy(A.assembly);
  assert.ok(!pointInRing(S, ring));
  const off = distanceToRing(S, ring);
  assert.ok(off >= 40 && off <= 80, `assembly ${off.toFixed(1)} m out`);
  assert.ok(!others.some((o) => pointInRing(S, o)), 'on no other building');
  const [ix, iy] = xy(A.inside);
  const bearing =
    ((Math.atan2(S[0] - ix, S[1] - iy) * 180) / Math.PI + 360) % 360;
  assert.ok(Math.abs(bearing - 270) <= 50, `assembly bearing ${bearing}`);
  // The site centre is the terminal's own (the capture's centre).
  assert.ok(pointInRing(xy(site.center), ring));
});

test('Heathrow T5 reads as the airport: a 2.75 km map with runways, taxiways and aprons', async () => {
  const {
    AIRSIDE_DETAIL_M,
    buildTwinQuery,
    clipToDisc,
    haversineM,
    siteRadiusM,
    TWIN_RADIUS_M,
  } = await import('./twinData.js');
  const t5 = siteConfig('london-heathrow-t5');
  const R = siteRadiusM(t5);
  assert.equal(R, 2750);
  // Every other site keeps the 400 m map and its query, word for word.
  for (const s of [
    ...sitesForCity('austin'),
    ...sitesForCity('dc'),
    ...sitesForCity('london'),
  ])
    if (s.key !== t5.key) {
      assert.equal(siteRadiusM(s), TWIN_RADIUS_M, s.key);
      assert.equal(s.airside, undefined, s.key);
    }
  const plain = buildTwinQuery(t5.center, 400);
  assert.doesNotMatch(plain, /aeroway/);
  // Without airside the radius still caps at 800 m, as before.
  const capped = buildTwinQuery(t5.center, R);
  assert.match(capped, /around:800,/);
  assert.doesNotMatch(capped, /around:2750,|aeroway/);
  const q = buildTwinQuery(t5.center, R, { airside: true });
  assert.match(
    q,
    /way\(around:2750,[^)]+\)\["aeroway"~"\^\(runway\|taxiway\|apron\)\$"\]/,
  );
  assert.match(
    q,
    /way\(around:450,[^)]+\)\["highway"/,
    'minor ways near the terminal only',
  );
  // The recorded fixture: its radius, the satellites, the airside.
  const { f, proj } = footprint(t5.key);
  assert.equal(f.meta.radius_m, R);
  // Far buildings are footprints only (outline + `building`): drawn low
  // and faint like any unmapped height; near ones keep their tags.
  assert.equal(f.meta.thinned.beyondM, AIRSIDE_DETAIL_M);
  assert.ok(f.meta.thinned.buildings > 0);
  const center = f.meta.hotel.center;
  for (const el of f.elements)
    if (el.type === 'way' && el.tags?.building && Array.isArray(el.geometry)) {
      const far = el.geometry.every(
        (p) => haversineM(center, p) > AIRSIDE_DETAIL_M + 400,
      );
      if (far)
        assert.deepEqual(Object.keys(el.tags), ['building'], `way/${el.id}`);
    }
  const parsed = parseOverpassElements(f.elements);
  const ids = new Set(parsed.buildings.map((b) => b.id));
  for (const id of ['way/23479613', 'way/23479729', 'way/108056983'])
    assert.ok(ids.has(id), `${id} (T5B, T5C, Sofitel) recorded`);
  const kinds = {};
  for (const a of parsed.aeroways) kinds[a.kind] = (kinds[a.kind] || 0) + 1;
  assert.ok(
    kinds.runway >= 1 && kinds.taxiway >= 10 && kinds.apron >= 1,
    JSON.stringify(kinds),
  );
  for (const a of parsed.aeroways.filter((x) => x.kind !== 'apron'))
    assert.ok(a.widthM > 0 && a.coords.length >= 2, a.id);
  // A runway crossing the disc keeps only its inside part.
  const runway = parsed.aeroways.find((a) => a.kind === 'runway');
  for (const piece of clipToDisc(runway.coords, proj, R + 60))
    for (const p of piece)
      assert.ok(Math.hypot(...proj.toXY(p.lat, p.lon)) <= R + 61);
  // Other fixtures have no airside.
  assert.deepEqual(
    parseOverpassElements(footprint('london-abbey').f.elements).aeroways,
    [],
  );
});

test('clipToDisc: a line through the disc keeps its chord; one outside is dropped', async () => {
  const { clipToDisc } = await import('./twinData.js');
  const proj = makeProjector({ lat: 0, lon: 0 });
  const p = (x, y) => proj.toLL(x, y);
  const through = clipToDisc([p(-200, 0), p(200, 0)], proj, 100);
  assert.equal(through.length, 1);
  const [a, b] = through[0].map((q) => proj.toXY(q.lat, q.lon));
  assert.ok(Math.abs(a[0] + 100) < 1e-6 && Math.abs(b[0] - 100) < 1e-6);
  assert.deepEqual(clipToDisc([p(-200, 150), p(200, 150)], proj, 100), []);
  // In, out, in again: two pieces.
  const twice = clipToDisc([p(0, 0), p(0, 300), p(10, 0)], proj, 100);
  assert.equal(twice.length, 2);
});
