// Street photos (review/street-photos P5): which public photo shows a place,
// which way a 360° one looks on a wall, and every line said about it. Pure:
// no DOM, no Cesium, no network. The proxy (server/tripTwin/streetPhotoProxy.js)
// finds the photos; walls, the All-in-one and the remote all ask this module,
// so every surface shows the same photo with the same words.
//
// A photo helps you recognise a place. It never says the place is open,
// reachable or unchanged, and it feeds nothing: no brief row, no "needs a
// look", no routing.
import { formatDistance, haversineM } from './twinData.js';

export const PHOTO_RADIUS_M = 250;
/** About one block face: a 2 m door is still ~55 px wide in a 2,048 px photo. */
export const DOOR_BAND_M = 60;
/** A flat photo with no recorded field of view counts as a phone's (70°). */
export const FLAT_UNKNOWN_FOV = 70;
/** A flat photo turned further than this from the place cannot show it. */
export const FLAT_EDGE_DEG = 60;
/** Frames of one run closer than this are the same view (UX round 1). */
export const SAME_VIEW_M = 15;
/**
 * A 360° view on a wall: 75° wide, near and far. Tried 60° on the approach
 * (UI round 1): with the ~30° compass errors of car-mounted photos the
 * Fairmont fell out of the frame. The operator narrows it by keeping a view.
 */
export const WALL_FOV = 75;
export const APPROACH_FOV = 75;
export const OLD_MONTHS = 36;

const RAD = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const wrap = (d) => ((d % 360) + 360) % 360;
const step5 = (d) => Math.round(d / 5) * 5;
const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
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

/** What a safety place's photo is of, by category (IA round 1). */
const PLACE_WORDS = {
  rally_primary: 'the rally point',
  rally_secondary: 'the rally point',
  safe_house: 'the group shelter',
  shelter: 'the shelter',
  relocation: 'the relocation site',
};

/**
 * What a place's photo is of. The hotel and a stop aim at a mapped main
 * entrance when the site's map has one (doors: twin.streets().doors), else
 * at the building; a rally point or shelter at its point.
 * @returns {{lat, lon, aim: 'entrance'|'building'|'point', heightM, key, words}}
 */
export function photoTarget({ kind, site = null, place = null, doors = [] }) {
  if (kind === 'place' && place) {
    const c = place.coordinates || place;
    return {
      lat: c.lat,
      lon: c.lng ?? c.lon,
      aim: 'point',
      heightM: 0,
      key: `place:${place.id}`,
      words: PLACE_WORDS[place.category] || 'the place',
    };
  }
  const main = doors.find((d) => d.atHotel && d.kind === 'main');
  const door = main || doors.find((d) => d.atHotel);
  const heightM = (site?.levels || 1) * (site?.floorHeightM || 3.3);
  // A stop as a sentence names it: "the Long Center", "Westminster Abbey"
  // (twinSites.js photoName; IA rounds 1–2).
  const name =
    kind === 'hotel'
      ? 'the hotel'
      : site?.photoName || site?.short || site?.label || 'the stop';
  return door
    ? {
        lat: door.lat,
        lon: door.lon,
        aim: 'entrance',
        heightM,
        key: `${kind}:${site?.key}`,
        words: main ? 'the main entrance' : 'the entrance',
      }
    : {
        lat: site.center.lat,
        lon: site.center.lon,
        aim: 'building',
        heightM,
        key: `${kind}:${site?.key}`,
        words: name,
      };
}

/**
 * Photos that show the target, best first. Within 250 m. A flat photo
 * faces the place when it is inside its frame (fov/2), sits at the edge up
 * to 60° off, and is dropped beyond; a photo with no heading ranks last.
 * Frames of one run closer than 15 m are the same view: the best one stays.
 * Order: at the door (≤ 60 m) before the approach, facing before edge
 * before not recorded, newest month first, then nearest. The kept photo
 * (keep: {provider, id}) always stays: the operator chose it.
 */
