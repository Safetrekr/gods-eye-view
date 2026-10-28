// SafeTrekr Executive B3: what the walls need beside the loop. Pure, shared
// by the relay (loopHost.js) and the wall pages.
//   briefOf(day)     the day's brief for MAIN (beat 0): callsigns only
//   geoOf(day)       paths, places and the map notice, for the walls that
//                    draw (never MAIN); sent once per loop message
//   mainScene(loop)  where MAIN's map goes: the top row's venue, its named
//                    entrance and the person's last fix. No name, no intel.
//   focusOf(loop)    the person the Principal view follows
//   SITE_OF_PLACE    executive place → Trip Twin site twin (twinSites.js)
import { legShort, localTime, lz, watchTime } from '../format.js';
import { byExposure, mainRowFor } from './select.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));

/**
 * The executive venues that are Trip Twin site twins (twinCities.js,
 * twinSites.js). IAD and the rest have none: those fall back to the flat map.
 */
export const SITE_OF_PLACE = Object.freeze({
  'pl-fairmont-austin': 'austin',
  'pl-long-center': 'austin-long-center',
  'pl-park-plaza-waterloo': 'london',
  'pl-royal-festival-hall': 'london-festival-hall',
  'pl-kennedy-center': 'dc-kennedy-center',
});

/** The cities on the roster map and MAIN's time strip, with their zones. */
export const CITIES = Object.freeze([
  {
    name: 'Austin',
    short: 'AUSTIN',
    tz: 'America/Chicago',
    lat: 30.27,
    lon: -97.74,
  },
  {
    name: 'Washington DC',
    short: 'DC',
    tz: 'America/New_York',
    lat: 38.9,
    lon: -77.04,
  },
  {
    name: 'New York',
    short: 'NEW YORK',
    tz: 'America/New_York',
    lat: 40.75,
    lon: -73.98,
  },
  {
    name: 'Miami',
    short: 'MIAMI',
    tz: 'America/New_York',
    lat: 25.77,
    lon: -80.19,
  },
  {
    name: 'London',
    short: 'LONDON',
    tz: 'Europe/London',
    lat: 51.5,
    lon: -0.12,
  },
  {
    name: 'Zurich',
    short: 'ZURICH',
    tz: 'Europe/Zurich',
    lat: 47.37,
    lon: 8.54,
  },
  { name: 'Dubai', short: 'DUBAI', tz: 'Asia/Dubai', lat: 25.2, lon: 55.27 },
]);
/** The cities with a leg today (EP-36 §2.1: MAIN's strip, active cities only). */
export const ACTIVE_CITIES = Object.freeze([
  'Austin',
  'Washington DC',
  'London',
]);

/** `AUSTIN 0930L · DC 1030L · LONDON 1430L · 1430Z`. */
export function timeStrip(at) {
  const parts = ACTIVE_CITIES.map((n) => CITIES.find((c) => c.name === n)).map(
    (c) => `${c.short} ${localTime(at, c.tz)}`,
  );
  return `${parts.join(' · ')} · ${watchTime(at)}`;
}

/**
 * B7 (reviews R11 S2-6, R12 #7, R18 #3): one way to count the people on
 * watch, for MAIN's brief and the roster alike. A detail's leader and
 * agents are counted beside the protectees they cover, never as more
 * DETAIL protectees: `DETAIL 2 (+5 AGENTS) · REMOTE 1 · MONITORED 32 ·
 * 40 ON WATCH`. → {total, detail, agents, remote, monitored, line}
 */
export function postureCounts(people = {}, details = {}) {
  const crew = new Set();
  for (const d of Object.values(details || {}))
    for (const id of [d.leader, ...(d.agents || [])]) if (id) crew.add(id);
  const all = Object.values(people || {});
  const n = (k) =>
    all.filter((p) => p.protection === k && !crew.has(p.id)).length;
  const out = {
    total: all.length,
    detail: n('DETAIL'),
    agents: all.filter((p) => crew.has(p.id)).length,
    remote: n('REMOTE'),
    monitored: n('MONITORED'),
  };
  out.line = `DETAIL ${out.detail}${out.agents ? ` (+${out.agents} AGENTS)` : ''} · REMOTE ${out.remote} · MONITORED ${out.monitored} · ${out.total} ON WATCH`;
  return out;
}

