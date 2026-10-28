// SafeTrekr Executive B1: EP-36 §3's formatters, its examples and its rule
// tests (Z and L agree, no grid beyond the accuracy, no pin for a region,
// seconds never render), and EP-36 §5's banned words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mgrsLib from 'mgrs';
import {
  bluf,
  counter,
  distance,
  dtg,
  gridDigits,
  groupCallsign,
  ladder,
  legTitle,
  lz,
  mainRow,
  mgrs,
  mgrsDigits,
  place,
  salute,
  sitrep,
  watchTime,
  whyRaised,
  zl,
} from './format.js';
import { assertCap, assertPlain, plainBreach } from './words.js';

const day = JSON.parse(
  readFileSync(new URL('./data/day.json', import.meta.url), 'utf8'),
);
const toPoint = mgrsLib.toPoint || mgrsLib.default.toPoint;
const AUSTIN = 'America/Chicago';
const DC = 'America/New_York';
const LONDON = 'Europe/London';

test('dtg: DDHHMMZ MON YY from UTC (EP-36 example)', () => {
  assert.equal(dtg('2026-10-27T14:35Z'), '271435Z OCT 26');
  assert.equal(dtg('2026-10-28T01:00:00Z'), '280100Z OCT 26');
  assert.equal(dtg('2026-10-27T09:35:00-05:00'), '271435Z OCT 26');
});

test('lz and zl: local first on MAIN and phones, Zulu first on Verify (EP-36 examples)', () => {
  assert.equal(lz('2026-10-27T17:30:00Z', AUSTIN), '1230L (1730Z)');
  assert.equal(zl('2026-10-27T17:30:00Z', AUSTIN), '1730Z (1230L)');
  assert.equal(lz('2026-10-27T19:30:00Z', LONDON), '1930L (1930Z)');
  assert.equal(watchTime('2026-10-27T18:06:00Z'), '1806Z');
});

test('rule: Z and L agree across Austin −5, DC −4 and London 0 on 27 Oct 2026', () => {
  for (const [tz, off] of [
    [AUSTIN, -5],
    [DC, -4],
    [LONDON, 0],
  ])
    for (let h = 0; h < 24; h += 1) {
      const at = Date.UTC(2026, 9, 27, h, 17);
      const [l, z] = lz(at, tz).match(/\d{4}/g).map(Number);
      assert.equal(Math.floor(z / 100), h);
      assert.equal(
        (((Math.floor(l / 100) - h - off) % 24) + 24) % 24,
        0,
        `${tz} ${h}Z`,
      );
      assert.equal(l % 100, 17);
      assert.equal(
        zl(at, tz),
        `${String(z).padStart(4, '0')}Z (${String(l).padStart(4, '0')}L)`,
      );
    }
});

test('rule: seconds never render', () => {
  const at = '2026-10-27T16:05:59Z';
  for (const s of [dtg(at), lz(at, AUSTIN), zl(at, DC), watchTime(at)])
    assert.doesNotMatch(s, /59|:/);
  assert.equal(watchTime(at), '1605Z');
});

test('mgrs: digits follow accuracy (EP-36 table and examples)', () => {
  assert.equal(mgrsDigits(2), 10);
  assert.equal(mgrsDigits(20), 8);
  assert.equal(mgrsDigits(200), 6);
  assert.equal(mgrsDigits(2000), 4);
  assert.equal(mgrsDigits(2001), null);
  assert.equal(mgrsDigits(10, 'region'), null);
  // A point inside the verified site's 10 m cell, from the grid itself.
  const [lon, lat] = toPoint('14RPU21354467');
  const p = [lat + 0.00004, lon + 0.00004];
  assert.equal(mgrs(...p, 10), '14R PU 2135 4467');
  assert.equal(mgrs(...p, 40), '14R PU 213 446');
  assert.equal(mgrs(...p, 3000), null);
});

test('mgrs reproduces every roster place grid at its own accuracy', () => {
  for (const pl of Object.values(day.places))
    assert.equal(
      mgrs(pl.lat, pl.lon, pl.accuracy_m, pl.precision),
      pl.mgrs,
      pl.place_id,
    );
});

