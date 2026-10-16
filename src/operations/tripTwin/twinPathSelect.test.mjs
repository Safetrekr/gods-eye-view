// Phase 9: edit any drawn path — waypoints seeded from its shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineM } from './twinData.js';
import {
  seedWaypoints,
  pathLengthM,
  pathVia,
  alongM,
  coversEnds,
} from './twinCustomPaths.js';

const L = (lat, lon) => ({ lat, lon });

test('a short straight path needs no waypoints', () => {
  const g = Array.from({ length: 20 }, (_, i) => L(30.26 + i * 0.0002, -97.74));
  assert.ok(pathLengthM(g) < 500);
  assert.deepEqual(seedWaypoints(g), []);
});

test('a straight path over 500 m keeps its middle (O16)', () => {
  const g = Array.from({ length: 40 }, (_, i) => L(30.26 + i * 0.0002, -97.74));
  const w = seedWaypoints(g);
  assert.equal(w.length, 1);
  assert.ok(Math.abs(alongM(g, w[0]) - pathLengthM(g) / 2) < 30);
});

test('via lists the streets a path follows, in order, not crossings', () => {
  const g = [
    ...Array.from({ length: 20 }, (_, i) => L(30.26 + i * 0.0002, -97.74)),
    ...Array.from({ length: 20 }, (_, i) =>
      L(30.264, -97.74 + (i + 1) * 0.0002),
    ),
  ];
  const roads = [
    { name: 'Congress Ave', coords: [L(30.259, -97.74), L(30.2645, -97.74)] },
    { name: '6th St', coords: [L(30.264, -97.741), L(30.264, -97.735)] },
    // A cross street the path only touches once.
    { name: '3rd St', coords: [L(30.2621, -97.742), L(30.2621, -97.7405)] },
  ];
  assert.deepEqual(pathVia(g, roads), ['Congress Ave', '6th St']);
});

test('an L-shaped path keeps its corner', () => {
  const g = [
    ...Array.from({ length: 20 }, (_, i) => L(30.26 + i * 0.0002, -97.74)),
    ...Array.from({ length: 20 }, (_, i) =>
      L(30.264, -97.74 + (i + 1) * 0.0002),
    ),
  ];
  const w = seedWaypoints(g);
  assert.equal(w.length, 1);
  assert.ok(haversineM(w[0], L(30.264, -97.74)) < 60, 'at the corner');
});

test('a wiggly path gets at most 8, spaced, never at the ends', () => {
  const g = Array.from({ length: 400 }, (_, i) =>
    L(30.26 + i * 0.0001, -97.74 + Math.sin(i / 6) * 0.002),
  );
  const w = seedWaypoints(g, { max: 8, minGapM: 150 });
  assert.ok(w.length > 0 && w.length <= 8);
  for (let i = 1; i < w.length; i += 1)
    assert.ok(haversineM(w[i - 1], w[i]) >= 150);
  assert.ok(
    haversineM(w[0], g[0]) >= 150 && haversineM(w.at(-1), g.at(-1)) >= 150,
  );
});

test('incident path titles rank Main / Alternate; primary is the rally point (O9)', async () => {
  const { pathCards } = await import('./twinHud.js');
  const g = [L(30.26, -97.74), L(30.262, -97.74)];
  const cards = pathCards([
    { kind: 'primary', distanceM: 400, walk: [6, 8], geometry: g },
    { kind: 'alternate', distanceM: 520, walk: [8, 10], geometry: g },
  ]);
  assert.match(cards[0].title, /^Main path to Rally point \(primary\)/);
  assert.match(cards[1].title, /^Alternate path to Rally point \(primary\)/);
  assert.equal(cards[1].kind, 'alternate');
});

test('copied path text names the variant and keeps the full caveat (O3)', async () => {
  const { pathSummaryText } = await import('./twinRoutes.js');
  const t = pathSummaryText({
    title: 'Alternate path to Rally point (primary)',
    stamp: '21:32',
    from: 'Fairmont Austin',
    to: 'Rally point (primary)',
    shown: {
      kicker: 'Alternate walking path',
      metric: '590 m · 10–12 min',
      metricNote: 'group pace',
      warnings: ['After dark now (21:32 local) — lighting not checked'],
    },
  });
  assert.match(
    t,
    /^Alternate path to Rally point \(primary\) — suggested, unverified/,
  );
  assert.match(t, /Flag: After dark now/);
  assert.match(
    t,
    /not checked for closures, crowds, lighting, crime or damage\.$/,
  );
  for (const w of [/\bsafe\b/i, /all clear/i, /\bcorridor\b/i, /\broute\b/i])
    assert.doesNotMatch(t, w);
});

test('a saved path with the same ends fades the suggestion; others do not', () => {
  const ends = { from: L(30.26, -97.74), to: L(30.265, -97.745) };
  const same = {
    points: [L(30.2601, -97.7401), L(30.263, -97.742), L(30.2649, -97.7449)],
  };
  const other = { points: [L(30.26, -97.74), L(30.27, -97.75)] };
  const reversed = { points: [ends.to, ends.from] };
  assert.equal(coversEnds(same, ends), true);
  assert.equal(coversEnds(other, ends), false);
  assert.equal(coversEnds(reversed, ends), false);
  assert.equal(coversEnds(same, null), false);
});