/** MAIN's beat-0 brief (EP-36 §2.2): callsign, protection, city, leg. */
export function briefOf(day) {
  const b = day?.brief;
  if (!b) return null;
  const rows = [];
  const seen = new Set();
  for (const id of b.legs || []) {
    const leg = day.legs?.[id];
    const p = leg && day.people?.[leg.person_id];
    if (!leg || !p) continue;
    // One row per person: their first leg of the day in the brief.
    const who =
      leg.participants?.length > 1 && /^p-swift/.test(p.id)
        ? 'SWIFT 1–2'
        : p.callsign;
    if (seen.has(who)) continue;
    seen.add(who);
    rows.push(
      `${who} · ${p.protection} · ${String(leg.city || p.current_city || '').toUpperCase()} · ${legShort(leg)} (${watchTime(leg.start)})`,
    );
  }
  const prot = b.protection || {};
  const c = postureCounts(day.people, day.details);
  // The roster's own brief counts protectees; the people agree with it.
  const agrees = ['DETAIL', 'REMOTE', 'MONITORED'].every(
    (k) => (prot[k] ?? 0) === c[k.toLowerCase()],
  );
  return {
    sample: true,
    header: `DAILY BRIEF ${watchTime(b.at)} · ${b.legs_today} LEGS TODAY`,
    counts: agrees
      ? c.line
      : ['DETAIL', 'REMOTE', 'MONITORED']
          .map((k) => `${k} ${prot[k] ?? 0}`)
          .join(' · '),
    posture: c,
    rows,
  };
}

/** The walls' map data, once: paths (lat/lon pairs), places, the notice. */
export function geoOf(day) {
  const paths = (day?.paths || []).map((p) => ({
    id: p.id,
    leg_id: p.leg_id ?? null,
    subjects: p.subjects || [],
    mode: p.mode ?? null,
    planned: /^PLANNED/.test(p.note || ''),
    precision: p.precision ?? null,
    departed: p.departed ?? null,
    arrived: p.arrived ?? null,
    coords: (p.coords || []).map(([lat, lon]) => [lat, lon]),
  }));
  const places = {};
  for (const [id, pl] of Object.entries(day?.places || {}))
    places[id] = {
      id,
      name: pl.name,
      lat: pl.lat,
      lon: pl.lon,
      city: pl.city ?? null,
      precision: pl.precision ?? null,
      entrances: (pl.entrances || []).map((e) => ({
        name: e.name,
        side: e.side ?? null,
        lat: e.lat,
        lon: e.lon,
      })),
    };
  const trips = (day?.trips || []).map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind ?? null,
    lead_person: t.lead_person,
    city: t.city ?? null,
    protection: t.protection ?? null,
    leg_ids: t.leg_ids || [],
  }));
  return {
    sample: true,
    paths,
    places,
    trips,
    attribution: {
      text: '© OpenStreetMap contributors',
      url: day?.attribution?.url || 'https://www.openstreetmap.org/copyright',
    },
  };
}

/**
 * Active situations on MAIN, in MAIN's own order (EP-34 §5: time until
 * exposure, then posture, then raised): the same comparator selectMain
 * sorts its rows with, so the map always follows the top row.
 */
function activeOnMain(loop) {
  return Object.values(loop.situations)
    .filter((s) => s.state !== 'CLOSED' && mainRowFor(loop, s.sit_id).row)
    .sort(byExposure(loop));
}

/** A hazard area's label on MAIN: a fixed word, never the intel's text. */
const AREA_LABEL = (b) =>
  /storm|thunder/.test(String(b?.event_type || ''))
    ? 'Storm line'
    : b?.category === 'weather'
      ? 'Weather area'
      : 'Hazard area';

/**
 * The posts on a situation, geometry and callsigns only (B7, F2 S2): the
 * advance where its SALUTE was filed, and a post a detail member took up
 * (ATLAS 4's +1 post) until he stands it down.
 */
function postsOf(loop, s) {
  const out = [];
  for (const id of s.salute_ids || []) {
    const sal = loop.salutes[id];
    const at = sal?.location;
    if (at?.lat != null)
      out.push({
        label: `${loop.people[sal.person_id]?.callsign ?? ''} · advance`,
        lat: at.lat,
        lon: at.lon,
      });
  }
  const held = new Map();
  for (const c of loop.checkins || []) {
    if (c.sit_id !== s.sit_id) continue;
    if (c.post?.lat != null) held.set(c.person_id, c.post);
    else if (c.status === 'post_released') held.delete(c.person_id);
  }
  for (const [pid, at] of held)
    out.push({
      label: `${loop.people[pid]?.callsign ?? ''} · +1 post`,
      lat: at.lat,
      lon: at.lon,
    });
  return out;
}

