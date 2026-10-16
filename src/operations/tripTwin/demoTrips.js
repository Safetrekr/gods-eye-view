// SOC multi-view (phase 10): three sample trips running at once for the
// "Trips on watch" screen and the remote's trip picker. Each trip is one of
// the recorded cities with its own scenario. All people are fictional.
// Pure: tiles come from the same snapshot as the twin, no Cesium.
import { TWIN_CITIES } from './twinCities.js';
import { formatAge, positionState } from './twinData.js';
import { localClock, sunTimes, tripEvents } from './twinAdvance.js';
import { sitesForCity } from './twinSites.js';

export const DEMO_TRIPS = Object.freeze([
  {
    id: 'trip-choir-austin',
    title: 'Spring choir tour',
    org: 'Riverside Choir',
    orgShort: 'RC',
    city: 'austin',
    scenario: 'baseline',
  },
  {
    id: 'trip-band-dc',
    title: 'Jazz band trip',
    org: 'Lincoln High Jazz Band',
    orgShort: 'LJ',
    city: 'dc',
    scenario: 'b',
  },
  {
    id: 'trip-youth-london',
    title: 'Youth choir tour',
    org: 'St Anne’s Youth Choir',
    orgShort: 'SA',
    city: 'london',
    scenario: 'a',
  },
]);

export const tripById = (id) =>
  DEMO_TRIPS.find((t) => t.id === id) || DEMO_TRIPS[0];
export const tripForCity = (cityKey) =>
  DEMO_TRIPS.find((t) => t.city === cityKey) || DEMO_TRIPS[0];

