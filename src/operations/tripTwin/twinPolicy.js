// Trip Twin server-held questions (Phase CF K10; cf/02-backend.md BE-3,
// PHASE-CF-PLAN CF-D4, C24, C25, S-18; VOICE-CONTROL §3.3). Pure: what a
// question shows, what makes it stale, and which undos ask first.
//
// - previewOf(state, cmd): a dry run of the reducer. `key` is what the
//   operator agrees to (every field the command would change, from and to,
//   and the pinned screens it skips); a confirm whose key no longer matches
//   is stale (C24: an unrelated change in between leaves the key alone, so
//   the question stands). A voice question is stricter: any new revision
//   makes it stale (VOICE-CONTROL §3.3; the host keeps `askedRev`).
// - undoPreviewOf(state, record, ledger): the same for an undo.
// - undoLowers(now, next): CF-D4, signed 23 Oct 2026. An undo whose inverse
//   turns Visitor mode off, clears a report or its acknowledgement, starts
//   a demo, unpins a screen or lowers the screen count always gets the
//   server's question, from every device, the author included. The same
//   list is Tier C (touch only) for voice.
// - questionParts(change): ids and closed-list words for the audit log
//   (F-0004: never the rendered text).
import {
  applyCommand,
  applyUndoChecked,
  changeList,
  SIM_KEYS,
} from './twinSession.js';
import { describeChange, render } from './twinDescribe.js';

const keyOf = (changes, skipped = []) =>
  JSON.stringify([
    changes.map((c) => [c.key, c.from ?? null, c.to ?? null]),
    [...skipped].map(Number).sort((a, b) => a - b),
  ]);

/** Parts a log line may hold (auditLog.js `part`): one level, no text. */
export function questionParts(change) {
  return (change?.parts || []).slice(0, 12).map((p) => {
    const out = {
      scope: p.scope === 'wall' ? 'all' : `S${p.scope}`,
      field: p.field,
    };
    if (p.key) out.key = p.key;
    const v = p.to?.value;
    if (typeof v === 'boolean' || typeof v === 'number') out.value = v;
    else if (typeof v === 'string') out.value = v;
    if (p.to?.kind) out.kind = p.to.kind;
    if (p.to?.id) out.id = p.to.id;
    return out;
  });
}

/**
 * The question for a command: {key, changes, skipped, applied, pinned,
 * parts, text} or null when the reducer refuses it. `text` is the
 * remote's words with no names (a page with names words its own).
 */
export function previewOf(state, cmd, { at = 0 } = {}) {
  const r = applyCommand(state, cmd, { at });
  if (r.error) return null;
  const changes = changeList(state, r.state);
  const change = describeChange(
    state,
    r.state,
    { cause: 'cmd', skipped: r.skipped },
    at || Date.now(),
  );
  const slots = Object.keys(state?.screens || {}).map(Number);
  return {
    key: keyOf(changes, r.skipped),
    changes,
    skipped: r.skipped,
    applied: slots.filter((s) => !r.skipped.includes(s)),
    pinned: [...r.skipped],
    parts: questionParts(change),
    text:
      render(change, { audience: 'remote' }) || 'Nothing changes on the walls',
  };
}

/** The question for an undo (a protection-lowering inverse, CF-D4). */
export function undoPreviewOf(state, record, ledger, { at = 0 } = {}) {
  const r = applyUndoChecked(state, record, ledger, { at });
  const change = describeChange(
    state,
    r.state,
    { cause: 'undo' },
    at || Date.now(),
  );
  return {
    key: keyOf(r.changes),
    changes: r.changes,
    skipped: [],
    applied: [],
    pinned: [],
    parts: questionParts(change),
    text: `Undo · ${(render(change, { audience: 'remote' }) || 'nothing changes').replace(/^Undone on /, '')}`,
    result: r,
  };
}

/**
 * CF-D4: why going from `now` to `next` (an undo's result) lowers
 * protection, or null. Only a value that really changes counts.
 */
export function undoLowers(now, next) {
  const a = now?.session || {};
  const b = next?.session || {};
  if (a.visitor === true && b.visitor !== true) return 'visitor off';
  if (a.report && !b.report) return 'report cleared';
  if (a.incidentAck && !b.incidentAck) return 'acknowledgement cleared';
  for (const k of SIM_KEYS) if (!a[k] && b[k]) return 'demo started';
  for (const [slot, s] of Object.entries(now?.screens || {}))
    if (s?.pinned && next?.screens?.[slot] && !next.screens[slot].pinned)
      return 'unpinned';
  if ((next?.count ?? 0) < (now?.count ?? 0)) return 'screen count';
  return null;
}

/** The consequence an Undo button names (CF-D4): "Undo · names back on". */
export const UNDO_CONSEQUENCE = Object.freeze({
  'visitor off': 'names back on',
  'report cleared': 'reported floor cleared',
  'acknowledgement cleared': 'acknowledgement cleared',
  'demo started': 'simulated weather back on every screen',
  unpinned: 'screen unpinned',
  'screen count': 'fewer screens',
});
