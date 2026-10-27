// Traffic cameras (review/traffic-cameras T5): which public cameras are near
// a place and every line said about one. Pure: no DOM, no Cesium, no network.
// The proxy (server/tripTwin/cameraProxy.js) lists them and shares their
// stills; walls, the All-in-one and the remote all take their words here.
//
// A camera near the hotel does not show the hotel, the group or anyone in
// it. It feeds nothing: no "needs a look", no headline, no review.
import { formatDistance } from './twinData.js';

export const NEAR_M = 500;
export const INCIDENT_M = 1000;
export const WALL_REFRESH_S = 30;
export const UNCHANGED_MS = 10 * 60e3;
/** Two missed refreshes: the picture on screen is no longer current. */
export const STALE_AFTER_MS = 75e3;
export const LIST_MAX = 5;

const RAD = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const wrap = (d) => ((d % 360) + 360) % 360;
export const compassWord = (deg) => COMPASS[Math.round(wrap(deg) / 45) % 8];
export function bearingDeg(from, to) {
  const y = Math.sin((to.lon - from.lon) * RAD) * Math.cos(to.lat * RAD);
  const x =
    Math.cos(from.lat * RAD) * Math.sin(to.lat * RAD) -
    Math.sin(from.lat * RAD) *
      Math.cos(to.lat * RAD) *
      Math.cos((to.lon - from.lon) * RAD);
  return wrap(Math.atan2(y, x) / RAD);
}

const AGENCY = {
  austin: 'AUSTIN',
  tfl: 'TFL',
  txdot: 'TXDOT',
  'txdot-aus': 'TXDOT',
  'txdot-sat': 'TXDOT',
  caltrans: 'CALTRANS',
};
/** The agency, short and in capitals: AUSTIN, TFL (one line on a wall). */
export function cameraAgency(c) {
  const p = String(c?.pack || '').toLowerCase();
  if (AGENCY[p]) return AGENCY[p];
  if (p.startsWith('caltrans')) return 'CALTRANS';
  if (p.startsWith('txdot')) return 'TXDOT';
  return String(c?.provider || c?.pack || 'PUBLIC AGENCY').toUpperCase();
}

/** Road codes that stay in capitals: "35 SVRD", "IH 35 NB", "US 183". */
const KEEP_CAPS = new Set([
  'SVRD',
  'NB',
  'SB',
  'EB',
  'WB',
  'US',
  'IH',
  'SH',
  'FM',
  'RM',
  'TX',
  'SR',
  'I',
]);
/**
 * Austin's names come in capitals: "CESAR CHAVEZ ST / RED RIVER ST" →
 * "Cesar Chavez St / Red River St". Road codes and numbers stay.
 */
