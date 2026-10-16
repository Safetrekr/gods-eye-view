import test from 'node:test';
import assert from 'node:assert/strict';
import { bannedWordHits } from './twinData.js';
import { driveMinutes, groupCentre, routeCards } from './twinRoutes.js';

test('drive time is a range with no live traffic', () => {
  assert.deepEqual(driveMinutes(300), [5, 7]);
  assert.equal(driveMinutes(undefined), null);
});

test('group centre needs 3 current people at the site', () => {
  const row = (lat, lng, current = true) => ({
    pos: { current },
    person: { coordinates: { lat, lng } },
  });
  const site = { lat: 30, lon: -97 };
  assert.equal(groupCentre([row(30, -97), row(30.0001, -97)], site), null);
  const c = groupCentre(
    [row(30, -97), row(30.0002, -97), row(30.0001, -97.0001), row(31, -97)],
    site,
  );
  assert.equal(c.n, 3, 'the far one is not at this site');
  assert.equal(c.lat, 30.0001);
});

test('route cards say suggested and unverified; driving says no traffic', () => {
  const walk = routeCards(
    [{ kind: 'primary', distanceM: 1904, walk: [30, 39], hazard: {} }],
    { profile: 'foot', fromLabel: 'Fairmont Austin', toLabel: 'Hospital' },
    { pace: { band: 'moderate', pct: 25, factor: 1.25, simulated: true } },
  );
  assert.equal(
    walk[0].title,
    'Walk from Fairmont Austin to Hospital · 1.9 km · walk 30–39 min (group pace)',
  );
  assert.ok(
    walk[0].lines.includes(
      'SIMULATED moderate rain: allow +25% walking time → 38–49 min',
    ),
  );
  const drive = routeCards(
    [{ kind: 'primary', distanceM: 2000, drive: [3, 5], hazard: {} }],
    { profile: 'car', toLabel: 'Hospital' },
    { pace: { band: 'moderate', pct: 25, factor: 1.25 } },
  );
  assert.match(drive[0].title, /drive 3–5 min \(no live traffic\)$/);
  assert.ok(
    !drive[0].lines.some((l) => /rain/.test(l)),
    'no rain allowance when driving',
  );
  assert.deepEqual(bannedWordHits(JSON.stringify([walk, drive])), []);
});
