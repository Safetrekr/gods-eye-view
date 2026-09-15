import { currentFreshness, distanceKm, validPoint } from './model.js';

export const HAZARD_RADIUS_KM = { earthquake: 250, fire: 25 };
const DAY = 86400000;
const timestamp = (value) =>
  typeof value === 'number' ? value : Date.parse(value);
const priority = (value) =>
  ({ critical: 3, P1: 3, high: 2, P2: 2, medium: 1, P3: 1 })[value] || 0;

export function tripReferences(snapshot, elapsedSeconds = 0) {
  const trips = new Set(snapshot?.trips.map((trip) => trip.id));
  const references = [];
  const add = (record, label) => {
    if (trips.has(record.trip_id) && validPoint(record.coordinates))
      references.push({
        tripId: record.trip_id,
        coordinates: record.coordinates,
        label,
      });
  };
  for (const person of snapshot?.participants || [])
    if (currentFreshness(person, elapsedSeconds).state === 'fresh')
      add(person, 'fresh participant location');
  for (const place of snapshot?.places || []) add(place, 'lodging / venue');
  for (const stop of snapshot?.itinerary || []) add(stop, 'itinerary stop');
  // Co-located roster members should not multiply proximity work.
  return [
    ...new Map(
      references.map((ref) => [
        `${ref.tripId}:${ref.coordinates.lat}:${ref.coordinates.lng}`,
        ref,
      ]),
    ).values(),
  ];
}

