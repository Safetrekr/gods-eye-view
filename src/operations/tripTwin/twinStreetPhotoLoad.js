// Street photos (review/street-photos P5): asks the twin's photo proxy what
// is near a place, once per place, when a surface needs it (a trip, site or
// stop change: no timer). The proxy shares one search between the room's
// windows; this keeps the last good answer per place and asks again after a
// busy or failed one.

const RETRY_MS = 60e3;
const FRESH_MS = 6 * 3600e3;

const keyOf = (t) => `${t.lat.toFixed(4)},${t.lon.toFixed(4)},${t.r || ''}`;

/**
 * @param {{onChange?: () => void, fetchImpl?: typeof fetch}} o
 * @returns {{want: (t: {lat, lon}) => void, get: (t: {lat, lon}) => object|null}}
 */
export function createPhotoLoader({
  onChange = () => {},
  fetchImpl = (...a) => fetch(...a),
  // Traffic cameras reuse this loader with their own route (T5).
  url = (t) =>
    `/api/twin-photos/near?lat=${t.lat.toFixed(5)}&lon=${t.lon.toFixed(5)}`,
} = {}) {
  const results = new Map(); // key → {search, at}
  const pending = new Set();
  const retryAt = new Map();

  async function load(t, k) {
    pending.add(k);
    try {
      const res = await fetchImpl(url(t));
      const search = res.ok
        ? await res.json()
        : { status: 'unavailable', items: [] };
      const old = results.get(k);
      // A failed ask never replaces photos already found.
      if (search.status === 'ok' || !old?.search?.items?.length)
        results.set(k, { search, at: Date.now() });
      if (search.status !== 'ok' || search.offline)
        retryAt.set(
          k,
          Date.now() + Math.max(RETRY_MS, (search.retryAfterSec || 0) * 1000),
        );
    } catch {
      if (!results.get(k)?.search?.items?.length)
        results.set(k, {
          search: { status: 'unavailable', items: [] },
          at: Date.now(),
        });
      retryAt.set(k, Date.now() + RETRY_MS);
    } finally {
      pending.delete(k);
      onChange();
    }
  }

  return {
    want(t) {
      if (!t || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) return;
      const k = keyOf(t);
      if (pending.has(k)) return;
      const r = results.get(k);
      // An offline copy is asked again soon (every-time P2-2).
      const ok = r?.search?.status === 'ok' && !r.search.offline;
      if (ok && Date.now() - r.at < FRESH_MS) return;
      if (!ok && r && Date.now() < (retryAt.get(k) || 0)) return;
      load(t, k);
    },
    get(t) {
      return (t && results.get(keyOf(t))?.search) || null;
    },
  };
}
