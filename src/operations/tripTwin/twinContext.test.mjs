// Phase 8: the wider area — what is drawn, once, and where pins go.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipRuns,
  contextHeight,
  contextPlan,
  contextRoad,
  coversPoint,
} from './twinContext.js';
import { roadClass } from './twinStreets.js';

const hotel = { lat: 30.262, lon: -97.738 };
const box = (id, lat, lon, h = null) => ({
  id,
  h,
  l: null,
  c: [
    [lat, lon],
    [lat, lon + 0.0002],
    [lat + 0.0002, lon + 0.0002],
    [lat + 0.0002, lon],
    [lat, lon],
  ],
});

test('heights: mapped, levels, else 9 m marked estimated', () => {
  assert.deepEqual(contextHeight({ h: 40 }), { m: 40, est: false });
  assert.deepEqual(contextHeight({ l: 10 }), { m: 32, est: false });
  assert.deepEqual(contextHeight({}), { m: 9, est: true });
});

test('plan: nothing from the core, each item once, strips first', () => {
  const data = {
    meta: { ringM: 1200 },
    ring: {
      buildings: [
        box(1, 30.262, -97.738),
        box(2, 30.27, -97.738),
        box(3, 30.268, -97.74),
      ],
      roads: [
        {
          id: 10,
          k: 'primary',
          c: [
            [30.27, -97.74],
            [30.271, -97.74],
          ],
        },
        {
          id: 11,
          k: 'motorway',
          c: [
            [30.27, -97.73],
            [30.271, -97.73],
          ],
        },
        {
          id: 12,
          k: 'primary',
          t: 1,
          c: [
            [30.27, -97.72],
            [30.271, -97.72],
          ],
        },
        {
          id: 13,
          k: 'footway',
          c: [
            [30.27, -97.71],
            [30.271, -97.71],
          ],
        },
        {
          id: 14,
          k: 'residential',
          c: [
            [30.27, -97.7],
            [30.271, -97.7],
          ],
        },
      ],
    },
    corridors: [
      {
        key: 'v',
        label: 'Venue',
        kind: 'venue',
        path: [
          [30.262, -97.738],
          [30.28, -97.738],
        ],
        buildings: [box(3, 30.268, -97.74)],
        roads: [],
      },
    ],
  };
  const plan = contextPlan(data, {
    coreCenter: hotel,
    coreM: 400,
    coreIds: new Set(['way/14']),
  });
  assert.deepEqual(
    plan.ring.buildings.map((b) => b.id),
    [2],
    'core building and strip building not in the ring',
  );
  assert.deepEqual(
    plan.strips[0].buildings.map((b) => b.id),
    [3],
  );
  assert.deepEqual(
    plan.ring.roads.map((r) => r.id),
    [10, 11],
    'tunnel, footway and core road left out; motorway kept as no walking',
  );
  assert.equal(roadClass(contextRoad(plan.ring.roads[1])), 'nowalk');
});

test('roads are clipped to the band between the core and the ring edge', () => {
  const line = Array.from({ length: 21 }, (_, i) => ({
    lat: hotel.lat + i * 0.001,
    lon: hotel.lon,
  }));
  const runs = clipRuns(line, hotel, 460, 1200);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].length >= 6 && runs[0].length <= 8);
});

test('covers: inside the ring or near a strip', () => {
  const strips = [
    {
      path: Array.from({ length: 40 }, (_, i) => ({
        lat: hotel.lat + i * 0.001,
        lon: hotel.lon,
      })),
    },
  ];
  assert.ok(
    coversPoint({ lat: 30.265, lon: -97.738 }, { hotel, ringM: 1200, strips }),
  );
  assert.ok(
    coversPoint({ lat: 30.295, lon: -97.7381 }, { hotel, ringM: 1200, strips }),
    'far along the strip',
  );
  assert.ok(
    !coversPoint({ lat: 30.295, lon: -97.72 }, { hotel, ringM: 1200, strips }),
    'far off the strip',
  );
  assert.ok(
    !coversPoint(
      { lat: 30.265, lon: -97.738 },
      { hotel, ringM: 1200, strips: [], ringOn: false },
    ),
  );
});