test('rule: mgrs never returns more digits than the accuracy allows; a region never gets a grid', () => {
  for (const acc of [
    1, 2, 3, 10, 20, 21, 50, 199, 200, 201, 1500, 2000, 2001, 20000,
  ])
    for (const f of day.fixes.slice(0, 60)) {
      const g = mgrs(f.lat, f.lon, acc, f.precision);
      assert.ok(
        gridDigits(g) <= (mgrsDigits(acc, f.precision) ?? 0),
        `${acc} m → ${g}`,
      );
    }
  for (const f of day.fixes) {
    const g = mgrs(f.lat, f.lon, f.accuracy_m, f.precision);
    assert.equal(
      gridDigits(g),
      mgrsDigits(f.accuracy_m, f.precision) ?? 0,
      f.id,
    );
  }
  for (const b of Object.values(day.bundles).filter(
    (x) => x.geo_precision === 'region' && x.geo,
  ))
    assert.equal(
      mgrs(b.geo.lat, b.geo.lon, b.accuracy_m, 'region'),
      null,
      b.bundle_id,
    );
});

test('place: name, then grid; the grid left out when there is none', () => {
  assert.equal(
    place(day.places['pl-fairmont-austin']),
    'Fairmont Austin · 14R PU 2126 4844',
  );
  assert.equal(
    place({
      name: 'Austin',
      lat: 30.27,
      lon: -97.74,
      accuracy_m: 10000,
      precision: 'region',
    }),
    'Austin',
  );
});

test('bluf: both EP-20 BLUFs pass; 91 characters, a stop, a second line or a banned word throw', () => {
  assert.equal(
    bluf('Arrive 1215L by the Barton Springs Rd side; avoid W Riverside Dr'),
    'Arrive 1215L by the Barton Springs Rd side; avoid W Riverside Dr',
  );
  bluf('Recommend delay departure 20 min; use the Belvedere Rd entrance');
  bluf('1215L: arrive by the Barton Springs Rd side');
  assert.throws(() => bluf(`A${'b'.repeat(90)}`), /bluf: 91 > 90/);
  assert.doesNotThrow(() => bluf(`A${'b'.repeat(89)}`));
  assert.throws(() => bluf('Arrive 1215L by the south side.'), /full stop/);
  assert.throws(() => bluf('arrive 1215L'), /capital or a time/);
  assert.throws(
    () => bluf('Arrive 1215L\nby the south side'),
    /more than one line/,
  );
  assert.throws(() => bluf('Stay where it is safe'), /banned word "safe"/);
});

test('salute: six kickers in order, empty as —, TIME Zulu first (ATLAS 3, beat 2)', () => {
  const ev = day.events.find((e) => e.type === 'salute.file');
  assert.equal(ev.time, '2026-10-27T18:12:00Z');
  assert.deepEqual(salute({ ...ev, tz: LONDON }), ev.card);
  assert.deepEqual(
    salute({ ...ev, time: '271812Z OCT 26', tz: LONDON }),
    ev.card,
  );
  assert.deepEqual(
    salute({
      size: '1 male',
      activity: null,
      location: null,
      unit: '',
      time: null,
      equipment: 'phone camera',
    }),
    [
      'SIZE 1 male',
      'ACTIVITY —',
      'LOCATION —',
      'UNIT —',
      'TIME —',
      'EQUIPMENT phone camera',
    ],
  );
});

test('sitrep: always six slots, — for empty, ≤ 60 each (EP-36 example)', () => {
  assert.equal(
    sitrep({
      WHERE: 'Park Plaza Waterloo',
      STATUS: 'stood down 2105Z',
      'LAST CONTACT': 'ATLAS 6 2105Z',
      'NEXT EVENT': 'depart 0800L',
      'OPEN ITEMS': 'none',
      SIGNED: 'VALE 2107Z',
    }),
    'WHERE Park Plaza Waterloo · STATUS stood down 2105Z · LAST CONTACT ATLAS 6 2105Z · NEXT EVENT depart 0800L · OPEN ITEMS none · SIGNED VALE 2107Z',
  );
  assert.equal(sitrep({}).split(' · ').length, 6);
  assert.match(
    sitrep({ LAST_CONTACT: 'KESTREL 1607Z' }),
    /LAST CONTACT KESTREL 1607Z/,
  );
  assert.throws(() => sitrep({ STATUS: 'x'.repeat(61) }), /sitrepSlot/);
  // Every SITREP card in the day passes.
  for (const e of day.events.filter((x) => x.type === 'sitrep.draft' && x.card))
    sitrep(e.card);
});

