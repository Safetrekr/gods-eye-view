// Fitzroy's spoken words (review/fitzroy-commands F4, F5 D8). A read-back
// is the describer's dry run of the very command the device will send, so
// voice and the remote's result bar name the same change, and a command the
// reducer refuses is never read back as done. Pure.
//
// Rules (tested): no clock time ever (durations only); "screen 4", never a
// bare number or "S4"; text "larger"/"smaller"; no symbols the speech engine
// cannot say; a person as on the walls (initials in Visitor mode); a demo's
// words start "Simulated".
import { describeCommand, phrase } from '../twinDescribe.js';
import { LAYER_CATALOG, ROLES } from '../twinScreenRoles.js';
import { SIM_KEYS } from '../twinSession.js';

/** The remote's short tile names: "Screen 4, Weather". */
export const SCREEN_SHORT = Object.freeze({
  site: 'Site',
  travelers: 'People',
  incident: 'Incident',
  weather: 'Weather',
  day: 'Day plan',
  trips: 'Trips',
});

const LAYER_SPOKEN = Object.fromEntries(
  LAYER_CATALOG.flatMap((g) =>
    g.layers.map((L) => [
      L.key,
      L.label
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/,\s*24 h$/, '')
        .toLowerCase(),
    ]),
  ),
);
export const spokenLayer = (key) => LAYER_SPOKEN[key] || key;
const HAZARD_LAYERS = new Set(
  LAYER_CATALOG.find((g) => g.group === 'Hazards').layers.map((L) => L.key),
);
const SIM_WORD = {
  simStorm: 'storm',
  simFire: 'fire boundary',
  simCyclone: 'hurricane',
};

