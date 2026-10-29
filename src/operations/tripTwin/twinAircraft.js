// Trip Twin live aircraft (Jesse, 29 Oct 2026): the poll, the words and the
// sums for the Live aircraft layer. Pure: no DOM, no Cesium, no network of
// its own (the page passes fetch and timers), so the rules are tested.
//
// Rules: the layer is off by default and nothing is fetched while it is off
// or the page is hidden; on, it asks /api/twin-aircraft (server/tripTwin/
// aircraftProxy.js) every 15 s. Aircraft are LIVE public data, never sample:
// the line says LIVE, STALE, RECORDED or not answering, and names its source
// (OpenSky Network, or upstream's adsb.lol fallback). People stay SAMPLE and
// are never named here.

export const AIRCRAFT_LAYER = 'aircraft';
export const AIRCRAFT_POLL_MS = 15e3;
export const AIRCRAFT_R_KM = 40;
/** Older than this (feed time) the line says STALE. */
export const AIRCRAFT_STALE_S = 60;
/** Older than this nothing is drawn: none rather than old planes. */
export const AIRCRAFT_DROP_S = 5 * 60;
/** A fix is carried forward along its track at most this long. */
export const EXTRAPOLATE_MAX_S = 25;
/** Callsigns show when the camera is nearer than this (metres). */
export const AIRCRAFT_LABEL_FAR_M = 7000;

