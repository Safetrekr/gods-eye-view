// Phase 5b: display units for every distance; older deferred items.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDistance,
  formatRadius,
  formatShort,
  getDistanceUnit,
  setDistanceUnit,
} from './twinData.js';

test('distances follow the display unit; meters by default', () => {
  assert.equal(getDistanceUnit(), 'm');
  assert.equal(formatDistance(640), '640 m');
  assert.equal(formatDistance(1700), '1.7 km');
  assert.equal(formatDistance(150, 'ft'), '490 ft');
  assert.equal(formatDistance(1700, 'ft'), '1.1 mi');
  assert.equal(formatDistance(400, 'ft'), '1,310 ft');
  assert.equal(formatDistance(640, 'yd'), '700 yd');
  assert.equal(formatRadius(1000), '1 km');
  assert.equal(formatRadius(10000, 'ft'), '6.2 mi');
  assert.equal(formatRadius(1000, 'ft'), '0.62 mi');
  assert.equal(formatRadius(100, 'ft'), '328 ft');
  assert.equal(formatShort(12, 'ft'), '39 ft');
  setDistanceUnit('ft');
  try {
    assert.equal(formatDistance(1700), '1.1 mi');
    assert.equal(formatShort(122), '400 ft');
  } finally {
    setDistanceUnit('m');
  }
  setDistanceUnit('furlong');
  assert.equal(getDistanceUnit(), 'm', 'unknown units fall back to meters');
});

test('declutter slides overlapping labels apart; fixed labels stay', async () => {
  const { declutter, labelSize } = await import('./twinDeclutter.js');
  const box = (id, x, y, extra = {}) => ({ id, x, y, w: 120, h: 20, ...extra });
  const out = declutter([
    box('ruler', 100, 100, { fixed: true }),
    box('fire', 110, 105),
    box('rally', 120, 108),
    box('far', 600, 100),
  ]);
  assert.deepEqual(out.get('ruler'), { dx: 0, dy: 0 });
  assert.deepEqual(out.get('far'), { dx: 0, dy: 0 });
  assert.notEqual(out.get('fire').dy, 0, 'moved off the fixed ruler');
  assert.notEqual(
    out.get('rally').dy,
    out.get('fire').dy,
    'and off each other',
  );
  const placed = [
    box('ruler', 100, 100),
    box('fire', 110, 105 + out.get('fire').dy),
    box('rally', 120, 108 + out.get('rally').dy),
  ];
  const hit = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let i = 0; i < placed.length; i += 1)
    for (let j = i + 1; j < placed.length; j += 1)
      assert.ok(
        !hit(placed[i], placed[j]),
        `${placed[i].id} vs ${placed[j].id}`,
      );
  const s = labelSize(
    'Fire station\nAustin Fire Station Number 1',
    '11px Inter',
  );
  assert.ok(s.w > 150 && s.h >= 30);
});

test('copied text spells out time next to ages', async () => {
  const { spokenAges } = await import('./twinData.js');
  assert.equal(
    spokenAges('Rally point 640 m · last seen 22m ago (position 1h 5m old)'),
    'Rally point 640 m · last seen 22 min ago (position 1 h 5 min old)',
  );
});