/** Words a speech engine can say: no symbols, one sentence end. */
export function speakable(text) {
  let t = String(text || '')
    .replace(/\s*·\s*/g, ', ')
    .replace(/&/g, ' and ')
    .replace(/→/g, ' to ')
    .replace(/×/g, ' times ')
    .replace(/−/g, 'minus ')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[^A-Za-z0-9 ,.:?'’-]/g, ' ')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:?])/g, '$1')
    .replace(/,+/g, ',')
    .trim();
  if (t && !/[.?]$/.test(t)) t += '.';
  return t;
}

const screenWords = (slot, state) =>
  `Screen ${slot}, ${SCREEN_SHORT[state?.screens?.[slot]?.role] || 'Site'}`;

/** One part, as spoken (larger/smaller, durations, clean layer names). */
function spokenPart(part, before, o) {
  const v = part.to?.value;
  switch (part.field) {
    case 'textScale': {
      const was = Number(before?.screens?.[part.scope]?.textScale || 1.75);
      return Number(v) > was ? 'text larger' : 'text smaller';
    }
    case 'layers':
      return `${spokenLayer(part.key)} ${v ? 'on' : 'off'}`;
    case 'wxAt': {
      if (v == null) return 'weather now';
      const m = part.to.min;
      if (m == null) return 'weather at another time';
      return m < 0
        ? `weather ${Math.abs(m)} minutes back`
        : `weather ${m} minutes ahead`;
    }
    case 'role':
      return (ROLES[v] || ROLES.site).label;
    case 'day':
      return v == null ? 'today' : `day ${v}`;
    case 'mode':
      return v === 'advance' ? 'Advance' : 'Live';
    case 'simStorm':
    case 'simFire':
    case 'simCyclone':
      // One word for a demo in speech: "simulated", as the walls say.
      return `simulated ${SIM_WORD[part.field]} ${v ? 'started' : 'ended'}`;
    case 'spotlight':
      // A place by what it is ("the hospital"): its full name is long.
      if (part.to?.kind === 'place' && o.names?.placeWord?.(part.to.id))
        return `spotlight ${o.names.placeWord(part.to.id)}`;
      // A person as on the walls ("Noah F.", initials in Visitor mode):
      // the walls' audience names them so; the remote's says the full name.
      // Initials are spoken letter by letter: "NF" would read as a word.
      return phrase(part, { ...o, audience: 'wall' }).replace(
        /\b([A-Z])([A-Z])\b\.?/g,
        '$1. $2.',
      );
    default:
      return phrase(part, { ...o, audience: 'voice' });
  }
}

/** Live, Event and Cinematic motion all at once read as "motion". */
function mergeMotion(ps) {
  const m = ps.filter((p) => p.field === 'motion');
  if (m.length < 2 || new Set(m.map((p) => p.to?.value)).size > 1) return ps;
  const v = m[0].to?.value;
  return [
    ...ps.filter((p) => p.field !== 'motion'),
    { scope: m[0].scope, field: 'motionAll', to: { value: v } },
  ];
}

/** A change, as Fitzroy says it. o: {visitor, names}. */
export function speakChange(change, before, o = {}) {
  if (!change) return 'Nothing changed.';
  if (change.returnAll && change.kind !== 'undo') {
    const demos = change.ended
      .filter((e) => e.startsWith('demo '))
      .map((e) => e.replace(/^demo /, ''));
    return speakable(
      `Every screen back to Live and role defaults, pinned ones too${demos.length ? `. The simulated ${demos.join(' and ')} ended` : ''}`,
    );
  }
  const wall = change.parts.filter((p) => p.scope === 'wall');
  const bySlot = new Map();
  for (const p of change.parts)
    if (p.scope !== 'wall') {
      if (!bySlot.has(p.scope)) bySlot.set(p.scope, []);
      bySlot.get(p.scope).push(p);
    }
  const out = [];
  if (wall.length)
    out.push(
      `Every screen: ${wall.map((p) => spokenPart(p, before, o)).join(', ')}`,
    );
  // Screens that heard the same words share one line: "Every screen" when
  // all of them did (a push to all), else one line per screen.
  const lines = new Map();
  for (const [slot, ps] of [...bySlot].sort((a, b) => a[0] - b[0])) {
    const role = ps.find((p) => p.field === 'role');
    const t = role
      ? null
      : mergeMotion(ps)
          .map((p) =>
            p.field === 'motionAll'
              ? `motion ${p.to.value === false ? 'off' : 'on'}`
              : spokenPart(p, before, o),
          )
          .join(', ');
    if (role) {
      out.push(`Screen ${slot}: ${spokenPart(role, before, o)}`);
      continue;
    }
    if (!lines.has(t)) lines.set(t, []);
    lines.get(t).push(slot);
  }
  for (const [t, slots] of lines)
    out.push(
      slots.length > 1
        ? `Every screen: ${t}`
        : `${screenWords(slots[0], before)}: ${t}`,
    );
  if (change.pinned.length)
    out.push(
      change.pinned.length === 1
        ? `Screen ${change.pinned[0]} pinned, unchanged`
        : `Screens ${change.pinned.join(' and ')} pinned, unchanged`,
    );
  let text = out.join('. ');
  if (change.kind === 'undo')
    text = text ? `Undone. ${text}` : 'Nothing undone';
  // A demo's words lead with what is simulated (F4 rule 6).
  const sims = SIM_KEYS.filter((k) => before?.session?.[k]);
  // Weather words, the storm's frame included (F11/F15 P0).
  const weatherish = change.parts.some(
    (p) =>
      p.field === 'wxAt' ||
      (p.field === 'layers' && HAZARD_LAYERS.has(p.key)) ||
      (p.field === 'frame' && p.to?.value?.kind === 'storm'),
  );
  if (sims.length && weatherish)
    text = `Simulated ${sims.map((k) => SIM_WORD[k]).join(' and ')}. ${text}`;
  return speakable(text);
}

/**
 * The read-back for a proposed command: the dry run of the same reducer.
 * o: {now, visitor, names}.
 */
export function readBack(message, state, o = {}) {
  if (message?.t !== 'cmd') return 'Nothing changed.';
  const change = describeCommand(message.cmd, state, {
    at: o.now ?? Date.now(),
  });
  return speakChange(change, state, {
    visitor: Boolean(o.visitor ?? state?.session?.visitor),
    names: o.names,
  });
}

/** A closed question: "{what changes}. {Verb} now?" (never a yes word). */
export function closedQuestion(what, verb) {
  const w = speakable(what).replace(/[.?]$/, '');
  return `${w}. ${verb} now?`;
}

/** Words that must never appear in a question (they would answer it). */
export const YES_WORDS = Object.freeze(['yes', 'confirm', 'do it']);
