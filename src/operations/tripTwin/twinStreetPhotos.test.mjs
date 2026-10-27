import test from 'node:test';
import assert from 'node:assert/strict';
import { TWIN_VENUES } from './twinSites.js';
import {
  photoTarget,
  rankPhotos,
  wallView,
  pickPhoto,
  photoLines,
  photoAge,
  photoCredit,
  photoUrl,
  bearingDeg,
} from './twinStreetPhotos.js';

const site = {
  key: 'austin',
  short: 'Fairmont',
  center: { lat: 30.26218, lon: -97.73832 },
  levels: 37,
  floorHeightM: 3.3,
};
const off = (p, bearing, m) => ({
  lat: p.lat + (m * Math.cos((bearing * Math.PI) / 180)) / 111_320,
  lon:
    p.lon +
    (m * Math.sin((bearing * Math.PI) / 180)) /
      (111_320 * Math.cos((p.lat * Math.PI) / 180)),
});
const photo = (over) => ({
  provider: 'panoramax',
  id: 'x',
  heading: 0,
  fov: 360,
  isPano: true,
  capturedAt: Date.UTC(2025, 3, 3),
  seq: null,
  ...over,
});
const NOW = Date.UTC(2026, 9, 28);

test('target: a mapped main entrance at the hotel, else the building', () => {
  const door = { ...off(site.center, 0, 20), atHotel: true, kind: 'main' };
  const t = photoTarget({ kind: 'hotel', site, doors: [door] });
  assert.equal(t.aim, 'entrance');
  assert.equal(t.words, 'the main entrance');
  const b = photoTarget({ kind: 'hotel', site, doors: [] });
  assert.equal(b.aim, 'building');
  assert.equal(b.words, 'the hotel');
  assert.ok(Math.abs(b.heightM - 122.1) < 0.1);
  const stop = photoTarget({
    kind: 'stop',
    site: { ...site, short: 'Long Center' },
  });
  assert.equal(stop.words, 'Long Center');
  const rally = photoTarget({
    kind: 'place',
    place: {
      id: 'r1',
      category: 'rally_primary',
      coordinates: { lat: 1, lng: 2 },
    },
  });
  assert.deepEqual(
    [rally.lat, rally.lon, rally.words],
    [1, 2, 'the rally point'],
  );
});

test('rank: within 250 m; a flat photo only when the target is in frame', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const at = off(site.center, 180, 63); // 63 m S of the hotel
  const items = [
    photo({ id: 'far', ...off(site.center, 90, 260) }),
    photo({
      id: 'faces',
      isPano: false,
      fov: 104,
      heading: 0,
      ...at,
      seq: 'a',
    }),
    photo({ id: 'away', isPano: false, fov: 60, heading: 66, ...at, seq: 'b' }),
    photo({ id: 'nohead', isPano: false, heading: null, ...at, seq: 'c' }),
  ];
  const r = rankPhotos(items, t);
  assert.deepEqual(
    r.map((p) => p.id),
    ['faces', 'nohead'],
  );
  assert.equal(r[0].band, 'approach');
  assert.equal(r[1].facing, null);
});

test('rank: the door band first, then newest, one per sequence', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const items = [
    photo({
      id: 'old-near',
      ...off(site.center, 90, 40),
      capturedAt: Date.UTC(2021, 0, 1),
      seq: 's1',
    }),
    photo({
      id: 'new-far',
      ...off(site.center, 90, 190),
      capturedAt: Date.UTC(2026, 0, 1),
      seq: 's2',
    }),
    photo({
      id: 'new-near',
      ...off(site.center, 90, 55),
      capturedAt: Date.UTC(2025, 0, 1),
      seq: 's3',
    }),
    photo({
      id: 'dup',
      ...off(site.center, 90, 58),
      capturedAt: Date.UTC(2025, 0, 1),
      seq: 's3',
    }),
  ];
  assert.deepEqual(
    rankPhotos(items, t).map((p) => p.id),
    ['new-near', 'old-near', 'new-far'],
  );
});

test('rank: the kept photo stays even from the same run', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const items = [
    photo({ id: 'a', ...off(site.center, 90, 40), seq: 's1' }),
    photo({ id: 'b', ...off(site.center, 90, 45), seq: 's1' }),
  ];
  assert.deepEqual(
    rankPhotos(items, t).map((p) => p.id),
    ['a'],
  );
  const keep = { provider: 'panoramax', id: 'b' };
  const r = rankPhotos(items, t, { keep });
  assert.deepEqual(r.map((p) => p.id).sort(), ['a', 'b']);
  assert.equal(pickPhoto(r, t, keep).photo.id, 'b');
  assert.equal(pickPhoto(r, t, keep).kept, true);
});