test('ladder: rungs with local times; the DL word on DETAIL; EXPIRED ends it; the call-back timer', () => {
  const t = (hhmm) =>
    `2026-10-27T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, '0')}:${hhmm.slice(2)}:00Z`;
  assert.equal(
    ladder({
      tz: AUSTIN,
      rungs: {
        delivered: t('1039'),
        read: t('1041'),
        accepted: t('1044'),
        done: t('1218'),
      },
    }),
    'DELIVERED 1039L · READ 1041L · ACCEPTED 1044L · DONE 1218L',
  );
  assert.equal(
    ladder({
      tz: LONDON,
      rungs: {
        delivered: '2026-10-27T18:08:08Z',
        read: '2026-10-27T18:09:00Z',
      },
      dl: 'nonconcur',
      dlAt: '2026-10-27T18:14:00Z',
    }),
    'DELIVERED 1808L · READ 1809L · NON-CONCUR 1814L · DONE —',
  );
  assert.equal(
    ladder({
      tz: AUSTIN,
      rungs: { delivered: t('1039'), read: t('1041') },
      expiredAt: t('1400'),
    }),
    'DELIVERED 1039L · READ 1041L · EXPIRED 1400L',
  );
  assert.equal(
    ladder({ callback: { minutes: 10 } }),
    'NO READ · 10 MIN · CALLING',
  );
});

test('counter: the EP-36 line; closed only when > 0; the inequalities assert', () => {
  assert.equal(
    counter({ in: 214, matched: 11, raised: 6, pushed: 4, closed: 6 }),
    '214 in (intake + partner feeds) · 11 matched · 6 raised · 4 pushed · 6 closed',
  );
  assert.equal(
    counter({ in: 186, matched: 7, raised: 2, pushed: 0, closed: 0 }),
    '186 in (intake + partner feeds) · 7 matched · 2 raised · 0 pushed',
  );
  assert.equal(
    counter({ in: 186, matched: 7, raised: 2, pushed: 0, closed: 2 }),
    '186 in (intake + partner feeds) · 7 matched · 2 raised · 0 pushed · 2 closed',
  );
  assert.throws(
    () => counter({ in: 5, matched: 6, raised: 1, pushed: 0, closed: 0 }),
    /inequality/,
  );
  assert.throws(
    () => counter({ in: 9, matched: 6, raised: 1, pushed: 2, closed: 0 }),
    /inequality/,
  );
  assert.throws(
    () => counter({ in: 9, matched: 6, raised: 1, pushed: 0, closed: 2 }),
    /inequality/,
  );
});

