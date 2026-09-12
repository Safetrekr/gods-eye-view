// Pure operations presentation rules. No auth, network, Cesium, or persistence.
export const PEOPLE_COLORS = Object.freeze({
  traveler: '#71cc9a',
  chaperone: '#75b9f2',
  aging: '#e6bb66',
  stale: '#d98585',
  unknown: '#9aa8ac',
});

export function validPoint(point) {
  return (
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

export function currentFreshness(person, elapsedSeconds = 0) {
  if (!validPoint(person.coordinates))
    return { state: 'unknown', age: null, label: 'No location reported' };
  if (
    person.freshness === 'unknown' ||
    !Number.isFinite(person.locationAgeSeconds)
  ) {
    return { state: 'unknown', age: null, label: 'Capture time unknown' };
  }
  const age = person.locationAgeSeconds + Math.max(0, elapsedSeconds);
  const state =
    age <= person.freshMaxAgeSeconds
      ? 'fresh'
      : age <= person.staleAgeSeconds
        ? 'aging'
        : 'stale';
  const label =
    age < 60
      ? `${Math.floor(age)}s ago`
      : age < 3600
        ? `${Math.floor(age / 60)}m ago`
        : `${Math.floor(age / 3600)}h ago`;
  return {
    state,
    age,
    label:
      state === 'fresh'
        ? label
        : `${state === 'stale' ? 'Last known' : 'Aging'} · ${label}`,
  };
}

export function distanceKm(a, b) {
  if (!validPoint(a) || !validPoint(b)) return Infinity;
  const rad = Math.PI / 180;
  const dlat = (b.lat - a.lat) * rad;
  const dlng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearbyCameras(cameras, subject, radiusKm = 5) {
  return cameras
    .map((camera) => ({
      ...camera,
      distance_km: distanceKm(subject, { lat: camera.lat, lng: camera.lon }),
    }))
    .filter((camera) => camera.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km || a.id.localeCompare(b.id));
}

const airport = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();
const normalized = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

export function aircraftLinkProblem(flight, aircraft, now = Date.now()) {
  if (!flight.participant_ids?.length)
    return 'This flight has no confirmed participant assignments.';
  if (!aircraft || !/^[a-f0-9]{6}$/i.test(aircraft.icao24 || ''))
    return 'Enter an exact six-character ICAO24 address from the live feed.';
  if (aircraft.stale)
    return 'This aircraft feed is stale. Wait for a current observation.';
  // Recurring flight numbers are never sufficient identity. Require a dated
  // leg and a human confirmation of this airframe; never use fuzzy matching.
  const departure = Date.parse(flight.departure_time);
  const arrival = Date.parse(flight.arrival_time);
  const zoned = (value) =>
    typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  if (
    !zoned(flight.departure_time) ||
    !zoned(flight.arrival_time) ||
    !Number.isFinite(departure) ||
    !Number.isFinite(arrival) ||
    arrival < departure
  )
    return 'This leg needs dated departure and arrival times with timezones before linking.';
  if (now < departure - 6 * 3600000 || now > arrival + 6 * 3600000)
    return 'This leg is outside its live tracking window (departure −6h to arrival +6h).';
  for (const [expected, reported] of [
    [flight.departure_airport, aircraft.origin],
    [flight.arrival_airport, aircraft.destination],
  ]) {
    if (
      airport(expected).length === 3 &&
      airport(reported).length === 3 &&
      airport(expected) !== airport(reported)
    )
      return 'The feed route conflicts with the scheduled airports.';
  }
  return null;
}

export function makeAircraftLink(
  flight,
  aircraft,
  confirmed,
  now = Date.now(),
) {
  if (!confirmed)
    throw new Error(
      'Confirm that you verified the aircraft for this dated leg.',
    );
  const problem = aircraftLinkProblem(flight, aircraft, now);
  if (problem) throw new Error(problem);
  return {
    flightId: flight.id,
    icao24: aircraft.icao24.toLowerCase(),
    callsign: normalized(aircraft.callsign),
    departure: flight.departure_time,
    arrival: flight.arrival_time,
    confirmedAt: now,
    expiresAt: Math.min(
      now + 2 * 3600000,
      Date.parse(flight.arrival_time) + 6 * 3600000,
    ),
  };
}

export function liveAircraftLink(link, flight, aircraft, now = Date.now()) {
  return Boolean(
    link &&
    flight &&
    aircraft &&
    now < link.expiresAt &&
    now >= link.confirmedAt &&
    link.departure === flight.departure_time &&
    link.arrival === flight.arrival_time &&
    link.icao24 === aircraft.icao24?.toLowerCase() &&
    link.callsign === normalized(aircraft.callsign) &&
    !aircraftLinkProblem(flight, aircraft, now),
  );
}

export function safeMediaUrl(value, origin) {
  try {
    const url = new URL(value, origin);
    return url.protocol === 'https:' || url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}
