import test from 'node:test';
import assert from 'node:assert/strict';
import {
  circleRing,
  polygonRings,
  tripBoundaries,
  boundaryIsDelayed,
  groupBoundaryLabel,
} from './boundaries.js';
import { distanceKm, validPoint } from './model.js';
import { initials, participantPhotoUrl } from './participantPins.js';

test('circle perimeter preserves radius at the equator, high latitude, and dateline', () => {
  for (const center of [
    { lat: 0, lng: 0 },
    { lat: 85, lng: 179.99 },
    { lat: -33, lng: -179.99 },
  ]) {
    const ring = circleRing(center, 400);
    assert.equal(ring.length, 97);
    assert.deepEqual(ring[0], ring.at(-1));
    for (const point of ring) {
      assert.ok(validPoint(point));
      assert.ok(Math.abs(distanceKm(center, point) - 0.4) < 1e-8);
    }
  }
  for (const radius of [null, '400', 0, -1, Infinity, 100001])
    assert.deepEqual(circleRing({ lat: 0, lng: 0 }, radius), []);
});

test('polygons preserve holes and reject incomplete coordinates', () => {
  const outer = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ];
  const hole = [
    [0.2, 0.2],
    [0.3, 0.2],
    [0.3, 0.3],
  ];
  assert.equal(
    polygonRings({ type: 'Polygon', coordinates: [outer, hole] }).length,
    2,
  );
  assert.equal(polygonRings(hole)[0].length, 4);
  assert.deepEqual(
    polygonRings([
      [null, 0],
      [1, 0],
      [1, 1],
    ]),
    [],
  );
  assert.deepEqual(
    polygonRings({ type: 'Polygon', coordinates: [outer, []] }),
    [],
  );
});

test('trip boundaries retain trip identity, separate chaperone centers and active fences only', () => {
  const fence = {
    id: 'f1',
    trip_id: 'a',
    type: 'circle',
    center_lat: 0,
    center_lng: 0,
    radius: 400,
  };
  const rows = tripBoundaries({
    geofences: [fence, { ...fence, active: false }],
    group_zones: [
      {
        trip_id: 'b',
        model: 'nearest_chaperone',
        radius_m: 400,
        centers: [
          { lat: 0, lng: 0 },
          { lat: 2, lng: 3 },
        ],
      },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.trip_id),
    ['a', 'b', 'b'],
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
});

test('a delayed boundary or participant never establishes current containment', () => {
  const person = {
    trip_id: 'a',
    isFresh: true,
    locationAgeSeconds: 5,
    freshMaxAgeSeconds: 120,
    group_zone_state: 'inside',
  };
  const snapshot = { group_zones: [{ trip_id: 'a', valid_for_seconds: 35 }] };
  assert.equal(groupBoundaryLabel(person, snapshot, 10), 'Inside');
  assert.match(groupBoundaryLabel(person, snapshot, 40), /Unknown.*overdue/);
  assert.match(
    groupBoundaryLabel({ ...person, isFresh: false }, snapshot, 10),
    /Unknown/,
  );
  assert.match(groupBoundaryLabel(person, { group_zones: [] }, 10), /Unknown/);
  assert.equal(boundaryIsDelayed({ moving: true }, 46), true);
  assert.equal(boundaryIsDelayed({ moving: false }, 600), false);
});

test('photos only use the configured public avatar bucket without credentials', () => {
  const base = 'https://sample.supabase.co';
  const path = '/storage/v1/object/public/avatars/user/thumb.jpg';
  assert.equal(participantPhotoUrl(base + path, base), base + path);
  for (const value of [
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'http://sample.supabase.co' + path,
    'https://other.test' + path,
    base + '/storage/v1/object/public/medical/file',
    'https://user:pass@sample.supabase.co' + path,
  ])
    assert.equal(participantPhotoUrl(value, base), null);
  assert.equal(initials('Alex Rivera'), 'AR');
  assert.equal(initials('  '), '?');
});
