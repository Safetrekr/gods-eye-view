export class OperationsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function fetchOperations(token, filters, signal) {
  const requestStarted = performance.now();
  const query = new URLSearchParams({
    window: filters.window,
    offset: String(filters.offset),
    limit: '10',
  });
  if (filters.tripId) query.set('trip_id', filters.tripId);
  const response = await fetch(`/api/safetrekr/operations?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const messages = {
      401: 'Your session has expired. Sign in again.',
      403: 'This account does not have staff operations access.',
      404: filters.tripId
        ? 'This trip is no longer accessible.'
        : 'The staff operations route is not installed on this Core server yet.',
      429: 'The server is busy. Retrying shortly.',
      502: 'Cannot reach SafeTrekr Core. Check the local server configuration.',
      503: 'SafeTrekr data is temporarily unavailable. Retrying shortly.',
    };
    throw new OperationsError(
      response.status,
      messages[response.status] ||
        `Operations request failed (${response.status}).`,
    );
  }
  const snapshot = await response.json();
  if (
    snapshot.schema_version !== 1 ||
    !Array.isArray(snapshot.trips) ||
    !Array.isArray(snapshot.participants)
  ) {
    throw new OperationsError(
      502,
      'The Core response is not a supported operations snapshot.',
    );
  }
  // Count request transit/processing time without assuming synchronized clocks.
  return {
    ...snapshot,
    transportAgeSeconds: (performance.now() - requestStarted) / 1000,
  };
}

// Exactly one request at a time. Old account/filter requests cannot publish
// into a newer view, even if abort is ignored by a mock or a proxy.
export class SnapshotPoller {
  constructor({ request, onData, onError, interval = 15000 }) {
    Object.assign(this, { request, onData, onError, interval });
    this.epoch = 0;
  }
  start() {
    this.stop();
    const epoch = this.epoch;
    const tick = async () => {
      this.controller = new AbortController();
      try {
        const data = await this.request(this.controller.signal);
        if (epoch === this.epoch) this.onData(data);
      } catch (error) {
        if (epoch === this.epoch && error.name !== 'AbortError')
          this.onError(error);
      } finally {
        if (epoch === this.epoch) this.timer = setTimeout(tick, this.interval);
      }
    };
    void tick();
  }
  stop() {
    this.epoch += 1;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
}