export function rankPhotos(items, target, { keep = null } = {}) {
  const out = [];
  const isKept = (p) =>
    Boolean(keep?.id) && p.id === keep.id && p.provider === keep.provider;
  for (const p of items || []) {
    const d = haversineM(target, p);
    if (!(d <= PHOTO_RADIUS_M) && !isKept(p)) continue;
    const toTarget = bearingDeg(p, target);
    let facing = true;
    if (p.heading == null) facing = null;
    else if (!p.isPano) {
      const off = gap(p.heading, toTarget);
      if (off > FLAT_EDGE_DEG && !isKept(p)) continue;
      facing = off <= (p.fov || FLAT_UNKNOWN_FOV) / 2 ? true : 'edge';
    }
    out.push({
      ...p,
      d,
      toTarget,
      facing,
      band: d <= DOOR_BAND_M ? 'door' : 'approach',
      month: p.capturedAt ? Math.floor(p.capturedAt / (30.44 * 86400e3)) : 0,
    });
  }
  const facingRank = (f) => (f === true ? 0 : f === 'edge' ? 1 : 2);
  out.sort(
    (a, b) =>
      (a.band === 'door' ? 0 : 1) - (b.band === 'door' ? 0 : 1) ||
      facingRank(a.facing) - facingRank(b.facing) ||
      b.month - a.month ||
      a.d - b.d,
  );
  const kept = [];
  return out.filter((p) => {
    if (
      !isKept(p) &&
      p.seq &&
      kept.some((q) => q.seq === p.seq && haversineM(q, p) < SAME_VIEW_M)
    )
      return false;
    kept.push(p);
    return true;
  });
}

/**
 * The fixed view a wall shows of a 360° photo: turned to the target, tilted
 * up for a tall building seen from down the street (aim at ~40 % of up to
 * 80 m), 75° wide. Snapped to 5° so every window asks for the same image.
 * Null for a flat photo (shown as taken).
 */
export function wallView(photo, target) {
  if (!photo?.isPano) return null;
  const d = Math.max(1, photo.d ?? haversineM(target, photo));
  const toTarget = photo.toTarget ?? bearingDeg(photo, target);
  const yaw = photo.heading == null ? 0 : step5(wrap(toTarget - photo.heading));
  const lift = Math.atan((0.4 * Math.min(target.heightM || 0, 80)) / d) / RAD;
  return {
    yaw: yaw % 360,
    pitch: Math.min(20, step5(lift)),
    fov: d <= DOOR_BAND_M ? WALL_FOV : APPROACH_FOV,
  };
}

/**
 * The photo a place shows: the operator's kept photo (session.photos) wins,
 * then the best ranked. kept: {provider, id, yaw?, pitch?, hide?, by?}.
 */
export function pickPhoto(ranked, target, kept = null) {
  if (kept?.hide) return { hidden: true, by: kept.by || null };
  if (kept?.id) {
    const found = ranked.find(
      (p) => p.id === kept.id && p.provider === kept.provider,
    );
    if (found) {
      const view = wallView(found, target);
      return {
        photo: found,
        kept: true,
        by: kept.by || null,
        view:
          view && Number.isFinite(kept.yaw)
            ? { ...view, yaw: kept.yaw, pitch: kept.pitch ?? view.pitch }
            : view,
      };
    }
    // Kept but no longer listed: the best ranked, and say so.
    const best = ranked[0];
    return best
      ? { photo: best, view: wallView(best, target), keptGone: true }
      : { none: true, keptGone: true };
  }
  const best = ranked[0];
  return best ? { photo: best, view: wallView(best, target) } : { none: true };
}

/** The view URL for a pick, at a width bucket (480 · 960 · 1440). */
export function photoUrl(pick, w = 960) {
  const p = pick?.photo;
  if (!p) return null;
  const q = new URLSearchParams({ p: p.provider, id: p.id, w: String(w) });
  if (pick.view) {
    q.set('yaw', String(pick.view.yaw));
    q.set('pitch', String(pick.view.pitch));
    q.set('fov', String(pick.view.fov));
  }
  return `/api/twin-photos/view?${q}`;
}

/** Bucket at or above a box's device pixels. */
export const widthBucket = (px) => (px <= 480 ? 480 : px <= 960 ? 960 : 1440);

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
/** `Apr 2025 · 1 year 6 months old`, counted to `now` (the walls' sample clock). */
export function photoAge(capturedAt, now) {
  if (!Number.isFinite(capturedAt))
    return { text: 'Date not recorded', old: false };
  const a = new Date(capturedAt);
  const b = new Date(now);
  const months = Math.max(
    0,
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
      (b.getUTCMonth() - a.getUTCMonth()) -
      (b.getUTCDate() < a.getUTCDate() ? 1 : 0),
  );
  const y = Math.floor(months / 12);
  const m = months % 12;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const age =
    months < 1
      ? 'under a month old'
      : `${[y && plural(y, 'year'), m && plural(m, 'month')].filter(Boolean).join(' ')} old`;
  return {
    text: `Taken ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()} · ${age}${months >= OLD_MONTHS ? ' · may look different now' : ''}`,
    old: months >= OLD_MONTHS,
  };
}

