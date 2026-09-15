// Development-only fictional fixtures. Never fetched from production.
const demoFlightStart = Date.now();
export function demoSnapshot() {
  const now = Date.now();
  const iso = (delta) => new Date(now + delta).toISOString();
  const id = 'demo-austin';
  const people = [
    ['p1', 'Jordan Lee', 'chaperone', 30.2682, -97.7429, 18, 0.78],
    ['p2', 'Alex Rivera', 'traveler', 30.2678, -97.7419, 34, 0.64],
    ['p3', 'Sam Taylor', 'traveler', 30.2668, -97.7437, 260, 0.22],
    ['p4', 'Casey Morgan', 'traveler', 30.2662, -97.7401, 1100, 0.08],
    ['p5', 'Riley Park', 'traveler', null, null, null, null],
  ].map(([pid, name, role, lat, lng, age, battery]) => ({
    id: pid,
    trip_id: id,
    user_id: pid,
    name,
    role,
    coordinates: lat === null ? null : { lat, lng },
    capturedAt: age === null ? null : iso(-age * 1000),
    locationAgeSeconds: age,
    freshness:
      age === null
        ? 'unknown'
        : age <= 120
          ? 'fresh'
          : age <= 600
            ? 'aging'
            : 'stale',
    isFresh: age !== null && age <= 120,
    freshMaxAgeSeconds: 120,
    staleAgeSeconds: 600,
    accuracy_m: 16,
    battery_level: battery,
    battery_state: 'unplugged',
    group_zone_state: age <= 120 ? 'inside' : 'unknown',
  }));
  return {
    schema_version: 1,
    generated_at: iso(0),
    scope: { kind: 'platform', org_id: null },
    capabilities: { send_alert: true, direct_group: true },
    page: { offset: 0, limit: 10, total: 1, has_more: false },
    source_issues: [],
    trips: [
      {
        id,
        title: 'Austin discovery trip',
        destination: 'Austin, Texas',
        status: 'active',
        start_date: iso(-86400000).slice(0, 10),
        end_date: iso(86400000).slice(0, 10),
        timezone: 'America/Chicago',
        loaded_participants: 5,
      },
    ],
    participants: people,
    places: [
      {
        id: 'hotel',
        trip_id: id,
        kind: 'lodging',
        name: 'Sample group hotel',
        address: 'Fictional trip location',
        coordinates: { lat: 30.2641, lng: -97.7394 },
      },
    ],
    itinerary: [
      {
        id: 'e1',
        trip_id: id,
        title: 'Downtown walking tour',
        event_date: iso(0).slice(0, 10),
        start_time: '10:00',
        end_time: '12:00',
        location_name: 'Congress Avenue',
        coordinates: { lat: 30.2672, lng: -97.7431 },
      },
    ],
    safety_points: [
      {
        id: 'rally',
        source: 'rally_point',
        trip_id: id,
        name: 'Sample rally point',
        category: 'rally_primary',
        approval_status: 'active',
        coordinates: { lat: 30.2679, lng: -97.7426 },
        instructions: 'Meet at the designated group marker.',
        contact: {},
      },
    ],
    geofences: [],
    geofence_events: [
      {
        id: 'exit-1',
        trip_id: id,
        participant_id: 'p2',
        geofence_id: 'sample-zone',
        geofence_name: 'Sample group safety zone',
        direction: 'exit',
        timestamp: iso(-1200000),
        coordinates: { lat: 30.273, lng: -97.744 },
      },
      {
        id: 'entry-1',
        trip_id: id,
        participant_id: 'p2',
        geofence_id: 'sample-zone',
        geofence_name: 'Sample group safety zone',
        direction: 'enter',
        timestamp: iso(-900000),
        coordinates: { lat: 30.268, lng: -97.743 },
      },
    ],
    group_zones: [
      {
        trip_id: id,
        model: 'nearest_chaperone',
        radius_m: 400,
        centers: [{ lat: 30.2682, lng: -97.7429 }],
        degraded: false,
      },
    ],
    musters: [
      {
        id: 'm1',
        trip_id: id,
        title: 'Morning roll call',
        scheduled_time: iso(-3600000),
        status: 'in_progress',
        counts: { present: 3, absent: 0, excused: 0, unmarked: 2, expected: 5 },
      },
    ],
    morning_musters: [],
    alerts: [
      {
        id: 'direction-1',
        trip_id: id,
        headline: 'Go to Sample rally point',
        full_summary:
          'Please proceed to the sample rally point. Use the main entrance.',
        priority: 'high',
        status: 'active',
        acknowledged_count: 2,
        created_at: iso(-300000),
        arrive_by: iso(600000),
        operations_event: {
          kind: 'group_direction',
          destination_id: 'rally',
          destination_source: 'rally_point',
        },
      },
      {
        id: 'a1',
        trip_id: id,
        headline: 'Sample heat advisory',
        tl_dr: 'Plan water breaks during the afternoon walk.',
        priority: 'P3',
        status: 'active',
        acknowledged_count: 3,
        created_at: iso(-3600000),
      },
    ],
    flights: [
      {
        id: 'f1',
        trip_id: id,
        airline: 'Example Air',
        flight_number: 'EX101',
        departure_airport: 'JFK',
        arrival_airport: 'AUS',
        departure_time: new Date(demoFlightStart - 3600000).toISOString(),
        arrival_time: new Date(demoFlightStart + 3600000).toISOString(),
        participant_ids: ['p1', 'p2', 'p3', 'p4'],
        association: 'assigned',
        telemetry_status: 'not_linked',
      },
    ],
  };
}
