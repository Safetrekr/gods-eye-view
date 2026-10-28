// SafeTrekr Executive: every time, place, grid and line format on screen
// (EP-36 §3, canonical per EP-38). Pure: a function of its arguments only,
// no clock. Times are instants (ISO or ms) plus an IANA zone; seconds never
// render. Over a cap or with a banned word, a formatter throws: nothing
// truncates on screen (EP-36 §4).
import * as mgrsLib from 'mgrs';
import { assertCap, assertPlain } from './words.js';

export { assertPlain, plainBreach, CAPS, assertCap } from './words.js';

// Vite reads the package's ESM build (named exports); Node its UMD build.
const mgrsForward = mgrsLib.forward || mgrsLib.default?.forward;
const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
const DTG = /^(\d{2})(\d{2})(\d{2})Z ([A-Z]{3}) (\d{2})$/;
/** `271812Z OCT 26` → ms, or NaN. */
export function parseDtg(s) {
  const m = DTG.exec(String(s).trim());
  if (!m || MONTHS.indexOf(m[4]) < 0) return NaN;
  return Date.UTC(
    2000 + Number(m[5]),
    MONTHS.indexOf(m[4]),
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  );
}
const ms = (t) =>
  typeof t === 'number' ? t : DTG.test(String(t)) ? parseDtg(t) : Date.parse(t);
const p2 = (n) => String(n).padStart(2, '0');

const zones = new Map();
/** Hour and minute of an instant in a zone. */
function hm(t, tz) {
  const d = new Date(ms(t));
  if (!tz || tz === 'UTC' || tz === 'Etc/UTC')
    return [d.getUTCHours(), d.getUTCMinutes()];
  let f = zones.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    zones.set(tz, f);
  }
  const parts = Object.fromEntries(
    f.formatToParts(d).map((x) => [x.type, x.value]),
  );
  return [Number(parts.hour) % 24, Number(parts.minute)];
}

/** `HHMM` in a zone (UTC when no zone). */
export const hhmm = (t, tz) => hm(t, tz).map(p2).join('');
/** `DDHHMMZ MON YY`, from UTC: 2026-10-27T14:35Z → 271435Z OCT 26. */
export function dtg(t) {
  const d = new Date(ms(t));
  return `${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCFullYear() % 100)}`;
}
/** Watch events (raised, verified, countersigned, signed): `HHMMZ` only. */
export const watchTime = (t) => `${hhmm(t)}Z`;
/** Local only, `HHMML` (ladder rungs, MAIN rows). */
export const localTime = (t, tz) => `${hhmm(t, tz)}L`;
/** Local first, `HHMML (HHMMZ)`: MAIN, phones, Principal view. */
export const lz = (t, tz) => `${hhmm(t, tz)}L (${hhmm(t)}Z)`;
/** Zulu first, `HHMMZ (HHMML)`: Verify, Intel feed, desk. */
export const zl = (t, tz) => `${hhmm(t)}Z (${hhmm(t, tz)}L)`;

/**
 * MGRS digits a position may carry (EP-36 §3): ≤2 m → 10, ≤20 → 8,
 * ≤200 → 6, ≤2000 → 4; coarser, or a region, → null (no grid, banner).
 */
export function mgrsDigits(accuracyM, precision = null) {
  if (precision === 'region' || accuracyM == null || !(accuracyM >= 0))
    return null;
  if (accuracyM <= 2) return 10;
  if (accuracyM <= 20) return 8;
  if (accuracyM <= 200) return 6;
  if (accuracyM <= 2000) return 4;
  return null;
}

