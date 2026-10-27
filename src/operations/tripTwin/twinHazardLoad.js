// Loads fire boundaries (NIFC) and hurricanes & tropical storms (NHC) for one
// window, and lays the demos over them (review/hazards H5-PLAN). Each window
// reads upstream's own routes: their proxies cache and coalesce, so the room
// asks NIFC and NHC once per refresh. Ages come from the feed's fetchedAt
// against this window's receive time (one-clock rule).
import { simulatedFire, simulatedHurricane } from './twinHazardSim.js';

/** Upstream's proxy TTL; walls stagger by slot so they never fetch together. */
export const HAZARD_REFRESH_MS = 5 * 60e3;
const RESPONSE_LIMIT = 8 * 1024 * 1024;

export function createHazardLoad({
  center,
  slot = 0,
  signal,
  fetchImpl = (...a) => globalThis.fetch(...a),
  onChange = () => {},
  now = () => Date.now(),
} = {}) {
  const state = {
    rows: [],
    storms: [],
    firesFeed: null,
    tropicalFeed: null,
    simFire: null,
    simCyclone: null,
  };
  let timer = null;
  let simTimer = null;

  async function read(url) {
    const res = await fetchImpl(url, { signal, cache: 'no-store' });
    const text = await res.text();
    if (text.length > RESPONSE_LIMIT) throw new Error('too large');
    const json = JSON.parse(text);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json;
  }
  const ok = (json) => {
    const t = now();
    const at = Number(json?.fetchedAt);
    return {
      status: 'ok',
      hasData: true,
      stale: Boolean(json?.stale),
      ageAtReceiveMs: Number.isFinite(at) ? Math.max(0, t - at) : 0,
      receivedAt: t,
    };
  };
  // A failed refresh keeps the last good data, marked as such.
  const failed = (feed) =>
    feed?.hasData
      ? { ...feed, status: 'error' }
      : { status: 'error', hasData: false };

  async function load() {
    const [fires, storms] = await Promise.allSettled([
      read('/api/fire-perimeters'),
      read('/api/cyclones'),
    ]);
    if (signal?.aborted) return;
    if (fires.status === 'fulfilled' && Array.isArray(fires.value?.rows)) {
      state.rows = fires.value.rows;
      state.firesFeed = ok(fires.value);
    } else state.firesFeed = failed(state.firesFeed);
    const s = storms.status === 'fulfilled' ? storms.value : null;
    if (s && Array.isArray(s.storms) && !s.unavailable) {
      state.storms = s.storms;
      state.tropicalFeed = ok(s);
    } else state.tropicalFeed = failed(state.tropicalFeed);
    onChange();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(
      async () => {
        await load().catch(() => {});
        if (!signal?.aborted) schedule();
      },
      HAZARD_REFRESH_MS + slot * 5000,
    );
  }

  /** The demo fire is re-mapped once (+10 min): look again each minute. */
  function armSimTimer() {
    clearInterval(simTimer);
    simTimer = state.simFire ? setInterval(() => onChange(), 60e3) : null;
  }

  // First load soon, staggered by slot.
  setTimeout(
    () =>
      load()
        .catch(() => {})
        .finally(schedule),
    slot * 1000,
  );
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    clearInterval(simTimer);
  });

  return {
    /** Start (ms) or stop (null) a demo: kind 'fire' | 'cyclone'. */
    setSim(kind, start) {
      const key = kind === 'fire' ? 'simFire' : 'simCyclone';
      const v = Number.isFinite(start) ? start : null;
      if (state[key] === v) return;
      state[key] = v;
      if (kind === 'fire') armSimTimer();
      onChange();
    },
    sim: () => ({ fire: state.simFire, cyclone: state.simCyclone }),
    /** Real rows and storms with any demo laid over them. */
    data(at = now()) {
      const rows = [...state.rows];
      const storms = [...state.storms];
      let heat = [];
      if (state.simFire) {
        const f = simulatedFire(center, state.simFire, at);
        rows.unshift(f.row);
        heat = f.heat;
      }
      if (state.simCyclone)
        storms.unshift(simulatedHurricane(center, state.simCyclone));
      return {
        rows,
        storms,
        realRows: state.rows,
        realStorms: state.storms,
        simHeat: heat,
        firesFeed: state.firesFeed,
        tropicalFeed: state.tropicalFeed,
        demo: {
          fire: Boolean(state.simFire),
          cyclone: Boolean(state.simCyclone),
        },
      };
    },
    reload: load,
  };
}