/** The route for a point (the site's centre) and radius. */
export function aircraftUrl(center, rKm = AIRCRAFT_R_KM) {
  const lat = Number(center?.lat);
  const lon = Number(center?.lon ?? center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `/api/twin-aircraft?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&r=${rKm}`;
}

const shortSource = (s) => (s ? String(s) : 'OpenSky Network');

function ago(s) {
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${Math.max(0, Math.round(s))} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/**
 * What the layer shows now, from the last answer and how long ago it came:
 * {status: 'off'|'loading'|'live'|'stale'|'recorded'|'unavailable', ageS,
 * aircraft, count, rKm, source, feedAt, receivedAt}. A failing poll keeps the
 * last answer, ageing: STALE after a minute, nothing drawn after five.
 */
export function aircraftView(feed, nowMs = Date.now()) {
  if (!feed?.on) return { status: 'off', aircraft: [], count: 0 };
  const d = feed.data;
  if (!d) {
    return {
      status: feed.error ? 'unavailable' : 'loading',
      aircraft: [],
      count: 0,
      rKm: AIRCRAFT_R_KM,
      source: null,
    };
  }
  const since = Math.max(0, (nowMs - (feed.receivedAt ?? nowMs)) / 1000);
  const base = {
    rKm: d.rKm ?? AIRCRAFT_R_KM,
    source: d.source || null,
    feedAt: d.feedAt ?? null,
    receivedAt: feed.receivedAt ?? null,
  };
  if (d.status === 'recorded')
    return {
      ...base,
      status: 'recorded',
      ageS: null,
      aircraft: d.aircraft || [],
      count: (d.aircraft || []).length,
    };
  const ageS = Number.isFinite(d.feedAgeS) ? d.feedAgeS + since : null;
  if (
    d.status === 'unavailable' ||
    !Number.isFinite(ageS) ||
    ageS > AIRCRAFT_DROP_S
  )
    return { ...base, status: 'unavailable', ageS, aircraft: [], count: 0 };
  const status =
    d.status === 'stale' || ageS > AIRCRAFT_STALE_S ? 'stale' : 'live';
  return {
    ...base,
    status,
    ageS,
    aircraft: d.aircraft || [],
    count: (d.aircraft || []).length,
  };
}

const UTC = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const mon = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
};

/**
 * The status line, which is also the credit (the attribution bar and the
 * Layers key): "LIVE aircraft · OpenSky Network · 19 within 40 km ·
 * updated 6 s ago". Never says sample; a recording never says LIVE.
 */
export function aircraftLine(view) {
  if (!view || view.status === 'off') return '';
  const src = shortSource(view.source);
  const within = `${view.count} within ${view.rKm ?? AIRCRAFT_R_KM} km`;
  switch (view.status) {
    case 'loading':
      return `Aircraft · ${src} · loading`;
    case 'live':
      return `LIVE aircraft · ${src} · ${within} · updated ${ago(view.ageS)}`;
    case 'stale':
      return `STALE aircraft · ${src} · ${within} · last update ${ago(view.ageS)}`;
    case 'recorded':
      return `RECORDED aircraft · ${src} · ${within} · recorded ${UTC(view.feedAt)}`;
    default:
      return `Aircraft · ${src} not answering · none drawn`;
  }
}

/** The word on the map: the callsign, else the hex address. */
export const aircraftTitle = (a) =>
  a?.callsign || String(a?.icao24 || '').toUpperCase();

/**
 * Where a fix is dtS seconds later along its track (flat-earth step: a
 * 25 s step is at most a few km). Ground aircraft are not carried forward:
 * a taxiing aircraft turns.
 */
export function extrapolate(a, dtS) {
  const t = Math.max(0, Math.min(EXTRAPOLATE_MAX_S, Number(dtS) || 0));
  if (
    !t ||
    a.onGround ||
    !Number.isFinite(a.speedMs) ||
    !Number.isFinite(a.trackDeg)
  )
    return { lat: a.lat, lon: a.lon, altM: a.altM };
  const d = a.speedMs * t;
  const th = (a.trackDeg * Math.PI) / 180;
  const lat = a.lat + (d * Math.cos(th)) / 111_320;
  const lon =
    a.lon + (d * Math.sin(th)) / (111_320 * Math.cos((a.lat * Math.PI) / 180));
  const altM =
    Number.isFinite(a.altM) && Number.isFinite(a.vRateMs)
      ? a.altM + a.vRateMs * t
      : a.altM;
  return { lat, lon, altM };
}

/**
 * Height to draw at, above the ellipsoid (the twin's frame): on the ground
 * just above the site's heightfield; in the air the reported altitude (baro,
 * else geometric, taken as above mean sea level) plus the geoid, never
 * below the ground.
 */
export function aircraftHeightM(a, groundM, geoidN = 0) {
  const g = Number.isFinite(groundM) ? groundM : 0;
  if (a.onGround || !Number.isFinite(a.altM)) return g + 1.5;
  return Math.max(g + 4, a.altM + (Number.isFinite(geoidN) ? geoidN : 0));
}

/**
 * The poll. o: {fetchJson(url) → Promise<json>, center() → {lat, lon},
 * visible() → page visible, onChange(state), now, setTimer, clearTimer,
 * pollMs, rKm}. Fetches only while on and visible: setOn(true) asks at once,
 * then every pollMs; off forgets the answer (turning on again never shows
 * old planes). recenter() asks again for a new site.
 */
export function createAircraftFeed(o = {}) {
  const now = o.now || (() => Date.now());
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((t) => clearTimeout(t));
  const visible = o.visible || (() => true);
  const pollMs = o.pollMs || AIRCRAFT_POLL_MS;
  let on = false;
  let timer = null;
  let busy = false;
  let gen = 0;
  let data = null;
  let receivedAt = null;
  let error = null;
  let fetches = 0;
  const state = () => ({ on, data, receivedAt, error, fetches });
  const changed = () => o.onChange?.(state());
  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  function schedule(ms) {
    stop();
    if (on && visible()) timer = setTimer(tick, ms);
  }
  async function tick() {
    timer = null;
    if (!on || !visible() || busy) return;
    const url = aircraftUrl(o.center?.(), o.rKm || AIRCRAFT_R_KM);
    if (!url) return schedule(pollMs);
    const my = (gen += 1);
    busy = true;
    fetches += 1;
    try {
      const d = await o.fetchJson(url);
      if (my !== gen || !on) return;
      if (!d || !Array.isArray(d.aircraft)) throw new Error('bad answer');
      data = d;
      receivedAt = now();
      error = null;
    } catch (e) {
      if (my !== gen || !on) return;
      error = String(e?.message || e || 'error');
    } finally {
      if (my === gen) busy = false;
    }
    changed();
    schedule(pollMs);
  }
  return {
    get on() {
      return on;
    },
    state,
    setOn(next) {
      next = Boolean(next);
      if (next === on) return;
      on = next;
      gen += 1;
      busy = false;
      stop();
      data = null;
      receivedAt = null;
      error = null;
      changed();
      if (on) tick();
    },
    /** Visible again: ask now if the last answer is due, else at its time. */
    visibilityChanged() {
      if (!on) return;
      if (!visible()) return stop();
      if (timer !== null || busy) return;
      const due = receivedAt === null ? 0 : receivedAt + pollMs - now();
      if (due <= 0) tick();
      else schedule(due);
    },
    recenter() {
      if (!on) return;
      gen += 1;
      busy = false;
      data = null;
      receivedAt = null;
      stop();
      changed();
      tick();
    },
    dispose() {
      on = false;
      gen += 1;
      stop();
    },
  };
}