export const providerName = (p) =>
  p?.provider === 'kartaview' ? 'KartaView' : 'Panoramax';
/**
 * `Street photo: Terence Eden via Panoramax (CC BY-SA 4.0)`. modified: the
 * licence asks a changed work to say so (walls crop, turn and dim it).
 */
export function photoCredit(p, { modified = false } = {}) {
  if (!p) return '';
  const mod = modified ? ' · view cropped and dimmed' : '';
  if (p.provider === 'kartaview')
    return `Street photo: KartaView contributors (CC BY-SA 4.0)${mod}`;
  const lic = p.license ? ` (${p.license})` : '';
  const who = (p.creator || '').replace(/^mapcomplete,\s*/i, '');
  return who
    ? `Street photo: ${who} via Panoramax${lic}${mod}`
    : `Street photo: Panoramax contributors${lic}${mod}`;
}

/** "checked 4 min ago": minutes, hours or days, never seconds (IA round 1). */
export function checkedAgo(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return 'under a minute ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const WALL_FOOT =
  'Public photo · not a current view · not an inspection';
export const LONG_FOOT =
  "A public photo, not an inspection: it does not show that a door is open, step-free or unchanged · its direction comes from the photo's own compass, which can be off · faces and plates are blurred by the photo's host, if at all · not checked by SafeTrekr";

/**
 * Every line for one place. search: the proxy's /near answer (or null while
 * loading); pick: pickPhoto(); failed: found, but no image would load; now:
 * the walls' sample clock (ms); checkedNow: the real clock, for "checked …
 * ago"; where: 'wall' (walls and remote) or 'aio' (the All-in-one, where
 * hidden photos stay visible to the operator).
 * @returns {{state, kicker, dir, look, age, old, foot, credit, note, line}}
 *   line: the one dim sentence under a STREET PHOTO kicker when there is no
 *   picture.
 */
export function photoLines({
  search,
  pick,
  target,
  failed = false,
  now,
  checkedNow = Date.now(),
  unit,
  where = 'wall',
}) {
  const within = formatDistance(PHOTO_RADIUS_M, unit);
  if (!search) return { state: 'loading', line: 'Looking for street photos…' };
  if (pick?.hidden)
    return {
      state: 'hidden',
      line: where === 'aio' ? 'Hidden on walls' : 'Hidden at the All-in-one',
    };
  if (search.status !== 'ok' && !search.items?.length)
    return {
      state: 'unavailable',
      line: 'Not reachable right now · not checked',
    };
  // Found but none would load is never "none" (every-time P0-1).
  if (failed) return { state: 'failed', line: 'Found but would not load' };
  if (pick?.none || !pick?.photo) {
    const kv =
      search.checked && !search.checked.includes('kartaview')
        ? ' · KartaView not checked'
        : '';
    return {
      state: 'none',
      line: `None within ${within} · checked ${search.servedAt ? checkedAgo(Math.max(0, (checkedNow - search.servedAt) / 1000)) : 'now'}${kv}${search.offline ? ' · offline copy' : ''}`,
    };
  }
  const p = pick.photo;
  const from = `from ${formatDistance(p.d, unit)} ${compassWord(bearingDeg(target, p))}`;
  const look =
    p.heading == null
      ? null
      : pick.view
        ? wrap(p.heading + pick.view.yaw)
        : p.heading;
  const dir =
    look == null
      ? `Direction not recorded · ${from}`
      : p.facing === 'edge'
        ? `Facing ${compassWord(look)} · ${target.words} may be at the edge of the frame · ${from}`
        : `Facing ${compassWord(look)}, towards ${target.words} · ${from}${p.band === 'approach' && target.aim === 'entrance' ? ' · the door may not be visible' : ''}`;
  const age = photoAge(p.capturedAt, now);
  const notes = [
    pick.keptGone && 'Kept photo would not load · showing the next best',
    search.offline && 'Offline copy',
  ].filter(Boolean);
  return {
    state: pick.kept ? 'kept' : p.isPano ? 'found-pano' : 'found-flat',
    kicker: `STREET PHOTO · ${providerName(p).toUpperCase()}${p.isPano ? ' · 360°' : ''}${pick.kept ? ' · KEPT' : ''}`,
    dir,
    look,
    age: age.text,
    old: age.old,
    foot: WALL_FOOT,
    credit: photoCredit(p, { modified: true }),
    note: notes.join(' · ') || null,
    line: null,
  };
}
