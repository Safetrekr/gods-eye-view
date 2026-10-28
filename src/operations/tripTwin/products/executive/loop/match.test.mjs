// SafeTrekr Executive B1: the per-leg match (EP-35 §§3, 9 group 4).
// matchLegs reproduces every fixture match (leg, distance within the
// fixture's rounding, window), every banner and every mechanical
// not-raised reason, over all 214 bundles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  doneByPosition,
  legWindow,
  matchLegs,
  OPENS_WITHIN_H,
  STALE_AFTER_H,
} from './match.js';
import { raiseFor } from './loopPolicy.js';
import { gridDigits, mgrs, mgrsDigits } from '../format.js';
import { buildTimeline, fold } from '../timeline.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
/** A bundle as it stands after all its members arrived. */
const final = (b) =>
  (b.history || []).reduce((x, { at: _at, ...p }) => ({ ...x, ...p }), {
    ...b,
  });
const bundles = Object.values(day.bundles);
const MECHANICAL = [
  'no leg within reach',
  'outside window',
  'region, banner only',
];

test('every fixture match: same leg, distance within 5 m (or named), same window', () => {
  const ids = Object.keys(day.expected.matches);
  assert.equal(ids.length, 11);
  for (const id of ids) {
    const exp = day.expected.matches[id];
    const { match } = matchLegs(
      final(day.bundles[id]),
      day.legs,
      day.people,
      exp.matched_at,
    );
    assert.ok(match, `${id} matches`);
    assert.equal(match.leg_id, exp.leg_id, id);
    assert.equal(match.window, exp.window, id);
    if (exp.distance_m === 'named') assert.equal(match.distance, 'named', id);
    else
      assert.ok(
        Math.abs(match.distance_m - exp.distance_m) <= 5,
        `${id} ${match.distance_m} vs ${exp.distance_m}`,
      );
  }
});

test('no other bundle matches at ingest; every banner and mechanical reason reproduces', () => {
  for (const b of bundles) {
    if (day.expected.matches[b.bundle_id]) continue;
    const r = matchLegs(final(b), day.legs, day.people, b.ingested_at);
    assert.equal(r.match, null, `${b.bundle_id} must not match`);
    const banner = day.expected.banners[b.bundle_id];
    assert.deepEqual(r.banner, banner ?? null, `${b.bundle_id} banner`);
    if (b.file !== 'mentions' && MECHANICAL.includes(b.intake_reason))
      assert.equal(r.reason, b.intake_reason, b.bundle_id);
    if (b.file !== 'mentions' && /^stale/.test(b.intake_reason || ''))
      assert.match(r.reason, /^stale, observed \d+ h ago$/);
    if (b.related_to) assert.equal(r.reason, 'linked', b.bundle_id);
  }
});

test('KESTREL: the march hits Lunch 1230L 400 m N in window; the same item reads closed after the window', () => {
  const march = final(day.bundles['b-reg-048']);
  const hit = matchLegs(
    march,
    day.legs,
    day.people,
    '2026-10-27T15:55:00Z',
  ).match;
  assert.equal(hit.leg_id, 'l-kestrel-lunch');
  assert.equal(hit.distance_m, 400);
  assert.equal(hit.bearing, 'N');
  assert.equal(hit.window, 'in window');
  assert.equal(hit.time_to_exposure_s, 5700);
  // The lunch window closes at end + 1 h (2000Z); two hours on it reads closed.
  const [, we] = legWindow(day.legs['l-kestrel-lunch']);
  assert.equal(new Date(we).toISOString(), '2026-10-27T20:00:00.000Z');
  const late = matchLegs(march, day.legs, day.people, '2026-10-27T22:00:00Z');
  assert.equal(
    late.hits.find((h) => h.leg_id === 'l-kestrel-lunch').window,
    'closed',
  );
  assert.notEqual(late.match?.leg_id, 'l-kestrel-lunch');
  // Earlier than six hours before the window it is outside, not a match.
  const early = matchLegs(march, day.legs, day.people, '2026-10-27T06:00:00Z');
  assert.equal(
    early.hits.find((h) => h.leg_id === 'l-kestrel-lunch').window,
    'opens in 9 h',
  );
  assert.ok(OPENS_WITHIN_H === 6 && STALE_AFTER_H === 4);
});

test('a region item is a banner, never a match, and never gets a grid', () => {
  for (const id of ['b-intel-092', 'b-reg-007', 'b-reg-031', 'b-intel-094']) {
    const b = final(day.bundles[id]);
    const r = matchLegs(b, day.legs, day.people, b.ingested_at);
    assert.equal(r.match, null);
    assert.ok(r.banner?.length, id);
    assert.equal(r.reason, 'region, banner only');
    assert.equal(mgrs(b.geo.lat, b.geo.lon, b.accuracy_m ?? 0, 'region'), null);
    assert.equal(b.mgrs, null, `${id} carries no grid`);
  }
});

