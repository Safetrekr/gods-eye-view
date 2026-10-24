// Trip Twin relay limits (Phase CF K7; PHASE-CF-PLAN S-6, S-16; review
// cf/01-reasoning.md B4, cf/02-security.md S5, S6; cf/01-security.md SEC-8).
// One table and a few token buckets, keyed by socket, device id or IP. Pure:
// no timers, no I/O; every function takes the time, so a fake clock tests
// it. Trip Twin's own limiter: server/providers/common/rate-limit.js is not
// imported (S-6), so a change there never changes the wall.
// The Mac Studio's own walls, launcher, All-in-one and remote all connect
// from 127.0.0.1 (B4): nothing here locks out an address. Wrong tokens are
// only counted, keyed by (IP, device id), and raise a detection signal; the
// per-IP code cap leaves loopback out; loopback has its own upgrade budget.

/** The limits (S-16). Read-only; tests pass their own copy to the relay. */
export const LIMITS = Object.freeze({
  /** WebSocket frame cap: a bigger frame closes that socket only (1009). */
  maxPayload: 1024 * 1024,
  /** Per socket: messages a second, burst and sustained. */
  socketBurst: 40,
  socketRate: 20,
  /** Closed when it has been over its budget for this long without a break. */
  socketOverCloseMs: 10_000,
  /** Per device: commands and undos a second, burst and sustained. */
  deviceCmdBurst: 20,
  deviceCmdRate: 10,
  /** Upgrades per IP a minute: loopback has its own, higher budget (B4). */
  upgradesPerMinLoopback: 120,
  upgradesPerMin: 30,
  /** Open sockets. */
  socketsTotal: 64,
  socketsPerIp: 24,
  /** Sockets without a pairing (new and pending): their own cap (sec S6). */
  unauthSockets: 16,
  /** A socket with no accepted hello is closed after this (sec S6). */
  helloDeadlineMs: 5_000,
  /** Hellos one socket may send before one is accepted. */
  hellosPerSocket: 5,
  /** Outstanding pair codes: in all, and per IP (loopback exempt, B4). */
  codesTotal: 20,
  codesPerIp: 6,
  /** Draws for a free code before the host says BUSY (never a spin). */
  codeDraws: 50,
  /** Expired codes are purged on every hello and at least this often. */
  codeSweepMs: 60_000,
  /** Wrong slots for one good code before it is burnt. */
  codeTries: 3,
  /** Thumbnails: one per screen per 2 s, JPEG only, this long at most. */
  thumbEveryMs: 2_000,
  thumbMaxChars: 400_000,
  /** Wrong tokens: the detection signal (never a lockout, sec S5). */
  wrongTokenSignal: 10,
  wrongTokenWindowMs: 5 * 60_000,
  /** One `limit.hit` line per limit per this long; the next counts the rest. */
  auditEveryMs: 10_000,
  /** Keys a keyed counter holds before the idle ones are dropped. */
  keysMax: 4_096,
});

/** The names a `limit.hit` audit line may carry (auditLog.js allowlist). */
export const LIMIT_NAMES = Object.freeze([
  'upgrade-rate',
  'sockets-total',
  'sockets-ip',
  'unauth-evicted',
  'hello-deadline',
  'hellos',
  'socket-budget',
  'device-cmd',
  'codes-total',
  'codes-ip',
  'code-draws',
  'code-tries',
  'payload',
  'wrong-token',
]);

/** Only a data URL of a JPEG, base64, as twinScreen.js makes (SEC-8). */
export const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/** True for a thumbnail the relay may pass to remotes. */
export function thumbOk(data, max = LIMITS.thumbMaxChars) {
  return (
    typeof data === 'string' && data.length <= max && JPEG_DATA_URL.test(data)
  );
}

/**
 * A token bucket: `burst` tokens, refilled at `rate` a second. `take(now)`
 * spends one (true) or says no (false); `retryAfterMs(now)` is when the
 * next one is there.
 */
