import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  LABEL_KINDS,
  freeRect,
  hiddenShare,
  hiddenSide,
  labelSignature,
  rulerOrder,
  sharePlates,
  simulatedFirst,
  stackTags,
  TT_LABEL_GROUP,
  TT_OVERLAY_ACCENTS,
  mapLabel,
  overlayFields,
  safetyLabel,
  wallLabelScale,
} from './twinMapLabelEntries.js';
import { WORLD_OVERLAY_STYLE } from '../../overlays/worldOverlayTokens.js';

const palette = new Set(Object.values(TT_OVERLAY_ACCENTS));

test('every kind paints in Instrument colours: no cyan, no selected, no tactical card (L4)', () => {
  for (const kind of Object.keys(LABEL_KINDS)) {
    for (const draft of [false, true]) {
      const f = overlayFields(mapLabel(kind, { title: 'X', draft }));
      assert.ok(palette.has(f.accent), `${kind} accent ${f.accent}`);
      assert.notEqual(f.accent, WORLD_OVERLAY_STYLE.accent);
      assert.equal(f.selected, undefined);
      assert.equal(f.cardStyle, undefined);
      assert.equal(f.anchorDot, false);
      assert.equal(f.collisionGroup, TT_LABEL_GROUP);
      assert.equal(f.edgeFade, false);
      assert.equal(f.distanceFadeStartRatio, 1);
    }
  }
});

test('details need a card; live titles are read now', () => {
  let n = 1;
  const f = overlayFields(
    mapLabel('route', { title: () => `Start · ${n}`, details: ['a'] }),
  );
  assert.equal(f.variant, 'card');
  assert.equal(f.title, 'Start · 1');
  n = 2;
  assert.equal(
    overlayFields(mapLabel('route', { title: () => `Start · ${n}` })).title,
    'Start · 2',
  );
});

test('safety places: protected, state in words, the route end merged (L1, D12)', () => {
  const rally = safetyLabel(
    {
      category: 'rally_primary',
      name: 'Waller Creek plaza',
      chaperone_only: true,
    },
    { label: 'Rally point (primary)', draft: true, endOfRoute: true },
  );
  const f = overlayFields(rally);
  assert.equal(f.protected, true);
  assert.equal(f.title, 'Rally point (primary)');
  assert.deepEqual(f.details, [
    'Not approved · chaperones only',
    'Waller Creek plaza',
    'End of shown route',
  ]);
  assert.equal(f.accent, TT_OVERLAY_ACCENTS.draft);
  assert.equal(f.sourceAlpha, 1, 'a draft is said in words, never faint');
  assert.equal(rally.state, 'Not approved · chaperones only');
  assert.equal(f.maxDistance, undefined, 'shown wherever its glyph is');
  const hospital = overlayFields(
    safetyLabel(
      { category: 'hospital', name: 'Hospital Dell Seton' },
      { label: 'Hospital', draft: false },
    ),
  );
  assert.equal(hospital.protected, true);
  assert.equal(
    hospital.accent,
    TT_OVERLAY_ACCENTS.steel,
    'green means the trip plan only',
  );
  assert.deepEqual(
    hospital.details,
    [],
    'a name repeating the category is dropped',
  );
  const police = overlayFields(
    safetyLabel(
      { category: 'police', name: 'APD' },
      { label: 'Police', draft: false },
    ),
  );
  assert.equal(police.protected, false);
});

test('wall scale grows with the wall, never doubles (L4 §5)', () => {
  assert.ok(Math.abs(wallLabelScale(1.75) - 1.44) < 0.01);
  assert.equal(wallLabelScale(1), 1.1);
});

test('the overlay still asks for the face Trip Twin aliases to Inter (D3)', () => {
  assert.match(WORLD_OVERLAY_STYLE.fontLabel, /JetBrains Mono/);
});

test('inventory: only the storm still makes Cesium labels in Trip Twin', () => {
  const dir = new URL('./', import.meta.url);
  const left = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) =>
      /\blabel:\s*(\{|label\()/.test(readFileSync(new URL(f, dir), 'utf8')),
    );
  assert.deepEqual(left, ['twinStorm3d.js']);
});

test('SIMULATED words are protected and come first (every-time P0-2, IA P1-5)', () => {
  assert.equal(
    mapLabel('ambient', { title: 'SIMULATED rain (prototype)' }).protect,
    true,
  );
  assert.equal(mapLabel('ambient', { title: 'Low cloud 40%' }).protect, false);
  assert.equal(
    simulatedFirst('6 mi lightning watch · SIMULATED (prototype)'),
    'SIMULATED 6 mi lightning watch (prototype)',
  );
  assert.equal(simulatedFirst('Radar · IEM NEXRAD'), 'Radar · IEM NEXRAD');
});

