import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotHasValidScope, TRIP_COLLECTIONS } from './access.js';
import { fetchOperations } from './api.js';

const fixture = () => ({
  schema_version: 1,
  scope: { kind: 'organization', org_id: 'org-a' },
  trips: [{ id: 'trip-a', org_id: 'org-a' }],
  ...Object.fromEntries(
    TRIP_COLLECTIONS.map((key) => [key, [{ trip_id: 'trip-a' }]]),
  ),
});

test('organization responses must have a concrete scope and matching trips', () => {
  assert.ok(snapshotHasValidScope(fixture()));
  for (const scope of [
    undefined,
    {},
    { kind: 'organization', org_id: null },
    { kind: 'organization', org_id: 'org-b' },
    { kind: 'platform', org_id: 'org-a' },
    { kind: 'unknown', org_id: null },
  ]) {
    assert.equal(snapshotHasValidScope({ ...fixture(), scope }), false);
  }
  const empty = {
    ...fixture(),
    trips: [],
    ...Object.fromEntries(TRIP_COLLECTIONS.map((key) => [key, []])),
  };
  assert.ok(
    snapshotHasValidScope(empty),
    'An organization with no trips can still sign in',
  );
});

test('platform scope supports multiple organizations but no orphan child records', () => {
  const data = fixture();
  data.scope = { kind: 'platform', org_id: null };
  data.trips.push({ id: 'trip-b', org_id: 'org-b' });
  data.participants.push({ trip_id: 'trip-b' });
  assert.ok(snapshotHasValidScope(data));
  data.participants.push({ trip_id: 'unloaded-trip' });
  assert.equal(snapshotHasValidScope(data), false);
});

for (const key of TRIP_COLLECTIONS) {
  test(`rejects cross-organization ${key} before rendering`, () => {
    const data = fixture();
    data[key].push({ trip_id: 'trip-b' });
    assert.equal(snapshotHasValidScope(data), false);
  });
}

test('requests carry only authorized filter parameters; inconsistent scopes force cleanup', async (t) => {
  let payload = fixture();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const query = new URL(url, 'https://example.test').searchParams;
    assert.equal(query.has('org_id'), false);
    assert.equal(query.has('role'), false);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-session');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => payload };
  });
  const filters = {
    window: 'all',
    offset: 0,
    org_id: 'org-b',
    role: 'hq_admin',
  };
  assert.equal(
    (await fetchOperations('synthetic-session', filters)).scope.org_id,
    'org-a',
  );
  payload.trips.push({ id: 'trip-b', org_id: 'org-b' });
  await assert.rejects(
    fetchOperations('synthetic-session', filters),
    (error) => error.fatal === true && error.status === 502,
  );
});