test('wall view: turned to the target, tilted up for a tall building, snapped', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const p = rankPhotos(
    [photo({ ...off(site.center, 130, 187), heading: 200 })],
    t,
  )[0];
  const v = wallView(p, t);
  // From 187 m SE the hotel is NW (~310°): 310 − 200 = 110.
  assert.equal(v.yaw, 110);
  assert.equal(v.pitch, 10);
  // 75° even on the approach: it holds ~30° compass errors (round 1).
  assert.equal(v.fov, 75);
  assert.equal(v.yaw % 5, 0);
  // Yaw wraps: heading 350, target at 10° → 20.
  const q = { ...photo({ heading: 350 }), d: 100, toTarget: 10 };
  assert.equal(wallView(q, { ...t, heightM: 0 }).yaw, 20);
  assert.equal(wallView(q, { ...t, heightM: 0 }).pitch, 0);
  assert.equal(wallView({ ...q, isPano: false }, t), null);
});

test('pick: the kept photo wins with its view; hidden; kept but gone', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const r = rankPhotos(
    [
      photo({ id: 'a', ...off(site.center, 130, 100), seq: 'a' }),
      photo({ id: 'b', ...off(site.center, 130, 150), seq: 'b' }),
    ],
    t,
  );
  assert.equal(pickPhoto(r, t).photo.id, 'a');
  const k = pickPhoto(r, t, {
    provider: 'panoramax',
    id: 'b',
    yaw: 45,
    by: 'JT',
  });
  assert.equal(k.photo.id, 'b');
  assert.equal(k.kept, true);
  assert.equal(k.view.yaw, 45);
  assert.equal(pickPhoto(r, t, { hide: true, by: 'JT' }).hidden, true);
  const gone = pickPhoto(r, t, { provider: 'panoramax', id: 'zzz' });
  assert.equal(gone.photo.id, 'a');
  assert.equal(gone.keptGone, true);
  assert.equal(pickPhoto([], t).none, true);
  assert.match(
    photoUrl(k, 960),
    /p=panoramax&id=b&w=960&yaw=45&pitch=\d+&fov=75/,
  );
});

test('words: direction, distance, age, credit, and never "none" without a check', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const r = rankPhotos(
    [
      photo({
        ...off(site.center, 130, 187),
        heading: 200,
        creator: 'mapcomplete, Jane Doe',
        license: 'CC BY-SA 4.0',
      }),
    ],
    t,
  );
  const pick = pickPhoto(r, t);
  const l = photoLines({
    search: { status: 'ok', items: r },
    pick,
    target: t,
    now: NOW,
    unit: 'ft',
  });
  assert.equal(l.state, 'found-pano');
  assert.equal(l.kicker, 'STREET PHOTO · PANORAMAX · 360°');
  assert.equal(l.dir, 'Facing NW, towards the hotel · from 610 ft SE');
  assert.equal(l.age, 'Taken Apr 2025 · 1 year 6 months old');
  assert.equal(
    l.credit,
    'Street photo: Jane Doe via Panoramax (CC BY-SA 4.0) · view cropped and dimmed',
  );
  assert.equal(
    photoLines({ search: null, target: t, now: NOW }).line,
    'Looking for street photos…',
  );
  assert.equal(
    photoLines({
      search: { status: 'unavailable', items: [] },
      pick: pickPhoto([], t),
      target: t,
      now: NOW,
    }).state,
    'unavailable',
  );
  const none = photoLines({
    search: { status: 'ok', items: [], servedAt: 1000 },
    pick: pickPhoto([], t),
    target: t,
    now: NOW,
    checkedNow: 1000 + 4 * 60e3,
    unit: 'ft',
  });
  assert.equal(none.line, 'None within 820 ft · checked 4 min ago');
  assert.equal(
    photoLines({
      search: { status: 'ok', items: r },
      pick: { hidden: true },
      target: t,
      now: NOW,
    }).line,
    'Hidden at the All-in-one',
  );
});