export function tokenBucket({ rate, burst }, at = 0) {
  let tokens = burst;
  let last = at;
  const fill = (now) => {
    if (now > last) {
      tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
      last = now;
    }
  };
  return {
    take(now) {
      fill(now);
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
    retryAfterMs(now) {
      fill(now);
      return tokens >= 1 ? 0 : Math.ceil(((1 - tokens) / rate) * 1000);
    },
    /** Full again (idle long enough to be dropped from a keyed map). */
    full(now) {
      fill(now);
      return tokens >= burst;
    },
  };
}

/**
 * One socket's message budget (S-16): 'ok', 'drop' (over: dropped and
 * counted) or 'close' (over for `socketOverCloseMs` with no second free of
 * drops). A socket that slows down to its rate is never closed.
 */
export function socketBudget(limits = LIMITS, at = 0) {
  const b = tokenBucket(
    { rate: limits.socketRate, burst: limits.socketBurst },
    at,
  );
  let overSince = null;
  let lastDrop = null;
  return {
    take(now) {
      if (b.take(now)) {
        if (overSince != null && now - lastDrop > 1000) overSince = null;
        return 'ok';
      }
      if (overSince == null || now - lastDrop > 1000) overSince = now;
      lastDrop = now;
      return now - overSince >= limits.socketOverCloseMs ? 'close' : 'drop';
    },
  };
}

/**
 * Buckets by key, bounded: past `max` keys the full (idle) ones go first,
 * then the oldest. A flood of new keys costs memory once, never forever.
 */
export function keyedBuckets({ rate, burst, max = LIMITS.keysMax }) {
  const map = new Map();
  return {
    get(key, now) {
      let b = map.get(key);
      if (!b) {
        if (map.size >= max) {
          for (const [k, x] of map) if (x.full(now)) map.delete(k);
          while (map.size >= max) map.delete(map.keys().next().value);
        }
        b = tokenBucket({ rate, burst }, now);
        map.set(key, b);
      }
      return b;
    },
    get size() {
      return map.size;
    },
  };
}

/**
 * Counts in a window by key, bounded like keyedBuckets. `add(key, now)`
 * returns {count, first}: `first` is true once per window, when the count
 * reaches `signal`.
 */
export function windowCounter({ windowMs, signal, max = LIMITS.keysMax }) {
  const map = new Map(); // key → {since, count}
  return {
    add(key, now) {
      let e = map.get(key);
      if (!e || now - e.since >= windowMs) {
        if (!e && map.size >= max) {
          for (const [k, x] of map)
            if (now - x.since >= windowMs) map.delete(k);
          while (map.size >= max) map.delete(map.keys().next().value);
        }
        e = { since: now, count: 0 };
        map.set(key, e);
      }
      e.count += 1;
      return { count: e.count, first: e.count === signal };
    },
    get size() {
      return map.size;
    },
  };
}

/**
 * The relay's limiter: upgrades per IP (loopback its own budget), commands
 * per device, thumbnails per screen, and the wrong-token signal per
 * (IP, device id). Nothing here refuses a correct token.
 */
export function createLimiter({ limits = LIMITS } = {}) {
  const upLoop = keyedBuckets({
    rate: limits.upgradesPerMinLoopback / 60,
    burst: limits.upgradesPerMinLoopback,
  });
  const upLan = keyedBuckets({
    rate: limits.upgradesPerMin / 60,
    burst: limits.upgradesPerMin,
  });
  const cmds = keyedBuckets({
    rate: limits.deviceCmdRate,
    burst: limits.deviceCmdBurst,
  });
  const thumbs = new Map(); // device id → last forwarded at
  const wrong = windowCounter({
    windowMs: limits.wrongTokenWindowMs,
    signal: limits.wrongTokenSignal,
  });
  return {
    limits,
    /** An upgrade from `ip`: {ok, retryAfterMs}. */
    upgrade(ip, loopback, now) {
      const b = (loopback ? upLoop : upLan).get(String(ip || '?'), now);
      return b.take(now)
        ? { ok: true }
        : { ok: false, retryAfterMs: b.retryAfterMs(now) };
    },
    /** A command or an undo from a device: {ok, retryAfterMs}. */
    command(id, now) {
      const b = cmds.get(String(id), now);
      return b.take(now)
        ? { ok: true }
        : { ok: false, retryAfterMs: b.retryAfterMs(now) };
    },
    /** A thumbnail from a screen: true when it may go to the remotes. */
    thumb(id, now) {
      const last = thumbs.get(id);
      if (last != null && now - last < limits.thumbEveryMs) return false;
      if (thumbs.size >= limits.keysMax && !thumbs.has(id)) thumbs.clear();
      thumbs.set(id, now);
      return true;
    },
    /** A wrong or missing token: counted, never refused (B4, sec S5). */
    wrongToken(ip, id, now) {
      return wrong.add(`${String(ip || '?')}|${String(id || '?')}`, now);
    },
    sizes: () => ({
      upgradeKeys: upLoop.size + upLan.size,
      deviceKeys: cmds.size,
      wrongTokenKeys: wrong.size,
    }),
  };
}