test('mainRow: the EP-36 rows; ≤ 110; never a grade or a name', () => {
  const lunch = day.legs['l-kestrel-lunch'];
  assert.equal(
    mainRow({
      callsign: 'KESTREL',
      leg: lunch.main_label,
      short: 'Reroute: Barton Springs Rd side',
      state: 'ACCEPTED',
      tz: lunch.tz,
      nextUpdateAt: '2026-10-27T17:15:00Z',
    }),
    'KESTREL · Lunch 1230L · Reroute: Barton Springs Rd side · ACCEPTED · next update 1215L',
  );
  assert.equal(
    mainRow({
      callsign: 'ATLAS',
      leg: 'Keynote 1930L',
      dl: { answer: 'nonconcur', plan: 'original plan, +1 post north door' },
      tz: LONDON,
      nextUpdateAt: '2026-10-27T19:15:00Z',
    }),
    'ATLAS · Keynote 1930L · DL: NON-CONCUR · original plan, +1 post north door · next update 1915L',
  );
  assert.throws(
    () =>
      mainRow({
        callsign: 'KESTREL',
        leg: 'Lunch 1230L',
        short: 'x'.repeat(100),
        state: 'READ',
      }),
    /mainRow/,
  );
  assert.throws(
    () =>
      mainRow({
        callsign: 'ATLAS',
        leg: 'Keynote 1930L',
        short: 'F3 post',
        state: 'READ',
      }),
    /grade/,
  );
  assert.throws(
    () =>
      mainRow({
        callsign: 'WREN',
        leg: 'Kennedy Center 1930L',
        short: 'Isla Halden',
        state: 'READ',
        names: ['Isla Halden'],
      }),
    /name/,
  );
  assert.throws(
    () =>
      mainRow({
        callsign: 'ATLAS',
        leg: 'Keynote 1930L',
        short: 'hostile crowd',
        state: 'READ',
      }),
    /hostile/,
  );
});

test('whyRaised: EP-35 §3 examples; distance in metres under 1 km, else km', () => {
  assert.equal(
    whyRaised({
      callsign: 'KESTREL',
      title: 'Lunch 1230L Long Center',
      distanceM: 400,
      bearing: 'N',
      window: 'in window',
    }),
    'KESTREL · Lunch 1230L Long Center · 400 m N · in window',
  );
  assert.equal(
    whyRaised({
      callsign: 'ATLAS',
      title: 'Keynote 1930L',
      named: true,
      window: 'in window',
      timeToExposureS: 5400,
    }),
    'ATLAS · Keynote 1930L · named · 90 min to exposure',
  );
  assert.equal(
    whyRaised({
      callsign: 'SWIFT 1–2',
      title: 'Hotel → IAD 2030L',
      hazard: 'storm line',
      distanceM: 29999,
      window: 'in window',
    }),
    'SWIFT 1–2 · Hotel → IAD 2030L · storm line 30 km · in window',
  );
  assert.equal(distance(664), '660 m');
  assert.equal(distance(1150), '1.1 km');
  assert.equal(distance(29999), '30 km');
  assert.equal(
    legTitle(day.legs['l-kestrel-lunch']),
    'Lunch 1230L Long Center',
  );
  assert.equal(
    legTitle(day.legs['l-atlas-hotel']),
    'Park Plaza London Waterloo',
  );
  assert.equal(legTitle(day.legs['l-swift-ground-1']), 'Hotel → IAD 2030L');
  assert.equal(groupCallsign(['SWIFT 1', 'SWIFT 2']), 'SWIFT 1–2');
  assert.equal(groupCallsign(['KESTREL', 'HARRIER']), 'KESTREL');
});

test('banned words (EP-36 §5): each is caught; the listed exceptions pass', () => {
  for (const s of [
    'Stay safe',
    'Proceed safely',
    'All clear at 1400L',
    'Area secured',
    'Flagged by AI',
    'An A.I. score',
    'Sent automatically',
    'Detected by the system',
    'A tactical team',
    'Please reply',
    'We believe so',
    'We think so',
    'Urgent reply',
    'Reply ASAP',
    'Leave immediately',
    'Track the car',
    'Tracking on',
    'The target left',
    'A suspect seen',
    'Real-time feed',
    'Guaranteed arrival',
    'Reply now!',
    'An alert went out',
  ])
    assert.ok(plainBreach(s), s);
  for (const s of [
    'NWS alert areas on',
    'Evacuate via Belvedere Rd',
    'Operated with SafeTrekr',
    'An official alert for the county',
    'She said no',
    'Tracker on V1',
  ])
    assert.equal(plainBreach(s), null, s);
  assert.equal(plainBreach('A hostile crowd'), null);
  assert.equal(plainBreach('A hostile crowd', { main: true }), 'hostile');
  assert.throws(
    () => assertPlain('Stay safe', 'body'),
    /body: banned word "safe"/,
  );
  assert.throws(() => assertCap('button', 'x'.repeat(29)), /button: 29 > 28/);
});