test('a linked bundle (the agenda leak, the road closure, the bus detour) is never matched', () => {
  for (const id of ['b-m-046', 'b-reg-049', 'b-reg-050']) {
    const b = final(day.bundles[id]);
    const r = matchLegs(b, day.legs, day.people, '2026-10-27T18:05:00Z');
    assert.equal(r.reason, 'linked', id);
    assert.equal(r.match, null);
  }
});

test('mentions match by subject and claimed leg; chatter and impersonation never do', () => {
  const threat = matchLegs(
    day.bundles['b-m-047'],
    day.legs,
    day.people,
    '2026-10-27T18:00:00Z',
  ).match;
  assert.deepEqual(
    [threat.leg_id, threat.distance, threat.window, threat.time_to_exposure_s],
    ['l-atlas-keynote', 'named', 'in window', 5400],
  );
  for (const id of ['b-m-022', 'b-m-032']) {
    const b = day.bundles[id];
    assert.equal(
      matchLegs(b, day.legs, day.people, b.ingested_at).match,
      null,
      id,
    );
  }
  // A leak about tomorrow is outside the window, never matched today.
  const leak = day.bundles['b-m-017'];
  const r = matchLegs(leak, day.legs, day.people, leak.ingested_at);
  assert.equal(r.reason, 'outside window');
});

test('the hazard edge: the storm line is 30 km W of the ramp, in window for the ground move', () => {
  const storm = day.bundles['b-intel-110'];
  const r = matchLegs(storm, day.legs, day.people, storm.ingested_at);
  assert.equal(r.match.leg_id, 'l-swift-ground-1');
  assert.ok(Math.abs(r.match.distance_m - 30000) < 50);
  assert.equal(r.match.callsign, 'SWIFT 1–2');
  assert.equal(raiseFor(day.people['p-swift1'], storm), 'advisory');
});

test('the raise rule after a hit: DETAIL P1–P3 and every mention, REMOTE P1–P2, MONITORED P1', () => {
  const b = (p, extra = {}) => ({
    operational_priority: p,
    source_kind: 'official',
    ...extra,
  });
  const who = (protection) => ({ protection, posture: 'ROUTINE' });
  assert.equal(raiseFor(who('DETAIL'), b('P3')), 'raise');
  assert.equal(
    raiseFor(who('DETAIL'), b('P4', { source_kind: 'mention' })),
    'raise',
  );
  assert.equal(raiseFor(who('DETAIL'), b('P4')), null);
  assert.equal(raiseFor(who('REMOTE'), b('P2')), 'raise');
  assert.equal(raiseFor(who('REMOTE'), b('P3')), 'watch');
  assert.equal(
    raiseFor({ protection: 'REMOTE', posture: 'ELEVATED' }, b('P3')),
    'raise',
  );
  assert.equal(raiseFor(who('MONITORED'), b('P1')), 'raise');
  assert.equal(raiseFor(who('MONITORED'), b('P2')), null);
  assert.equal(
    raiseFor(who('MONITORED'), b('P2', { hazard_area: true })),
    'advisory',
  );
  assert.equal(
    raiseFor(who('DETAIL'), b('P1', { duplicate_of: 'b-intel-088' })),
    null,
  );
});

test('MGRS digits never exceed what a fix’s accuracy allows', () => {
  for (const f of day.fixes) {
    const g = mgrs(f.lat, f.lon, f.accuracy_m, f.precision);
    const allowed = mgrsDigits(f.accuracy_m, f.precision) ?? 0;
    assert.ok(gridDigits(g) <= allowed, `${f.id} ${f.accuracy_m} m → ${g}`);
  }
  for (const b of bundles)
    if (b.mgrs)
      assert.ok(
        gridDigits(b.mgrs) <= (mgrsDigits(b.accuracy_m, b.geo_precision) ?? 0),
        b.bundle_id,
      );
});

test('done by position: KESTREL’s two fixes inside the Barton Springs Rd side land at 1715:30Z', () => {
  const where = day.events.find((e) => e.id === 'e-0013').destination;
  const fixes = day.fixes.filter((f) => f.person_id === 'p-kestrel');
  assert.equal(doneByPosition(fixes, where), '2026-10-27T17:15:30Z');
  // The car stops 12 m from the entrance at 1713:10Z: in the car, not yet there.
  assert.equal(
    fixes.find((f) => f.at === '2026-10-27T17:13:10Z').activity,
    'stopped',
  );
  assert.equal(
    doneByPosition(
      fixes.filter((f) => f.at < '2026-10-27T17:15:00Z'),
      where,
    ),
    null,
  );
});

test('why raised: the engine’s line equals the fixture’s for every raised situation but the doxx', () => {
  const { loop } = fold(day, buildTimeline(day));
  for (const exp of day.expected.situations) {
    const s = loop.situations[exp.sit_id];
    assert.equal(s.why_raised, exp.why_raised, exp.sit_id);
    // The doxx line in mentions.json reads "in window" where EP-35's
    // template gives minutes to exposure; the data's line is shown.
    if (exp.sit_id === 's-wren-01')
      assert.equal(
        s.why_raised_engine,
        'WREN · Kennedy Center 1930L · named · 87 min to exposure',
      );
    else assert.equal(s.why_raised_engine, exp.why_raised, exp.sit_id);
  }
});