export function cameraName(name) {
  const s = String(name || '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s
    .split(/(\s+|\/|\(|\)|-)/)
    .map((w) =>
      w === 'BLK'
        ? 'Block'
        : /^\d+(ST|ND|RD|TH)$/.test(w)
          ? w.toLowerCase()
          : /\d/.test(w) || KEEP_CAPS.has(w)
            ? w
            : w.charAt(0) + w.slice(1).toLowerCase(),
    )
    .join('');
}

const KIND_WORD = {
  still: 'Still image',
  clip: 'Video clip',
  live: 'Live video',
};
export const kindWord = (k) => KIND_WORD[k] || 'Still image';

/**
 * The list for a place: nearest first, at most 5. A camera whose heading is
 * trusted and points within 45° of the place, within 150 m, goes first.
 */
export function rankCameras(cameras, target, { max = LIST_MAX } = {}) {
  const facing = (c) =>
    c.heading != null &&
    c.d <= 150 &&
    Math.abs(((bearingDeg(c, target) - c.heading + 540) % 360) - 180) <= 45;
  return [...(cameras || [])]
    .sort((a, b) => (facing(b) ? 1 : 0) - (facing(a) ? 1 : 0) || a.d - b.d)
    .slice(0, max);
}

/**
 * Who to credit, by agency (brand round 1): the agency named, and TfL's
 * attribution exactly as its terms ask.
 */
export function cameraCredit(c) {
  const p = String(c?.pack || '').toLowerCase();
  if (/fixture|test image/i.test(String(c?.license || '')))
    return 'Test image, not a camera';
  if (p === 'austin')
    return 'Image: City of Austin (Transportation & Public Works) · Open Data Terms';
  if (p === 'tfl')
    return 'Powered by TfL Open Data · Contains OS data © Crown copyright and database rights';
  if (p.startsWith('txdot')) return 'Image courtesy of TxDOT';
  if (p.startsWith('caltrans')) return 'Image: Caltrans';
  return [c?.provider, c?.license || c?.credit].filter(Boolean).join(' · ');
}

export const WALL_FOOT = 'Public road camera · not a view of the group';
export const LONG_FOOT =
  'A public road camera, not a view of the group: it does not show where anyone is · the time printed on the picture is the camera’s own, not the trip clock · not checked by SafeTrekr';

/**
 * Every line for one camera on a surface. camera: a /near record (with d);
 * target: {lat, lon, words}; frame: {fetchedAt, sameSince} or null; state:
 * 'loading' | 'ok' | 'failed'; now: the real clock (a duration, never a
 * clock time); unit: the walls' unit.
 */
export function cameraLines({
  camera,
  target,
  frame = null,
  state = 'ok',
  now = Date.now(),
  unit,
}) {
  const c = camera;
  const where = `${formatDistance(c.d, unit)} ${compassWord(bearingDeg(target, c))} of ${target.words}`;
  const looks =
    c.heading == null
      ? 'direction not known'
      : `pointed ${compassWord(c.heading)}`;
  // A picture fetched more than two refreshes ago is not current, whatever
  // the state says (every-time P0-1).
  const old =
    frame?.fetchedAt && now - frame.fetchedAt > STALE_AFTER_MS ? true : false;
  const st = state === 'ok' && (old || frame?.stale) ? 'failed' : state;
  const lines = {
    kicker: `TRAFFIC CAMERA · ${cameraAgency(c)} · STILL`,
    name: cameraName(c.name),
    where: `${where} · ${looks}`,
    time: `The time on the picture is the camera’s own, not the trip clock · a still, requested every ${WALL_REFRESH_S} s`,
    foot: WALL_FOOT,
    credit: cameraCredit(c),
    note: null,
    state: st,
  };
  if (st === 'loading') lines.note = 'Fetching the traffic camera…';
  else if (st === 'failed')
    lines.note = frame?.fetchedAt
      ? `Not refreshing · last image fetched ${agoWords(now - frame.fetchedAt)}`
      : 'Not answering right now · trying again';
  else if (frame?.sameSince && now - frame.sameSince >= UNCHANGED_MS)
    lines.note = `Picture unchanged for ${agoWords(now - frame.sameSince, false)}`;
  return lines;
}

/** "3 min ago", "1 h ago"; ago=false drops "ago". */
export function agoWords(ms, ago = true) {
  const m = Math.max(0, Math.round(ms / 60e3));
  const t =
    ms < 60e3
      ? 'under a minute'
      : m < 60
        ? `${m} min`
        : `${Math.round(m / 60)} h`;
  return ago ? `${t} ago` : t;
}

/** Farther than this to the nearest listed camera: no source covers the city. */
export const NO_SOURCE_M = 50e3;
/** The line where there is no camera to show. search: the /near answer. */
export function noCameraLine(search, { radius = NEAR_M, unit } = {}) {
  if (!search) return 'Looking for traffic cameras…';
  if (search.status !== 'ok')
    return 'Traffic camera list unavailable right now · not checked';
  // Washington: no camera source at all, not "none nearby" (UX round 1).
  if (search.nearestM == null || search.nearestM > NO_SOURCE_M)
    return 'No traffic camera source covers this city in Trip Twin';
  return `No traffic camera within ${formatDistance(radius, unit)}${search.trimmed ? ' among those loaded' : ''}`;
}

/** The frame URL for a camera. */
export const cameraFrameUrl = (id, bust = '') =>
  `/api/twin-cameras/frame?id=${encodeURIComponent(id)}${bust ? `&t=${bust}` : ''}`;