test('a changed boost, accent or range is re-sent (AIA P1-2)', () => {
  const a = mapLabel('safety', { title: 'Rally point (primary)' });
  const b = mapLabel('safety', { title: 'Rally point (primary)', boost: 1.15 });
  assert.notEqual(
    labelSignature(a, overlayFields(a)),
    labelSignature(b, overlayFields(b)),
  );
});

test('operator notes stay off the walls (L1)', () => {
  const ml = mapLabel('avoid', {
    title: 'Avoid · Construction',
    details: ['ask Jo'],
    wallDetails: false,
  });
  assert.deepEqual(overlayFields(ml).details, ['ask Jo']);
  assert.deepEqual(overlayFields(ml, { wall: true }).details, []);
});

test('places at the same spot share one plate, the safety plan carrying it', () => {
  const d = (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon) * 111000;
  const r = sharePlates(
    [
      {
        id: 'f',
        category: 'fire',
        ll: { lat: 0, lon: 0 },
        words: 'Fire station',
      },
      {
        id: 'r2',
        category: 'rally_secondary',
        ll: { lat: 0.0002, lon: 0 },
        words: 'Rally point (secondary) (not approved)',
      },
      {
        id: 'h',
        category: 'hospital',
        ll: { lat: 0.01, lon: 0 },
        words: 'Hospital',
      },
    ],
    d,
  );
  assert.deepEqual([...r.absorbed], ['f']);
  assert.deepEqual(r.also.get('r2'), ['Fire station']);
});

test('the free rect is in canvas px on an inset wall (AIA P1-4); edge tags', () => {
  const f = freeRect(
    { left: 600, right: 0, top: 120, bottom: 40 },
    { left: 300, top: 0, width: 1700, height: 1080 },
    { w: 2000, h: 1080 },
  );
  assert.deepEqual(f, { left: 304, right: 1696, top: 120, bottom: 1040 });
  assert.equal(hiddenSide({ x: 100, y: 500, w: 150, h: 30 }, f), 'left');
  assert.equal(hiddenSide({ x: 800, y: 100, w: 150, h: 30 }, f), 'top');
  assert.equal(hiddenSide({ x: 280, y: 500, w: 150, h: 30 }, f), null);
  assert.equal(
    hiddenSide({ x: 220, y: 500, w: 150, h: 30 }, f),
    'left',
    'half hidden',
  );
  const st = stackTags([
    { side: 'left', y: 100, h: 30 },
    { side: 'left', y: 110, h: 30 },
  ]);
  assert.equal(st[1].y, 133);
});

test('overlapping ruler numbers: the reported floor wins and paints last (UX P0-1)', () => {
  const box = (rank, y) => ({ rank, x: 0, y, w: 20, h: 14 });
  const out = rulerOrder([box(2, 0), box(0, 4), box(3, 6), box(1, 40)]);
  assert.deepEqual(
    out.map((b) => b.rank),
    [1, 3],
  );
});

test('round 2: a selected resource never hosts a rally; tags stay inside; hidden share', () => {
  const d = (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon) * 111000;
  const r = sharePlates(
    [
      {
        id: 'f',
        category: 'fire',
        ll: { lat: 0, lon: 0 },
        words: 'Fire station',
      },
      {
        id: 'gs',
        category: 'safe_house',
        ll: { lat: 0.0001, lon: 0 },
        words: 'Group shelter · Chaperones only',
      },
    ],
    d,
  );
  assert.deepEqual([...r.absorbed], ['f']);
  assert.equal(r.hostOf.get('f'), 'gs');
  const f = { left: 0, right: 500, top: 0, bottom: 100 };
  const st = stackTags(
    [
      { side: 'left', y: 60, h: 30 },
      { side: 'left', y: 60, h: 30 },
    ],
    3,
    f,
  );
  assert.ok(st[1].y + 30 <= 100 && st[0].y >= 0 && st[1].y >= st[0].y + 33);
  assert.equal(hiddenShare({ x: -50, y: 10, w: 100, h: 20 }, f), 0.5);
  assert.equal(
    simulatedFirst('6 mi lightning watch · SIMULATED (prototype)'),
    'SIMULATED 6 mi lightning watch (prototype)',
  );
});
