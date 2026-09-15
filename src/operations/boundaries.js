import { validPoint } from './model.js';

// Map geometry only. Containment is always supplied by Core's alert engine.
export function circleRing(center, radius) {
  if (
    !validPoint(center) ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    radius > 100000
  )
    return [];
  const rad = Math.PI / 180;
  const lat = center.lat * rad;
  const lng = center.lng * rad;
  const arc = radius / 6371000;
  const points = Array.from({ length: 96 }, (_, index) => {
    const bearing = (index * Math.PI) / 48;
    const y = Math.asin(
      Math.sin(lat) * Math.cos(arc) +
        Math.cos(lat) * Math.sin(arc) * Math.cos(bearing),
    );
    const x =
      lng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(arc) * Math.cos(lat),
        Math.cos(arc) - Math.sin(lat) * Math.sin(y),
      );
    return { lat: y / rad, lng: ((x / rad + 540) % 360) - 180 };
  });
  return [...points, points[0]];
}

export function polygonRings(raw) {
  const rings =
    raw?.type === 'Polygon' ? raw.coordinates : Array.isArray(raw) ? [raw] : [];
  if (!Array.isArray(rings) || !rings.length) return [];
  const points = rings.map((ring) =>
    Array.isArray(ring)
      ? ring.map((p) => (Array.isArray(p) ? { lat: p[1], lng: p[0] } : p))
      : [],
  );
  if (
    points.flat().length > 2000 ||
    points.some((ring) => ring.length < 3 || !ring.every(validPoint))
  )
    return [];
  return points.map((ring) => {
    const a = ring[0],
      b = ring.at(-1);
    return a.lat === b.lat && a.lng === b.lng ? ring : [...ring, a];
  });
}

export function tripBoundaries(snapshot) {
  const result = [];
  for (const fence of snapshot?.geofences || []) {
    if (fence.active === false) continue;
    const center = { lat: fence.center_lat, lng: fence.center_lng };
    const rings =
      fence.type === 'circle'
        ? [circleRing(center, fence.radius)]
        : polygonRings(fence.polygon);
    if (!rings[0]?.length) continue;
    result.push({
      ...fence,
      id: `fence:${fence.trip_id}:${fence.id}`,
      coordinates: fence.type === 'circle' ? center : rings[0][0],
      rings,
      moving: false,
    });
  }
  for (const zone of snapshot?.group_zones || []) {
    for (const [index, center] of (zone.centers || []).entries()) {
      const ring = circleRing(center, zone.radius_m);
      if (!ring.length) continue;
      result.push({
        ...zone,
        id: `group:${zone.trip_id}:${index}`,
        name: 'Chaperone group boundary',
        coordinates: center,
        radius: zone.radius_m,
        rings: [ring],
        moving: true,
      });
    }
  }
  return result;
}

export function boundaryIsDelayed(boundary, elapsed) {
  return (
    boundary.moving &&
    elapsed >
      Math.min(
        45,
        Number.isFinite(boundary.valid_for_seconds)
          ? Math.max(0, boundary.valid_for_seconds)
          : 45,
      )
  );
}

export function groupBoundaryLabel(person, snapshot, elapsed) {
  const zone = snapshot?.group_zones?.find(
    (entry) => entry.trip_id === person.trip_id,
  );
  if (!person.group_zone_state) return 'Open the trip for boundary status';
  if (!zone) return 'Unknown · no current group boundary';
  if (boundaryIsDelayed({ ...zone, moving: true }, elapsed))
    return 'Unknown · boundary update overdue';
  if (
    !person.isFresh ||
    elapsed + person.locationAgeSeconds > person.freshMaxAgeSeconds
  )
    return 'Unknown · location not current';
  const state = person.group_zone_state;
  return `${state.charAt(0).toUpperCase()}${state.slice(1)}${person.group_zone_ambiguous || zone.degraded ? ' · uncertain boundary' : ''}`;
}