test('found but none would load is never "none"; no heading claims no direction; edge of frame', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const r = rankPhotos(
    [photo({ ...off(site.center, 130, 187), heading: 200 })],
    t,
  );
  const failed = photoLines({
    search: { status: 'ok', items: r },
    pick: pickPhoto([], t),
    target: t,
    failed: true,
    now: NOW,
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.line, 'Found but would not load');
  const blind = rankPhotos(
    [
      photo({
        id: 'blind',
        ...off(site.center, 130, 100),
        heading: null,
        seq: 'x',
      }),
      photo({
        id: 'seen',
        ...off(site.center, 130, 150),
        heading: 200,
        seq: 'y',
      }),
    ],
    t,
  );
  // A 360° with no heading ranks after one with a heading…
  assert.deepEqual(
    blind.map((p) => p.id),
    ['seen', 'blind'],
  );
  // …and claims no direction.
  const lb = photoLines({
    search: { status: 'ok', items: blind },
    pick: pickPhoto([blind[1]], t),
    target: t,
    now: NOW,
    unit: 'ft',
  });
  assert.match(lb.dir, /^Direction not recorded · from /);
  assert.equal(lb.look, null);
  // A flat photo 40° off a 60° lens is at the edge; 70° off is dropped.
  const at = off(site.center, 180, 80);
  const edge = rankPhotos(
    [
      photo({
        id: 'edge',
        isPano: false,
        fov: 60,
        heading: 40,
        ...at,
        seq: 'e',
      }),
      photo({
        id: 'away',
        isPano: false,
        fov: 60,
        heading: 70,
        ...at,
        seq: 'f',
      }),
    ],
    t,
  );
  assert.deepEqual(
    edge.map((p) => p.id),
    ['edge'],
  );
  const le = photoLines({
    search: { status: 'ok', items: edge },
    pick: pickPhoto(edge, t),
    target: t,
    now: NOW,
    unit: 'ft',
  });
  assert.match(
    le.dir,
    /^Facing NE · the hotel may be at the edge of the frame · from /,
  );
  // The All-in-one says "Hidden on walls" of its own hide.
  assert.equal(
    photoLines({
      search: { status: 'ok', items: r },
      pick: { hidden: true },
      target: t,
      now: NOW,
      where: 'aio',
    }).line,
    'Hidden on walls',
  );
});

test('rank: frames of one run within 15 m are one view; farther frames stay', () => {
  const t = photoTarget({ kind: 'hotel', site });
  const items = [
    photo({ id: 'a', ...off(site.center, 90, 100), seq: 's' }),
    photo({ id: 'b', ...off(site.center, 90, 108), seq: 's' }),
    photo({ id: 'c', ...off(site.center, 90, 140), seq: 's' }),
  ];
  assert.deepEqual(
    rankPhotos(items, t).map((p) => p.id),
    ['a', 'c'],
  );
});

test('age: months, years, old at 36 months; credit forms', () => {
  assert.equal(
    photoAge(Date.UTC(2026, 8, 29), NOW).text,
    'Taken Sep 2026 · under a month old',
  );
  assert.equal(
    photoAge(Date.UTC(2023, 9, 1), NOW).text,
    'Taken Oct 2023 · 3 years old · may look different now',
  );
  assert.equal(photoAge(Date.UTC(2023, 9, 1), NOW).old, true);
  assert.equal(photoAge(null, NOW).text, 'Date not recorded');
  assert.equal(
    photoCredit({ provider: 'kartaview' }),
    'Street photo: KartaView contributors (CC BY-SA 4.0)',
  );
  assert.equal(
    photoCredit({ provider: 'panoramax', license: 'CC BY-SA 4.0' }),
    'Street photo: Panoramax contributors (CC BY-SA 4.0)',
  );
});

test('bearing is clockwise from north', () => {
  const a = { lat: 0, lon: 0 };
  assert.equal(Math.round(bearingDeg(a, { lat: 0, lon: 1 })), 90);
  assert.equal(Math.round(bearingDeg(a, { lat: -1, lon: 0 })), 180);
});

test('every stop has a sentence name: "towards the Long Center", "towards Westminster Abbey"', () => {
  for (const site of Object.values(TWIN_VENUES)) {
    const t = photoTarget({ kind: 'stop', site });
    assert.ok(site.photoName, `${site.key} has a photoName`);
    assert.equal(t.words, site.photoName);
  }
  assert.equal(TWIN_VENUES['austin-long-center'].photoName, 'the Long Center');
  assert.equal(TWIN_VENUES['london-abbey'].photoName, 'Westminster Abbey');
});