function nearestReferences(point, radius, references, areaRadius = 0) {
  const byTrip = new Map();
  for (const ref of references) {
    // Cheap latitude rejection before great-circle distance; longitude wraps
    // at the date line, so never use an unwrapped longitude subtraction.
    if (Math.abs(point.lat - ref.coordinates.lat) * 110 > radius + areaRadius)
      continue;
    const distance = Math.max(
      0,
      distanceKm(point, ref.coordinates) - areaRadius,
    );
    if (
      distance <= radius &&
      (!byTrip.has(ref.tripId) || distance < byTrip.get(ref.tripId).distanceKm)
    )
      byTrip.set(ref.tripId, { ...ref, distanceKm: distance });
  }
  return [...byTrip.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}

export function buildAlertFeed({
  snapshot,
  world = {},
  mode = 'nearby',
  now = Date.now(),
  elapsedSeconds = 0,
}) {
  if (!snapshot) return { items: [], notices: [], total: 0 };
  const trips = new Map(snapshot.trips.map((trip) => [trip.id, trip]));
  const references = tripReferences(snapshot, elapsedSeconds);
  const notices = [];
  const items = new Map();
  const put = (item) => items.set(item.id, item);
  const recent = (time) =>
    Number.isFinite(time) && time >= now - DAY && time <= now + 120000;
  for (const alert of snapshot.alerts || []) {
    if (!trips.has(alert.trip_id)) continue;
    const timeMs = timestamp(alert.created_at || alert.window_start);
    const direction = alert.operations_event?.kind === 'group_direction';
    const destination =
      direction &&
      snapshot.safety_points?.find(
        (point) =>
          point.trip_id === alert.trip_id &&
          point.id === alert.operations_event.destination_id &&
          point.source === alert.operations_event.destination_source,
      );
    put({
      id: `trip-alert:${alert.trip_id}:${alert.id}`,
      kind: direction ? 'direction' : 'alert',
      title: alert.headline || 'Trip alert',
      body: alert.full_summary || alert.tl_dr || '',
      timeMs: Number.isFinite(timeMs) ? timeMs : null,
      priority: priority(alert.priority || alert.severity),
      source: 'SafeTrekr',
      tripIds: [alert.trip_id],
      coordinates: destination?.coordinates,
      detail: `${alert.acknowledged_count || 0} participant acknowledgments${alert.arrive_by ? ` · Arrival deadline: ${new Date(alert.arrive_by).toLocaleString()}` : ''}`,
      record: alert,
    });
  }
  // A later recorded re-entry keeps an old exit from looking like an open
  // breach. Neither transition establishes the participant's current safety.
  const entries = new Map();
  const boundaryKey = (event) =>
    `${event.trip_id}:${event.participant_id}:${event.geofence_id}`;
  for (const event of snapshot.geofence_events || []) {
    const time = timestamp(event.timestamp);
    if (event.direction === 'enter' && recent(time) && trips.has(event.trip_id))
      entries.set(
        boundaryKey(event),
        Math.max(entries.get(boundaryKey(event)) || 0, time),
      );
  }
  // Transitions are stored by Core's geofence engine, never inferred here.
  for (const event of snapshot.geofence_events || []) {
    const timeMs = timestamp(event.timestamp);
    if (
      !trips.has(event.trip_id) ||
      !recent(timeMs) ||
      !['enter', 'exit'].includes(event.direction)
    )
      continue;
    const person = snapshot.participants?.find(
      (p) => p.trip_id === event.trip_id && p.id === event.participant_id,
    );
    const entered = event.direction === 'enter';
    const returned = !entered && entries.get(boundaryKey(event)) > timeMs;
    put({
      id: `geofence:${event.trip_id}:${event.id}`,
      kind: 'geofence',
      title: `${person?.name || 'Participant'} ${entered ? 're-entered' : 'left'} the geofence`,
      body: `${event.geofence_name || 'Trip boundary'} · Recorded ${entered ? 'entry' : 'exit'} transition.${returned ? ' A later re-entry was recorded for this boundary.' : ''}`,
      timeMs,
      priority: entered || returned ? 0 : 2,
      source: 'SafeTrekr geofence engine',
      tripIds: [event.trip_id],
      coordinates: event.coordinates,
      detail:
        'The map point is the recorded transition location, not a current position.',
    });
  }
  for (const quake of world.earthquakes || []) {
    const point = { lat: quake.lat, lng: quake.lon };
    if (
      !validPoint(point) ||
      !recent(quake.timeMs) ||
      !Number.isFinite(quake.magnitude) ||
      quake.magnitude < 2.5
    )
      continue;
    const near = nearestReferences(
      point,
      HAZARD_RADIUS_KM.earthquake,
      references,
    );
    if (mode === 'nearby' && !near.length) continue;
    put({
      id: `earthquake:${quake.id}`,
      kind: 'earthquake',
      title: `M${quake.magnitude.toFixed(1)} earthquake`,
      body: quake.place || 'Location reported by USGS',
      timeMs: quake.timeMs,
      priority: near.length && quake.magnitude >= 6 ? 2 : 1,
      source: 'USGS',
      coordinates: point,
      tripIds: near.map((ref) => ref.tripId),
      near,
      detail: `${Number.isFinite(quake.depthKm) ? `${quake.depthKm.toFixed(1)} km depth. ` : ''}Distance is a proximity filter, not an impact or shaking forecast.`,
    });
  }
  for (const area of world.fires || []) {
    if (!validPoint(area.coordinates) || !recent(area.timeMs)) continue;
    const near = nearestReferences(
      area.coordinates,
      HAZARD_RADIUS_KM.fire,
      references,
      area.radiusKm || 0,
    );
    if (mode === 'nearby' && !near.length) continue;
    put({
      id: `${area.id}:${area.timeMs}`,
      kind: 'fire',
      title: 'Satellite heat detections',
      body: `${area.count.toLocaleString()} observation${area.count === 1 ? '' : 's'} in this area`,
      timeMs: area.timeMs,
      priority: 1,
      source: 'NASA FIRMS',
      coordinates: area.coordinates,
      tripIds: near.map((ref) => ref.tripId),
      near,
      detail:
        'Grouped in 0.1° map cells. Observations may include repeated satellite passes or non-wildfire heat sources; these are not confirmed fire incidents or boundaries.',
    });
  }
  if (mode === 'nearby' && !references.length)
    notices.push(
      'No usable trip reference locations. Nearby world events cannot be matched. Choose Worldwide to see public events.',
    );
  else if (mode === 'nearby') {
    const located = new Set(references.map((ref) => ref.tripId));
    if (located.size < trips.size)
      notices.push(
        `${trips.size - located.size} loaded trip(s) have no usable reference location.`,
      );
  }
  if (!Array.isArray(snapshot.geofence_events))
    notices.push(
      'Recorded geofence activity requires the pending Core update.',
    );
  for (const issue of snapshot.source_issues || [])
    if (['geofence_violations', 'trip_alerts'].includes(issue.source))
      notices.push(
        `${issue.source === 'trip_alerts' ? 'Trip alerts' : 'Geofence history'} ${issue.reason === 'row_limit' ? 'is incomplete' : 'is unavailable'}.`,
      );
  for (const [key, label] of [
    ['earthquakes', 'Earthquakes'],
    ['fires', 'Active fires'],
  ]) {
    const feed = world.feeds?.[key];
    if (!feed || !feed.enabled)
      notices.push(
        `${label} layer is off or unavailable. Enable it in World controls to monitor this source.`,
      );
    else if (feed.stats?.loading)
      notices.push(`${label} is loading; this event list is incomplete.`);
    else if (feed.stats?.error || feed.stats?.stale)
      notices.push(
        `${label} feed is delayed or unavailable; displayed observations may be stale.`,
      );
  }
  const sorted = [...items.values()].sort(
    (a, b) =>
      b.priority - a.priority ||
      (b.timeMs || 0) - (a.timeMs || 0) ||
      a.id.localeCompare(b.id),
  );
  return { items: sorted, total: sorted.length, notices };
}
