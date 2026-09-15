import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleDestinations, deliveryMessage } from './actions.js';
import {
  DEFAULT_WORLD_LAYERS,
  enableDefaultWorldLayers,
} from './defaultLayers.js';

test('all eight world feeds are requested independently and tolerate a failed provider', async () => {
  const calls = [];
  const result = await enableDefaultWorldLayers({
    async setEnabled(id, enabled, options) {
      calls.push(id);
      assert.equal(enabled, true);
      assert.equal(options.origin, 'programmatic');
      if (id === 'local-firms') throw new Error('NASA unavailable');
    },
  });
  assert.deepEqual(calls, DEFAULT_WORLD_LAYERS);
  assert.equal(result.length, 8);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 7);
});

test('direction choices match trip, approval, audience, and usable location', () => {
  const point = {
    id: 'valid',
    trip_id: 'trip-a',
    source: 'safe_house',
    approval_status: 'active',
    address: 'Example address',
  };
  const snapshot = {
    safety_points: [
      point,
      { ...point, id: 'foreign', trip_id: 'trip-b' },
      { ...point, id: 'draft', approval_status: 'draft' },
      { ...point, id: 'private', visibility: 'org_internal' },
      { ...point, id: 'chaperones', chaperone_only: true },
      { ...point, id: 'no-location', address: null },
    ],
  };
  assert.deepEqual(
    eligibleDestinations(snapshot, 'trip-a', 'all').map((p) => p.id),
    ['valid'],
  );
  assert.deepEqual(
    eligibleDestinations(snapshot, 'trip-a', 'chaperones').map((p) => p.id),
    ['valid', 'chaperones'],
  );
});

test('receipts describe provider acceptance and preserve unknown outcomes', () => {
  assert.match(deliveryMessage({}), /could not be confirmed/);
  const message = deliveryMessage({
    push_delivery: {
      provider_accepted: 2,
      attempted: 3,
      unreached_recipients: 1,
      retry_scheduled: 1,
    },
  });
  assert.match(message, /accepted 2 device notifications out of 3/);
  assert.match(message, /1 recipients have no confirmed/);
  assert.match(message, /does not confirm that a traveler has seen/);
});