/**
 * Where MAIN's map goes (EP-31 §2: "the map follows the top row's site:
 * the leg, the named entrance, the person"). Null when nothing is active.
 * B7 (fix list #12, F2 S2): with `geo` (geoOf), the leg's origin and the
 * route driven on it, the situation's hazard polygon, the venue's
 * entrances and the posts. Geometry, place names and callsigns only:
 * never a person's name or the intel's text.
 */
export function mainScene(loop, geo = null) {
  const s = activeOnMain(loop)[0];
  if (!s) return null;
  const leg = loop.legs[s.leg_id];
  const pl = leg?.place;
  const rec = loop.recommendations[s.recommendation_id];
  const dest = rec?.destination;
  const entrance =
    dest && pl?.entrances?.some((e) => e.name === dest.name)
      ? { name: dest.name, lat: dest.lat, lon: dest.lon }
      : null;
  const fix = loop.positions[s.person_id];
  return {
    sample: true,
    callsign: s.callsign,
    place_id: pl?.place_id ?? null,
    site: SITE_OF_PLACE[pl?.place_id] ?? null,
    venue: pl ? { name: pl.name, lat: pl.lat, lon: pl.lon } : null,
    entrance,
    leg: leg ? legShort(leg) : null,
    at: leg ? lz(leg.start, leg.tz) : null,
    person:
      fix && fix.precision === 'point'
        ? { lat: fix.lat, lon: fix.lon, at: fix.at }
        : null,
    origin:
      leg?.origin?.lat != null
        ? { name: leg.origin.name, lat: leg.origin.lat, lon: leg.origin.lon }
        : null,
    route:
      (geo?.paths || []).find((p) => p.leg_id === s.leg_id && !p.planned)
        ?.coords ?? null,
    areas: (s.intel_ids || [])
      .map((id) => loop.intel[id])
      .filter((b) => b?.hazard_area && b.geo?.polygon?.length > 2)
      .map((b) => ({
        kind: 'weather',
        name: AREA_LABEL(b),
        label: AREA_LABEL(b),
        polygon: b.geo.polygon,
      })),
    entrances: (pl?.entrances || []).map((e) => ({
      name: e.name,
      side: e.side ?? null,
      lat: e.lat,
      lon: e.lon,
    })),
    posts: postsOf(loop, s),
  };
}

/** The beat the loop's clock is in, from the beat anchors it carries. */
export function beatOf(loop) {
  const t = ms(loop.clock.simNow);
  let n = 0;
  for (const [k, at] of Object.entries(loop.beats || {}))
    if (ms(at) <= t && Number(k) > n) n = Number(k);
  return n;
}

/** The person the idle Principal view shows, by beat (EP-31 §4, EP-20 beat 5). */
const IDLE_FOCUS = Object.freeze({ 0: 'p-kestrel', 5: 'p-atlas' });

/**
 * The Principal view's subject: the active situation nearest exposure;
 * else the beat's idle person (KESTREL at beat 0, ATLAS at the close); else
 * the person of the last situation raised.
 */
export function focusOf(loop) {
  const active = activeOnMain(loop)[0];
  const sits = Object.values(loop.situations).sort(
    (a, b) => ms(b.raised_at) - ms(a.raised_at),
  );
  const open = active || sits.find((s) => s.state !== 'CLOSED');
  const beat = beatOf(loop);
  const pid = open
    ? open.person_id
    : (IDLE_FOCUS[beat] ?? sits[0]?.person_id ?? 'p-kestrel');
  const s =
    open ||
    sits.find((x) => x.person_id === pid && /^s-(?!intel)/.test(x.sit_id)) ||
    null;
  return { person_id: pid, sit_id: s?.sit_id ?? null, open: Boolean(open) };
}

/** The leg a person is on or next to at `t` (or the last one). */
export function legAt(loop, personId, t = ms(loop.clock.simNow)) {
  const legs = Object.values(loop.legs)
    .filter(
      (l) => l.person_id === personId || l.participants?.includes(personId),
    )
    .sort((a, b) => ms(a.start) - ms(b.start));
  const now = legs.filter((l) => ms(l.start) <= t && t < ms(l.end));
  // A meeting or a ground move beats the hotel stay it sits inside.
  const inside = now.find((l) => l.kind !== 'hotel') || now[0];
  return (
    inside || legs.find((l) => ms(l.start) > t) || legs[legs.length - 1] || null
  );
}