const localTime = (now, timeZone) =>
  new Date(now).toLocaleTimeString('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * One tile for the Trips on watch screen. snapshot = tripTwinDemoSnapshot
 * for that trip; dataAgeS = seconds since the snapshot arrived (null = no
 * data). Never "all clear": no data is grey and says since when.
 */
export function tripTile(
  trip,
  snapshot,
  { now = Date.now(), dataAgeS = 0, override = null } = {},
) {
  const city = TWIN_CITIES[trip.city];
  if (!snapshot)
    return {
      id: trip.id,
      title: trip.title,
      org: trip.org,
      city: city?.label || trip.city,
      noData: true,
      line: 'No data received',
      need: 1,
    };
  // Positions age from the data, like the walls (review/phase10 R3).
  const people = snapshot.participants || [];
  let notCurrent = 0;
  let notLocated = 0;
  for (const p of people) {
    const pos = positionState(p, dataAgeS || 0);
    if (!pos.located) notLocated += 1;
    else if (!pos.current) notCurrent += 1;
  }
  if (override) {
    notCurrent = override.notCurrent ?? notCurrent;
    notLocated = override.notLocated ?? notLocated;
  }
  const report = snapshot.reported_incidents?.[0] || null;
  const incident = override
    ? override.incident || null
    : report
      ? `Reported: ${report.kind} · floor ${report.floor_label} · not verified`
      : null;
  const tz = snapshot.trips?.[0]?.timezone || city?.timezone;
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
  // The sample clock, as every wall header shows it.
  const hhmm =
    override?.localTime || sampleTime(snapshot) || localTime(now, tz);
  const next = (snapshot.itinerary || [])
    .filter(
      (e) =>
        e.event_date > today ||
        (e.event_date === today && (e.start_time || '') >= hhmm),
    )
    .sort((a, b) =>
      `${a.event_date} ${a.start_time}`.localeCompare(
        `${b.event_date} ${b.start_time}`,
      ),
    )[0];
  const stale = dataAgeS != null && dataAgeS > 120;
  return {
    id: trip.id,
    title: trip.title,
    org: trip.org,
    city: city?.label || trip.city,
    localTime: hhmm,
    people: people.length,
    notCurrent,
    notLocated,
    incident,
    next: next
      ? `${next.event_date === today ? 'Today' : dayText(next.event_date)} ${next.start_time} · ${next.title}`
      : 'No more events on the plan',
    data: stale
      ? `Data delayed · ${formatAge(dataAgeS)} old`
      : `Data ${formatAge(dataAgeS || 0)} old`,
    stale,
    // Need, not name, decides the order (travel-risk review).
    need:
      (incident ? 100 : 0) + notCurrent * 2 + notLocated * 3 + (stale ? 20 : 0),
  };
}

/** "Sat 17 Oct" for a date string. */
const dayText = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** The scenario's sample clock (clock + elapsed), "HH:MM". */
function sampleTime(snapshot) {
  const sc = snapshot?.scenario;
  if (!sc?.clock) return null;
  const [h, m] = sc.clock.split(':').map(Number);
  const mins = (h * 60 + m + Math.floor((sc.elapsed_s || 0) / 60)) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Tiles in order of need; ties keep the trip order. */
export function sortTiles(tiles) {
  return tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.need - a.t.need || a.i - b.i)
    .map((x) => x.t);
}

const PLACE_LABEL = {
  hospital: 'Hospital',
  police: 'Police',
  fire: 'Fire station',
  embassy: 'Embassy',
  rally_primary: 'Rally point (primary)',
  rally_secondary: 'Rally point (secondary)',
  safe_house: 'Group shelter',
  relocation: 'Relocation site',
};

/**
 * Every day of a trip with its plan, for the remote's Trip station:
 * [{day, date, events: [{key, start, end, title, siteKey, site}], sites:
 * [{key, label, places: [{id, kind, name, draft}]}], sunset, flags}]. Flags
 * say what to check, never that something is fine.
 */
export function tripDays(trip, snapshot) {
  const t = snapshot?.trips?.[0];
  if (!t?.start_date) return [];
  const tz = t.timezone;
  const sites = sitesForCity(trip.city);
  const events = tripEvents(snapshot, sites, tz);
  const start = Date.parse(`${t.start_date}T12:00:00Z`);
  const end = Date.parse(`${t.end_date || t.start_date}T12:00:00Z`);
  const days = [];
  for (let d = 1, ms = start; ms <= end; d++, ms += 86400000) {
    const date = new Date(ms).toISOString().slice(0, 10);
    const evs = events.filter((e) => e.date === date);
    const keys = [sites[0].key, ...evs.map((e) => e.siteKey)];
    const daySites = [...new Set(keys)].map((key) => {
      const site = sites.find((x) => x.key === key);
      const place = snapshot.places?.find((p) => p.site_key === key);
      const places = (snapshot.safety_points || [])
        .filter((p) => place && p.location_id === place.id)
        .map((p) => ({
          id: p.id,
          kind: p.category,
          label: PLACE_LABEL[p.category] || p.category,
          name: p.name,
          draft: p.approval_status !== 'active',
        }));
      return { key, label: site?.short || site?.label || key, places };
    });
    const c = sites[0].center;
    const set = sunTimes(date, c.lat, c.lon ?? c.lng).set;
    const sunset = set ? localClock(set, tz) : null;
    const flags = [];
    // Local "HH:MM" strings compare in order.
    for (const e of evs)
      if (sunset && e.end && e.end > sunset)
        flags.push(`${e.title} ends ${e.end}, after sunset ${sunset}`);
    for (const s of daySites)
      for (const p of s.places)
        if (p.draft && /^rally/.test(p.kind))
          flags.push(`${p.label} at ${s.label} is a draft · not approved`);
    days.push({
      day: d,
      date,
      events: evs.map((e) => ({
        key: e.key,
        start: e.start,
        end: e.end,
        title: e.title,
        siteKey: e.siteKey,
        site: sites.find((x) => x.key === e.siteKey)?.short || e.siteKey,
      })),
      sites: daySites,
      sunset,
      flags,
    });
  }
  return days;
}
