// SafeTrekr Executive: the scripted day as one ordered array (EP-35 §5).
//   buildTimeline(day) → [{seq, at, beat, ev}]
// built from day.json: every intake bundle as `intel.received` at its
// ingest time (and again as it grows), the raises at the fixture times,
// every position fix, and the scripted events (loop.json, the morning
// situations, the intake decisions, the routine check-ins). The presenter
// never fires loop events; the clock does: the host applies every entry
// with `at ≤ simNow`, in order. Replay from any point is
// fold(timeline.slice(0, i)). Pure; `day` is the parsed day.json.
//
// Ordering within one instant: arrivals first (intel.received, then
// intel.raise), then position fixes, then everything else in file order,
// so a done-by-position ack always follows the fix that proves it.
import { applyLoopEvent, createLoop } from './loop/twinLoop.js';
import { selectCounter } from './loop/select.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const iso = (t) => new Date(ms(t)).toISOString().replace('.000Z', 'Z');
const RANK = { 'intel.received': 0, 'intel.raise': 1, 'position.fix': 2 };

/** Beat anchors, ISO UTC: 0 1430Z · 1 1530Z · 2 1800Z · 3 2200Z · 4 0030Z · 5 0100Z. */
export const beatAnchors = (day) => ({ ...day.beats });

/** The beat an instant falls in: the last anchor at or before it (beat 0 before 1430Z). */
export function beatAt(day, at) {
  const t = ms(at);
  let beat = 0;
  for (const [n, a] of Object.entries(day.beats))
    if (ms(a) <= t && Number(n) > beat) beat = Number(n);
  return beat;
}

function bundleEvents(day) {
  const raises = new Map(day.raises.map((r) => [r.bundle_id, r]));
  const out = [];
  for (const b of Object.values(day.bundles)) {
    const { history = [], ...head } = b;
    const raise = raises.get(b.bundle_id);
    let snap = head;
    const versions = [[b.ingested_at, snap]];
    for (const patch of history) {
      const { at, ...rest } = patch;
      snap = { ...snap, ...rest };
      versions.push([at, snap]);
    }
    versions.forEach(([at, bundle], i) =>
      out.push({
        id: i ? `e-in-${b.bundle_id}-${i + 1}` : `e-in-${b.bundle_id}`,
        sample: true,
        at,
        by: 'generator',
        type: 'intel.received',
        bundle,
        ...(raise ? { sit_id: raise.sit_id } : {}),
        ...(raise && ms(at) < ms(raise.at) ? { defer_raise: true } : {}),
      }),
    );
    if (raise && ms(raise.at) > ms(b.ingested_at))
      out.push({
        id: `e-raise-${b.bundle_id}`,
        sample: true,
        at: raise.at,
        by: 'generator',
        type: 'intel.raise',
        bundle_id: b.bundle_id,
        sit_id: raise.sit_id,
      });
  }
  return out;
}

function fixEvents(day) {
  return day.fixes.map((f) => {
    const { id, via, ...rest } = f;
    return {
      id: `e-fx-${id}`,
      at: f.at,
      by: 'generator',
      type: 'position.fix',
      fix_id: id,
      ...rest,
      ...(via ? { via_subject: via } : {}),
    };
  });
}

/** The ordered timeline: [{seq, at, beat, ev}], seq `t-0001`… (ev.id keeps its source id). */
export function buildTimeline(day) {
  const all = [...bundleEvents(day), ...fixEvents(day), ...day.events];
  const keyed = all.map((ev, i) => ({
    ev,
    i,
    t: ms(ev.at),
    r: RANK[ev.type] ?? 3,
  }));
  keyed.sort((a, b) => a.t - b.t || a.r - b.r || a.i - b.i);
  return keyed.map(({ ev, t }, i) => ({
    seq: `t-${String(i + 1).padStart(4, '0')}`,
    at: iso(t),
    beat: ev.beat ?? beatAt(day, t),
    ev,
  }));
}

/**
 * Fold timeline entries into a loop. Returns {loop, refused: [{seq, id,
 * type, code}]}; `onStep(loop, entry)` runs after every accepted entry.
 */
export function fold(day, entries, { loop = null, onStep = null } = {}) {
  let state = loop || createLoop({ fixtures: day, t0: day.t0 });
  const refused = [];
  for (const e of entries) {
    const r = applyLoopEvent(state, e.ev);
    if (r.refused)
      refused.push({
        seq: e.seq,
        id: e.ev.id,
        type: e.ev.type,
        code: r.refused.code,
      });
    else state = r.loop;
    if (onStep && !r.refused) onStep(state, e);
  }
  return { loop: state, refused };
}

/** The loop at an instant: every entry at or before it, then the clock moved to it. */
export function foldTo(day, at, entries = buildTimeline(day)) {
  const t = ms(at);
  const { loop, refused } = fold(
    day,
    entries.filter((e) => ms(e.at) <= t),
  );
  const r = applyLoopEvent(loop, {
    type: 'clock.jump',
    at: iso(t),
    to: iso(t),
    by: 'generator',
  });
  return { loop: r.refused ? loop : r.loop, refused };
}

/** `beat.go {n}`: the anchor's state in one pass (EP-35 §5). */
export function foldToBeat(day, n, entries = buildTimeline(day)) {
  const anchor = day.beats[n];
  if (!anchor) throw new Error(`no beat ${n}`);
  const { loop, refused } = fold(
    day,
    entries.filter((e) => ms(e.at) <= ms(anchor)),
  );
  const r = applyLoopEvent(loop, {
    type: 'beat.go',
    n: Number(n),
    at: anchor,
    by: 'presenter',
  });
  if (r.refused) throw new Error(`beat.go ${n} refused: ${r.refused.code}`);
  return { loop: r.loop, refused };
}

/** Replay from the start to entry i (exclusive). */
export const replay = (day, i, entries = buildTimeline(day)) =>
  fold(day, entries.slice(0, i));

/** JSON with sorted keys: the state hash input. */
export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** The golden file: state hash and counter at each beat anchor. `hash` is injected (sha256 hex). */
export function goldenFor(day, hash) {
  const entries = buildTimeline(day);
  const out = {
    note: 'Generated by scripts/executive-fixtures.mjs; the replay test compares.',
    entries: entries.length,
    beats: {},
  };
  for (const n of Object.keys(day.beats)) {
    const { loop, refused } = foldToBeat(day, n, entries);
    out.beats[n] = {
      at: day.beats[n],
      rev: loop.rev,
      refused: refused.length,
      counter: selectCounter(loop),
      hash: hash(stableStringify(loop)),
    };
  }
  return out;
}
