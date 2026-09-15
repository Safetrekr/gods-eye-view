// Core is the authorization boundary. Reject inconsistent responses before
// rendering them; never infer access from browser state or editable metadata.
export const TRIP_COLLECTIONS = [
  'participants',
  'flights',
  'places',
  'itinerary',
  'safety_points',
  'geofences',
  'group_zones',
  'musters',
  'morning_musters',
  'alerts',
];

export function snapshotHasValidScope(snapshot) {
  const scope = snapshot?.scope;
  if (!scope || !Array.isArray(snapshot.trips)) return false;
  if (scope.kind === 'organization') {
    if (typeof scope.org_id !== 'string' || !scope.org_id.trim()) return false;
    if (snapshot.trips.some((trip) => trip?.org_id !== scope.org_id))
      return false;
  } else if (scope.kind !== 'platform' || scope.org_id !== null) return false;
  const tripIds = new Set(snapshot.trips.map((trip) => trip?.id));
  if (tripIds.has(undefined) || tripIds.has(null)) return false;
  return TRIP_COLLECTIONS.every(
    (key) =>
      Array.isArray(snapshot[key]) &&
      snapshot[key].every((record) => tripIds.has(record?.trip_id)),
  );
}

export function scopeLabels(scope) {
  return scope.kind === 'organization'
    ? {
        label: 'ORGANIZATION VIEW',
        title: 'Your organization, in view',
        description: 'Trips and people from your organization only.',
        allTrips: 'All organization trips',
      }
    : {
        label: 'ALL ORGANIZATIONS',
        title: 'Your world, at a glance',
        description: 'Trips and people across all organizations.',
        allTrips: 'All trips',
      };
}
