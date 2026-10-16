// SOC multi-view session host (phase 10): pairing codes, one controller at
// a time (lease), presence, commands through the pure reducer and 10 s undo.
// Runs inside the dev-server relay (server/tripTwin/syncRelay.js) and, as a
// same-machine fallback, inside the remote (BroadcastChannel). Pure: no I/O.
// Prototype only — production needs TLS, device enrolment, operator SSO,
// signed commands and an audit log (07-production-delta).
import { applyCommand, applyUndo, createSession } from './twinSession.js';

export const CODE_TTL_MS = 5 * 60 * 1000;
export const LEASE_MS = 30 * 1000;
export const HANDOVER_AUTO_MS = 15 * 1000;
export const UNDO_MS = 10 * 1000;
export const MAX_TRIES = 5;
export const SETUP_TTL_MS = 10 * 60 * 1000;

export function createSessionHost({
  now = () => Date.now(),
  random = Math.random,
  state = null,
} = {}) {
  let session = state || createSession({ epochMs: now() });
  const devices = new Map(); // id → {kind, slot, token, name, lastSeen}
  const codes = new Map(); // code → {deviceId, expires}
  let tries = 0;
  let lockedUntil = 0;
  let lease = { holder: null, at: 0 };
  let handover = null; // {from, at}
  // Setup tokens: the computer that chose Multi-view opens its own screen
  // windows and shows a QR for the remote; both carry this token.
  const setups = new Map(); // token → {expires}
  const undos = new Map(); // id → {undo, expires, by}
  let undoSeq = 0;

  const token = () =>
    Array.from({ length: 24 }, () =>
      Math.floor(random() * 36).toString(36),
    ).join('');
  const newCode = () => {
    let c;
    do c = String(Math.floor(random() * 10000)).padStart(4, '0');
    while (codes.has(c));
    return c;
  };
  const leaseLive = () => lease.holder && now() - lease.at < LEASE_MS;

  function presence() {
    const screens = {};
    const remotes = [];
    for (const [id, d] of devices) {
      if (d.kind === 'screen' && d.slot)
        screens[d.slot] = {
          online: d.online !== false,
          lastSeen: d.lastSeen,
          id,
        };
      if (d.kind === 'remote')
        remotes.push({
          id,
          name: d.name,
          online: d.online !== false,
          // A dropped remote keeps the lease for 30 s so it can come back,
          // but walls say "Remote offline" at once.
          controller: lease.holder === id && leaseLive() && d.online !== false,
        });
    }
    const holder = devices.get(lease.holder);
    return {
      screens,
      remotes,
      controller: leaseLive() && holder?.online !== false ? lease.holder : null,
      handover: handover && { from: handover.from, at: handover.at },
    };
  }

  return {
    get state() {
      return session;
    },
    presence,
    /** Start (or restart) a multi-view setup for N screens. */
    setup({ count = 4, tripId = null, siteKey = null } = {}) {
      const t = now();
      // Starting Multi-view starts a fresh wall: roles, pins, visitor mode
      // and reports from an earlier session do not carry over.
      const prevRev = session.rev;
      session = createSession({ count, epochMs: t });
      session.rev = prevRev + 1;
      // The console's trip and site; one clock for every screen.
      session = applyCommand(
        session,
        { type: 'session', patch: { tripId, siteKey } },
        { by: 'setup', at: t },
      ).state;
      session.session.epochMs = session.session.epochMs || t;
      const tk = token();
      setups.set(tk, { expires: t + SETUP_TTL_MS });
      return { setup: tk, expires: t + SETUP_TTL_MS, count: session.count };
    },
    /**
     * A device says hello. Screens with a known token get their slot back;
     * new screens get a pairing code. Remotes claim the lease when it is
     * free, else join as a viewer.
     */
    hello({
      id,
      kind,
      token: tk = null,
      name = '',
      setup = null,
      slot = null,
    }) {
      const t = now();
      const known = devices.get(id);
      const setupOk = setup && setups.get(setup)?.expires > t;
      if (
        kind === 'screen' &&
        setupOk &&
        Number(slot) >= 1 &&
        Number(slot) <= 6
      ) {
        const s = Number(slot);
        for (const [oid, d] of devices)
          if (d.kind === 'screen' && d.slot === s && oid !== id) {
            d.slot = null;
            d.token = null;
          }
        const d = {
          kind: 'screen',
          slot: s,
          token: token(),
          lastSeen: t,
          online: true,
        };
        devices.set(id, d);
        if (!session.screens[s])
          session = applyCommand(
            session,
            { type: 'count', n: Math.max(s, session.count) },
            { by: 'setup', at: t },
          ).state;
        return { type: 'paired', slot: s, token: d.token };
      }
      if (kind === 'screen') {
        if (known?.token && known.token === tk && known.slot) {
          known.lastSeen = t;
          known.online = true;
          return { type: 'paired', slot: known.slot, token: known.token };
        }
        for (const [c, v] of codes) if (v.deviceId === id) codes.delete(c);
        const code = newCode();
        codes.set(code, { deviceId: id, expires: t + CODE_TTL_MS });
        devices.set(id, { kind, lastSeen: t, online: true });
        return { type: 'pair-code', code, expires: t + CODE_TTL_MS };
      }
      // Remotes need the setup QR or a token from an earlier pairing.
      const trusted =
        setupOk ||
        (known?.kind === 'remote' && known.token && known.token === tk);
      if (!trusted)
        return {
          type: 'denied',
          error: 'Scan the QR on the Trip Twin computer to pair this remote',
        };
      const rt = known?.token && known.token === tk ? tk : token();
      devices.set(id, {
        kind: 'remote',
        name,
        token: rt,
        lastSeen: t,
        online: true,
      });
      if (!leaseLive()) lease = { holder: id, at: t };
      return {
        type: 'remote',
        token: rt,
        controller: lease.holder === id,
      };
    },
    /** The remote enters a screen's code and gives it a slot (1–6). */
    pair({ by, code, slot }) {
      const t = now();
      if (lease.holder !== by || !leaseLive())
        return { ok: false, error: 'Only the controlling remote can pair' };
      if (t < lockedUntil)
        return {
          ok: false,
          error: 'Pairing locked for a minute after 5 wrong codes',
        };
      const c = codes.get(String(code));
      if (!c || c.expires < t) {
        tries += 1;
        if (tries >= MAX_TRIES) {
          lockedUntil = t + 60000;
          tries = 0;
        }
        return { ok: false, error: 'Code not recognised or expired' };
      }
      tries = 0;
      codes.delete(String(code)); // single use
      const s = Number(slot);
      if (!(s >= 1 && s <= 6)) return { ok: false, error: 'Slot must be 1–6' };
      // One device per slot: the old one is unpaired.
      for (const [id, d] of devices)
        if (d.kind === 'screen' && d.slot === s && id !== c.deviceId) {
          d.slot = null;
          d.token = null;
        }
      const d = devices.get(c.deviceId) || { kind: 'screen' };
      d.slot = s;
      d.token = token();
      d.lastSeen = t;
      devices.set(c.deviceId, d);
      if (!session.screens[s]) {
        const r = applyCommand(
          session,
          { type: 'count', n: Math.max(s, session.count) },
          { by, at: t },
        );
        session = r.state;
      }
      return { ok: true, deviceId: c.deviceId, slot: s, token: d.token };
    },
    /** Heartbeat from any device; the controller's renews the lease. */
    beat(id) {
      const d = devices.get(id);
      if (!d) return;
      d.lastSeen = now();
      d.online = true;
      if (lease.holder === id) lease.at = now();
      // A hand-over request nobody answered is granted after 15 s.
      if (handover && now() - handover.at >= HANDOVER_AUTO_MS) {
        lease = { holder: handover.from, at: now() };
        handover = null;
      }
    },
    gone(id) {
      const d = devices.get(id);
      if (d) d.online = false;
    },
    /** A viewer asks for control; free or stale leases pass at once. */
    requestControl(id) {
      if (!leaseLive() || lease.holder === id) {
        lease = { holder: id, at: now() };
        handover = null;
        return { granted: true };
      }
      handover = { from: id, at: now() };
      return { granted: false, pending: true };
    },
    answerHandover(by, accept) {
      if (by !== lease.holder || !handover) return false;
      if (accept) lease = { holder: handover.from, at: now() };
      handover = null;
      return true;
    },
    isController(id) {
      return lease.holder === id && leaseLive();
    },
    /** Run a command from the controlling remote. */
    command({ by, cmd }) {
      if (!(lease.holder === by && leaseLive()))
        return { ok: false, error: 'This remote is not in control' };
      const r = applyCommand(session, cmd, { by, at: now() });
      if (r.error) return { ok: false, error: r.error };
      session = r.state;
      const undoId = `u${++undoSeq}`;
      undos.set(undoId, { undo: r.undo, expires: now() + UNDO_MS });
      for (const [k, v] of undos) if (v.expires < now()) undos.delete(k);
      return {
        ok: true,
        rev: session.rev,
        changed: r.changed,
        skipped: r.skipped,
        undoId,
      };
    },
    undo({ by, undoId }) {
      const u = undos.get(undoId);
      if (!(lease.holder === by && leaseLive()))
        return { ok: false, error: 'This remote is not in control' };
      if (!u || u.expires < now())
        return { ok: false, error: 'Undo is no longer available' };
      undos.delete(undoId);
      session = applyUndo(session, u.undo, { by, at: now() });
      return { ok: true, rev: session.rev };
    },
    /** Screens on this slot (to address thumbnails and identify). */
    slotOf(id) {
      return devices.get(id)?.slot ?? null;
    },
  };
}
