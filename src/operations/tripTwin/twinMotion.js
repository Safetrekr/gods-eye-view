// Trip Twin motion tiers (phase 11; plans/trip-twin/PHASE-11-PLAN.md P11-A).
// Every animation belongs to one of three tiers, each with its own switch:
//   live   — things that are genuinely live: the live dot, fix ages, the
//            snapshot sweep
//   event  — when data changes: a number swap with its highlight, the hollow
//            echo at the old fix, a band entering
//   cine   — presentation only: fog-in panels, the rail wavefront, the
//            selection reticle, idle drift on the Site wall
// The system's Reduce motion (or the in-app override) turns all three off
// and cannot be overridden (05-motion-language §6.3). Pure helpers first;
// the controller only toggles body classes that the CSS and the engine read.

export const MOTION_TIERS = Object.freeze([
  {
    key: 'live',
    label: 'Live',
    sub: 'The live dot and the snapshot sweep',
  },
  {
    key: 'event',
    label: 'Event',
    sub: 'Count highlights and a band entering',
  },
  {
    key: 'cine',
    label: 'Cinematic',
    sub: 'Fog-in panels; idle drift on Site: stops on any touch, never during an incident',
  },
]);

/** Defaults: every tier on for a wall and the remote; Cinematic off at a desk. */
export const MOTION_DEFAULTS = Object.freeze({
  wall: Object.freeze({ live: true, event: true, cine: true }),
  all: Object.freeze({ live: true, event: true, cine: false }),
});

/** Body classes for a tier set; reduced motion wins over every tier. */
export function motionClasses(tiers = {}, reduced = false) {
  const out = [];
  for (const t of MOTION_TIERS)
    if (!reduced && tiers[t.key] !== false) out.push(`tt-m-${t.key}`);
  if (reduced) out.push('tt-m-reduced');
  return out;
}

/** Normalise a partial tier object against a default set. */
export function mergeTiers(base, patch) {
  const out = { ...base };
  for (const t of MOTION_TIERS)
    if (patch && typeof patch[t.key] === 'boolean') out[t.key] = patch[t.key];
  return out;
}

/**
 * createMotion({root, reduced, tiers}) → controller.
 * reduced() answers the system setting or the in-app override, live.
 */
export function createMotion({
  root = typeof document !== 'undefined' ? document.body : null,
  reduced = () => false,
  tiers = MOTION_DEFAULTS.all,
} = {}) {
  let current = { ...tiers };
  const ALL = MOTION_TIERS.map((t) => `tt-m-${t.key}`).concat('tt-m-reduced');
  function apply() {
    if (!root) return;
    const want = new Set(motionClasses(current, reduced()));
    for (const c of ALL) root.classList.toggle(c, want.has(c));
  }
  apply();
  const mq =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  mq?.addEventListener?.('change', apply);
  return {
    get tiers() {
      return { ...current };
    },
    set(patch) {
      current = mergeTiers(current, patch);
      apply();
    },
    /** Is this tier live right now (switch on and not reduced)? */
    on(tier) {
      return !reduced() && current[tier] !== false;
    },
    reduced,
    apply,
  };
}

/** Restart a one-shot CSS animation class on an element. */
export function flash(el, cls = 'tt-changed') {
  if (!el) return;
  el.classList.remove(cls);
  // Force a reflow so the animation restarts.
  void el.offsetWidth;
  el.classList.add(cls);
}
