import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  LABEL_KINDS,
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
  assert.equal(f.sourceAlpha, 0.72);
  assert.equal(f.maxDistance, undefined, 'shown wherever its glyph is');
  const hospital = overlayFields(
    safetyLabel(
      { category: 'hospital', name: 'Hospital Dell Seton' },
      { label: 'Hospital', draft: false },
    ),
  );
  assert.equal(hospital.protected, true);
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
