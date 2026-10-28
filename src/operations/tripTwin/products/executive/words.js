// SafeTrekr Executive: the words a screen may never say, and the length
// caps (EP-36 §§4, 5). Pure. assertPlain throws; plainBreach returns the
// first breach or null, for tests that sweep a whole file.

/** EP-36 §5. Each entry: a pattern and the word it reports. */
export const BANNED = Object.freeze([
  [/\bsafe\b/i, 'safe'],
  [/\bsafely\b/i, 'safely'],
  [/\ball clear\b/i, 'all clear'],
  [/\bsecured\b/i, 'secured'],
  // Upper case only: "AI" the term, never the letters inside a word.
  [/\bAI\b/, 'AI'],
  [/\bA\.I\./, 'A.I.'],
  [/\bautomatically\b/i, 'automatically'],
  [/\bdetected by\b/i, 'detected by'],
  [/\btactical\b/i, 'tactical'],
  [/\bplease\b/i, 'please'],
  [/\bwe believe\b/i, 'we believe'],
  [/\bwe think\b/i, 'we think'],
  [/\burgent\b/i, 'urgent'],
  [/\bASAP\b/i, 'ASAP'],
  [/\bimmediately\b/i, 'immediately'],
  [/\btrack\b/i, 'track'],
  [/\btracking\b/i, 'tracking'],
  [/\btargets?\b/i, 'target'],
  [/\bsuspects?\b/i, 'suspect'],
  [/\breal-time\b/i, 'real-time'],
  [/\bguaranteed\b/i, 'guaranteed'],
  [/!/, '!'],
]);
/** "hostile" fails on MAIN only (EP-36 §5). */
export const BANNED_ON_MAIN = Object.freeze([[/\bhostile\b/i, 'hostile']]);
/** Allowed exceptions, listed in the spec: an official layer name. */
export const ALLOWED = Object.freeze([
  /\bNWS alert areas\b/g,
  /\bofficial alerts?\b/gi,
]);
const ALERT = /\balerts?\b/i;

/** The first banned word in `text`, or null. */
export function plainBreach(text, { main = false } = {}) {
  if (typeof text !== 'string' || !text) return null;
  let t = text;
  for (const a of ALLOWED) t = t.replace(a, ' ');
  for (const [re, word] of main ? [...BANNED, ...BANNED_ON_MAIN] : BANNED)
    if (re.test(t)) return word;
  if (ALERT.test(t)) return 'alert';
  return null;
}

/** Throws when `text` holds a banned word; returns it otherwise. */
export function assertPlain(text, field = 'text', opts = {}) {
  const w = plainBreach(text, opts);
  if (w) throw new Error(`${field}: banned word "${w}" in "${text}"`);
  return text;
}

/** EP-36 §4, in characters. Over cap: the test fails; nothing truncates. */
export const CAPS = Object.freeze({
  bluf: 90,
  mainRow: 110,
  callsign: 8,
  legLabel: 24,
  placeName: 28,
  displayName: 18,
  whyRaised: 72,
  dismissalReason: 60,
  saluteValue: 48,
  sitrepSlot: 60,
  notificationTitle: 40,
  notificationBody: 160,
  dlAnswer: 200,
  retierReason: 80,
  button: 28,
});

/** Throws when `text` is longer than the cap for `kind`. */
export function assertCap(kind, text) {
  const cap = CAPS[kind];
  if (cap == null) throw new Error(`no cap named ${kind}`);
  if (typeof text === 'string' && [...text].length > cap)
    throw new Error(`${kind}: ${[...text].length} > ${cap} in "${text}"`);
  return text;
}
