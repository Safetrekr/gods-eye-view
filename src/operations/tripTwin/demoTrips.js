// SOC multi-view (phase 10): three sample trips running at once for the
// "Trips on watch" screen and the remote's trip picker. Each trip is one of
// the recorded cities with its own scenario. All people are fictional.
// Pure: tiles come from the same snapshot as the twin, no Cesium.
import { TWIN_CITIES } from './twinCities.js';
import { formatAge, positionState } from './twinData.js';
import { localClock, sunTimes, tripEvents } from './twinAdvance.js';
import { sitesForCity } from './twinSites.js';

// The trip list lives in demoTripList.js (pure data); re-exported here.
export {
  DEMO_TRIPS,
  isTripDemo,
  scenarioForTrip,
  tripById,
  tripForCity,
} from './demoTripList.js';
import { DEMO_TRIPS, tripById } from './demoTripList.js';

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
  { now = Date.now(), dataAgeS = 0, override = null, at = null } = {},
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
      tier: TIER.noData,
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
  // One wording on every surface: the banner's sentence (S6 plan).
  const incident = override
    ? override.incident || null
    : report
      ? reportSentence(report, now)
      : null;
  const tz = snapshot.trips?.[0]?.timezone || city?.timezone;
  // at: one moment for every trip (the header's, S6 plan), shown in each
  // trip's own zone; without it, the trip's own sample clock.
  const today = new Date(at ?? now).toLocaleDateString('en-CA', {
    timeZone: tz,
  });
  const hhmm =
    at != null
      ? localTime(at, tz)
      : override?.localTime || sampleTime(snapshot) || localTime(now, tz);
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
    // The city by its name, beside its clock (the hotel is on the org line).
    place:
      CITY_NAME[trip.city] ||
      `${String(trip.city)[0].toUpperCase()}${String(trip.city).slice(1)}`,
    zone: zoneName(at ?? now, tz),
    day: dayText(today).split(' ')[0],
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
    nextParts: next
      ? {
          today: next.event_date === today,
          iso: next.event_date,
          day: dayText(next.event_date),
          start: next.start_time,
          title: next.title,
        }
      : null,
    // Need, not name, decides the order (travel-risk review).
    need:
      (incident ? 100 : 0) + notCurrent * 2 + notLocated * 3 + (stale ? 20 : 0),
    // Tiers, never a sum (S6 plan): a trip moves only when its tier does.
    tier: incident
      ? TIER.report
      : stale
        ? TIER.stale
        : notLocated
          ? TIER.notLocated
          : notCurrent
            ? TIER.notCurrent
            : TIER.calm,
  };
}

const CITY_NAME = Object.freeze({
  austin: 'Austin',
  dc: 'Washington',
  london: 'London',
});

/** Need tiers, worst first (S6 plan): report › no data › delayed › … */
export const TIER = Object.freeze({
  report: 0,
  noData: 1,
  stale: 2,
  notLocated: 3,
  notCurrent: 4,
  calm: 5,
});

/** "Smoke reported, floor 9 (hotel desk, 2 min ago, not verified)". */
export function reportSentence(r, now = Date.now()) {
  const kind = String(r.kind || 'incident');
  const ageMin = r.reported_at
    ? Math.max(0, Math.round((now - Date.parse(r.reported_at)) / 60e3))
    : null;
  const parts = [
    r.source,
    ageMin != null ? `${ageMin} min ago` : null,
    r.verified ? 'verified' : 'not verified',
  ].filter(Boolean);
  return `${kind[0].toUpperCase()}${kind.slice(1)} reported${r.floor_label != null ? `, floor ${r.floor_label}` : ''} (${parts.join(', ')})`;
}

/** The zone's short name at a moment: "GMT", "EDT". */
function zoneName(ms, timeZone) {
  try {
    return (
      new Date(ms)
        .toLocaleTimeString(/^America\//.test(timeZone) ? 'en-US' : 'en-GB', {
          timeZone,
          timeZoneName: 'short',
        })
        .split(' ')
        .pop() || ''
    );
  } catch {
    return '';
  }
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

/**
 * Tiles in order of need: by tier, then the trip order (or by name with
 * order 'name'; S6 plan). Tiles without a tier fall back to need.
 */
export function sortTiles(tiles, { order = 'need' } = {}) {
  const tierOf = (t) => t.tier ?? (t.need >= 100 ? 0 : t.noData ? 1 : 5);
  return tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) =>
      order === 'name'
        ? // By name, but a report, no data or delayed data still leads
          // (S6 r1: a report never sinks to the last slot).
          Number(tierOf(a.t) > TIER.stale) - Number(tierOf(b.t) > TIER.stale) ||
          String(a.t.title).localeCompare(String(b.t.title))
        : tierOf(a.t) - tierOf(b.t) || a.i - b.i,
    )
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
    // Day 1 lists its stops in plan order (London: Heathrow T5, then the
    // hotel); other days the hotel first.
    const keys =
      d === 1
        ? [...evs.map((e) => e.siteKey), sites[0].key]
        : [sites[0].key, ...evs.map((e) => e.siteKey)];
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