/** `ZZB SQ EEEE NNNN` with the digits the accuracy allows, or null. */
export function mgrs(lat, lon, accuracyM, precision = null) {
  const digits = mgrsDigits(accuracyM, precision);
  if (!digits || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const raw = mgrsForward([lon, lat], digits / 2);
  const m = /^(\d{1,2}[A-Z])([A-Z]{2})(\d*)$/.exec(raw);
  if (!m || m[3].length !== digits) return null;
  const half = digits / 2;
  return `${m[1]} ${m[2]} ${m[3].slice(0, half)} ${m[3].slice(half)}`;
}

/** Digits in a formatted grid (0 for none). */
export const gridDigits = (g) =>
  g ? g.split(' ').slice(2).join('').length : 0;

/** `name · grid`; the grid is left out when there is none. */
export function place(p) {
  if (!p) return '—';
  const grid =
    p.mgrs !== undefined
      ? p.mgrs
      : mgrs(p.lat, p.lon, p.accuracy_m, p.precision);
  return grid ? `${p.name} · ${grid}` : p.name;
}

/** BLUF: ≤ 90, one line, capital or time first, no final stop, plain. */
export function bluf(text) {
  if (typeof text !== 'string' || !text) throw new Error('bluf: empty');
  if (/[\r\n]/.test(text))
    throw new Error(`bluf: more than one line: "${text}"`);
  if (!/^[A-Z0-9]/.test(text))
    throw new Error(`bluf: must start with a capital or a time: "${text}"`);
  if (/\.$/.test(text))
    throw new Error(`bluf: ends with a full stop: "${text}"`);
  assertCap('bluf', text);
  return assertPlain(text, 'bluf');
}

/** Metres under 1 km (to 10 m), else km (whole when within 0.05). */
export function distance(m) {
  if (m == null) return 'named';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  if (Math.abs(km - Math.round(km)) < 0.05) return `${Math.round(km)} km`;
  return `${km.toFixed(1)} km`;
}

const SALUTE_KEYS = [
  'SIZE',
  'ACTIVITY',
  'LOCATION',
  'UNIT',
  'TIME',
  'EQUIPMENT',
];
/** Six kickers in order; empty → `—`, never dropped; TIME is observed, Zulu first. */
export function salute(item) {
  const loc = item.location
    ? typeof item.location === 'string'
      ? item.location
      : place(item.location)
    : null;
  const values = [
    item.size,
    item.activity,
    loc,
    item.unit,
    item.time ? zl(item.time, item.tz) : null,
    item.equipment,
  ];
  return SALUTE_KEYS.map((k, i) => {
    const v = values[i] == null || values[i] === '' ? '—' : String(values[i]);
    assertCap('saluteValue', v);
    assertPlain(v, `salute ${k}`);
    return `${k} ${v}`;
  });
}

const SITREP_SLOTS = [
  'WHERE',
  'STATUS',
  'LAST CONTACT',
  'NEXT EVENT',
  'OPEN ITEMS',
  'SIGNED',
];
/** Six fixed slots, always six, `—` for empty; ≤ 60 each. */
export function sitrepSlots(record = {}) {
  return SITREP_SLOTS.map((k) => {
    const v = record[k] ?? record[k.replace(/ /g, '_')];
    const s = v == null || v === '' ? '—' : String(v);
    assertCap('sitrepSlot', s);
    assertPlain(s, `sitrep ${k}`);
    return [k, s];
  });
}
export const sitrep = (record) =>
  sitrepSlots(record)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

const RUNGS = ['delivered', 'read', 'accepted', 'done'];
/** The DL's answer replaces ACCEPTED on a DETAIL ladder (EP-36, EP-37 §1). */
export const DL_WORDS = Object.freeze({
  concur: 'CONCUR',
  nonconcur: 'NON-CONCUR',
  executing: 'EXECUTING',
  request_support: 'SUPPORT REQUESTED',
});
/**
 * `DELIVERED 1039L · READ 1041L · ACCEPTED 1044L · DONE 1218L`. l: {rungs:
 * {delivered, read, accepted, done} instants or null, tz, dl, dlAt,
 * expiredAt, callback: {minutes}}. While a call-back runs:
 * `NO READ · N MIN · CALLING`.
 */
export function ladder(l) {
  if (l.callback) return `NO READ · ${l.callback.minutes} MIN · CALLING`;
  const out = [];
  for (const r of RUNGS) {
    let word = r.toUpperCase();
    let at = l.rungs?.[r] ?? null;
    if (r === 'accepted' && l.dl) {
      word = DL_WORDS[l.dl];
      at = l.dlAt ?? at;
    }
    if (l.expiredAt && !at) {
      out.push(`EXPIRED ${localTime(l.expiredAt, l.tz)}`);
      return out.join(' · ');
    }
    out.push(`${word} ${at ? localTime(at, l.tz) : '—'}`);
  }
  return out.join(' · ');
}

/** `N in (intake + partner feeds) · M matched · R raised · P pushed[ · C closed]`. */
export function counter(c) {
  if (!(
    c.in >= c.matched &&
    c.matched >= c.raised &&
    c.raised >= c.pushed &&
    c.closed <= c.raised
  ))
    throw new Error(`counter: inequality fails ${JSON.stringify(c)}`);
  const s = `${c.in} in (intake + partner feeds) · ${c.matched} matched · ${c.raised} raised · ${c.pushed} pushed`;
  return c.closed > 0 ? `${s} · ${c.closed} closed` : s;
}

const GRADE = /\b[A-F][1-6]\b/;
/**
 * A MAIN row (EP-36 §3): `CALLSIGN · leg · BLUF-short · ladder-state ·
 * next update HHMML`; a DETAIL row puts the DL's answer and plan where the
 * short BLUF goes. ≤ 110 characters; never a name, a grade or post text.
 * s: {callsign, leg, short, state, stateAt, tz, nextUpdateAt, dl: {answer,
 * plan}, callback: {minutes}, names?: [] to refuse}.
 */
export function mainRow(s) {
  const parts = [s.callsign, s.leg];
  if (s.dl) {
    parts.push(`DL: ${DL_WORDS[s.dl.answer]}`);
    if (s.dl.plan) parts.push(s.dl.plan);
  } else {
    if (s.short) parts.push(s.short);
    if (s.callback) parts.push(`NO READ ${s.callback.minutes} MIN`, 'CALLING');
    else if (s.state === 'DONE' && s.stateAt)
      parts.push(`DONE ${localTime(s.stateAt, s.tz)}`);
    else if (s.state === 'EXPIRED') parts.push('EXPIRED');
    else if (s.state) parts.push(s.state);
  }
  if (s.nextUpdateAt)
    parts.push(`next update ${localTime(s.nextUpdateAt, s.tz)}`);
  const row = parts.filter(Boolean).join(' · ');
  assertCap('mainRow', row);
  assertPlain(row, 'main row', { main: true });
  if (GRADE.test(row)) throw new Error(`main row: carries a grade: "${row}"`);
  for (const n of s.names || [])
    if (n && row.includes(n))
      throw new Error(`main row: carries a name: "${row}"`);
  return row;
}

/** `SWIFT 1`, `SWIFT 2` → `SWIFT 1–2`; else the first callsign. */
export function groupCallsign(callsigns) {
  const cs = [...new Set(callsigns.filter(Boolean))];
  if (cs.length < 2) return cs[0] || '';
  const m = cs.map((c) => /^(.*\S) (\d+)$/.exec(c));
  if (m.every((x) => x && x[1] === m[0][1])) {
    const n = m.map((x) => Number(x[2])).sort((a, b) => a - b);
    if (n.every((v, i) => i === 0 || v === n[i - 1] + 1))
      return `${m[0][1]} ${n[0]}–${n[n.length - 1]}`;
  }
  return cs[0];
}

/** A leg as the deck writes it beside a distance (EP-35 §3, EP-36 §2). */
export function legTitle(leg) {
  const t = localTime(leg.start, leg.tz);
  const label = leg.label || '';
  switch (leg.kind) {
    case 'hotel':
      return leg.place?.name || label;
    case 'ground':
      return `${label.endsWith('L') ? label.slice(0, label.lastIndexOf(' ')) : label} ${t}`;
    case 'meeting':
      return `${label.split(',')[0].split(' at ')[0]} ${t} ${leg.place?.name || ''}`.trim();
    case 'private':
      return `${label.split(',')[0]} ${t} ${leg.place?.name || ''}`.trim();
    case 'flight':
      return `${label} ${t}`;
    default:
      return label;
  }
}

/** The short leg on MAIN and phones: `Lunch 1230L`. */
export const legShort = (leg) => leg.main_label || legTitle(leg);

/** What a hazard edge is called beside its distance. */
export const HAZARD_NOUN = Object.freeze({
  severe_thunderstorm_line: 'storm line',
  fire_boundary: 'fire boundary',
  coastal_flood: 'flood area',
});

/**
 * Why a situation was raised: `CALLSIGN · leg · 400 m N · in window`;
 * a mention reads `named`, with minutes to exposure when in window; a
 * hazard edge reads its noun and distance. ≤ 72 characters.
 */
export function whyRaised(m) {
  let where;
  if (m.named) {
    where =
      m.window === 'in window' && m.timeToExposureS > 0
        ? `named · ${Math.round(m.timeToExposureS / 60)} min to exposure`
        : `named · ${m.window}`;
  } else if (m.hazard) {
    where = `${m.hazard} ${distance(m.distanceM)} · ${m.window}`;
  } else where = `${distance(m.distanceM)} ${m.bearing} · ${m.window}`;
  const s = `${m.callsign} · ${m.title} · ${where}`;
  assertCap('whyRaised', s);
  return assertPlain(s, 'why raised');
}

/** `in window` / `opens in 2 h` / `closed` from the window and an instant. */
export function windowWord(from, to, now) {
  const t = ms(now);
  if (t >= ms(from) && t <= ms(to)) return 'in window';
  if (t < ms(from))
    return `opens in ${Math.ceil((ms(from) - t) / 3600e3 - 1e-9)} h`;
  return 'closed';
}
