// SOC multi-view session host (phase 10; review/phase10 R1, R10, R14, R17,
// R18): pairing, one controller at a time (lease), presence, commands
// through the pure reducer and 10 s undo. Runs inside the dev-server relay
// (server/tripTwin/syncRelay.js). Pure: no I/O; snapshot()/restore for the
// relay to keep the wall across restarts.
// Phase CF K4 (CF-2, C16): hello refusals carry a code (twinProtocol.js);
// one live identity per device id — the relay says which id has a live
// socket, and a newcomer with the same token for the same place replaces
// it, while one for another place is told ID_COPIED; an expired setup
// link says so instead of falling silently to a pair code.
// Prototype only — production needs TLS, device enrolment, operator SSO,
// signed commands and an audit log (07-production-delta).
import { applyCommand, applyUndo, createSession } from './twinSession.js';
import { DENY } from './twinProtocol.js';
import { LAYER_CATALOG } from './twinScreenRoles.js';

const LAYER_KEYS = new Set(
  LAYER_CATALOG.flatMap((g) => g.layers.map((L) => L.key)),
);
const MOTION_KEYS = new Set(['live', 'event', 'cine']);
const SCALES = new Set(['building', 'neighborhood', 'city']);

export const CODE_TTL_MS = 5 * 60 * 1000;
export const LEASE_MS = 30 * 1000;
export const UNDO_MS = 10 * 1000;
export const MAX_TRIES = 5;
export const SETUP_TTL_MS = 10 * 60 * 1000;

export function createSessionHost({
  now = () => Date.now(),
  random = Math.random,
  restore = null,
} = {}) {
  let session = restore?.session || createSession({ epochMs: now() });
  // id → {kind, slot, token, name, lastSeen, online}
  const devices = new Map(
    (restore?.devices || []).map(([id, d]) => [id, { ...d, online: false }]),
  );
  const codes = new Map(); // code → {deviceId, expires}
  let tries = 0;
  let lockedUntil = 0;
  let lease = restore?.lease || { holder: null, at: 0 };
  let handover = null; // {from, at}
  // Setup tokens: the computer that chose Multi-view opens its own screen
  // windows and shows a QR for the remote; both carry this token.
  const setups = new Map(); // token → {expires}
  const undos = new Map(); // id → {undo, expires}
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
  const deny = (code, error) => ({ type: 'denied', code, error });
  const leaseLive = () => lease.holder && now() - lease.at < LEASE_MS;
  const holderOnline = () =>
    leaseLive() && devices.get(lease.holder)?.online !== false;
  /** Free the slot for a new device; the old device is told (R10). */
  function freeSlot(slot, keepId) {
    const out = [];
    for (const [id, d] of devices)
      if (d.kind === 'screen' && d.slot === slot && id !== keepId) {
        d.slot = null;
        d.token = null;
        out.push(id);
      }
    return out;
  }

  /** Presence with device ids — the relay strips ids per socket. */
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
          controller: lease.holder === id && holderOnline(),
        });
    }
    return {
      screens,
      remotes,
      controller: holderOnline() ? lease.holder : null,
      handover: handover && {
        from: handover.from,
        fromName: devices.get(handover.from)?.name || 'Another remote',
        at: handover.at,
      },
    };
  }

  return {
    get state() {
      return session;
    },
    presence,
    /** What the relay saves to disk (no setup tokens or codes). */
    snapshot() {
      return { session, devices: [...devices], lease };
    },
    /** Start a multi-view setup for N screens: a fresh wall. */
    setup({ count = 4, tripId = null, siteKey = null } = {}) {
      const t = now();
      const prevRev = session.rev;
      session = createSession({ count, epochMs: t });
      session.rev = prevRev + 1;
      session = applyCommand(
        session,
        { type: 'session', patch: { tripId, siteKey } },
        { by: 'setup', at: t },
      ).state;
      session.session.epochMs = t;
      const tk = token();
      setups.set(tk, { expires: t + SETUP_TTL_MS });
      return { setup: tk, expires: t + SETUP_TTL_MS, count: session.count };
    },
    /**
     * A device says hello. Returns {type, …, unpaired: [ids to tell]}; a
     * refusal is {type: 'denied', code, error} (twinProtocol.js DENY).
     * An id that holds a token belongs to that device: claiming it without
     * the token is refused (review/phase10 R1).
     * `live` (from the relay): {kind, slot} of a socket that already holds
     * this id. The same token for the same place is a reload, a restored
     * window or a duplicated tab: accepted, and the relay replaces the old
     * socket. Another place means the id was copied into a second window
     * (window.open copies sessionStorage): ID_COPIED, the newcomer takes
     * a fresh id (C16, SEC-9).
     */
    hello({
      id,
      kind,
      token: tk = null,
      name = '',
      setup = null,
      slot = null,
      live = null,
    }) {
      const t = now();
      if (!id || typeof id !== 'string')
        return deny(DENY.NO_ID, 'No device id');
      const known = devices.get(id);
      const setupOk = Boolean(setup) && setups.get(setup)?.expires > t;
      if (known?.token && tk !== known.token)
        return deny(DENY.ID_IN_USE, 'This device id is already in use');
      if (kind === 'launcher')
        return setupOk
          ? { type: 'launcher' }
          : setup
            ? deny(
                DENY.TICKET_EXPIRED,
                'This launch link has expired · start Multi-view again on the Trip Twin computer',
              )
            : deny(DENY.NOT_TRUSTED, 'Start multi-view on this computer');
      if (kind !== 'screen' && kind !== 'remote')
        return deny(DENY.UNKNOWN_KIND, 'Unknown device');
      // A token proves the device, not a change of kind.
      if (known?.token && known.kind !== kind)
        return deny(DENY.ID_IN_USE, 'This device id is already in use');
      const hint = Number(slot) >= 1 && Number(slot) <= 6 ? Number(slot) : null;
      if (live) {
        const place = kind === 'screen' ? (hint ?? known?.slot ?? null) : null;
        if (live.kind !== kind || (live.slot ?? null) !== place)
          return deny(
            DENY.ID_COPIED,
            'This device id is open in another window · this window takes a new one',
          );
      }
      if (kind === 'screen') {
        if (setupOk && hint) {
          const s = hint;
          const unpaired = freeSlot(s, id);
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
          return { type: 'paired', slot: s, token: d.token, unpaired };
        }
        if (known?.token && known.slot) {
          known.lastSeen = t;
          known.online = true;
          return { type: 'paired', slot: known.slot, token: known.token };
        }
        // Say why instead of a bare code (R-1): the window drops the link
        // and asks again without it, which gives the pair card.
        if (setup && !setupOk)
          return deny(
            DENY.TICKET_EXPIRED,
            'This screen link has expired · open the screen from the launcher again, or pair it with a code',
          );
        for (const [c, v] of codes) if (v.deviceId === id) codes.delete(c);
        const code = newCode();
        codes.set(code, { deviceId: id, expires: t + CODE_TTL_MS });
        devices.set(id, { kind, lastSeen: t, online: true });
        return { type: 'pair-code', code, expires: t + CODE_TTL_MS };
      }
      // Remotes need the setup QR or their own token from an earlier pairing.
      const trusted = setupOk || (known?.kind === 'remote' && known.token);
      if (!trusted) {
        // The token is the pairing: when it is gone, say that first.
        if (tk)
          return deny(
            DENY.FORGOTTEN,
            'The Trip Twin computer no longer knows this remote · scan the QR on the Trip Twin computer to pair it again',
          );
        if (setup)
          return deny(
            DENY.TICKET_EXPIRED,
            'This pairing code has expired · scan the QR on the Trip Twin computer again',
          );
        return deny(
          DENY.NOT_TRUSTED,
          'Scan the QR on the Trip Twin computer to pair this remote',
        );
      }
      const rt = known?.token || token();
      devices.set(id, {
        kind: 'remote',
        name: String(name || 'Remote').slice(0, 24),
        token: rt,
        lastSeen: t,
        online: true,
      });
      if (!holderOnline()) lease = { holder: id, at: t };
      return { type: 'remote', token: rt, controller: lease.holder === id };
    },
    /** The remote enters a screen's code and gives it a slot (1–6). */
    pair({ by, code, slot }) {
      const t = now();
      if (lease.holder !== by || !leaseLive())
        return { ok: false, error: 'Only the remote in control can pair' };
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
      const unpaired = freeSlot(s, c.deviceId);
      const d = devices.get(c.deviceId) || { kind: 'screen' };
      d.slot = s;
      d.token = token();
      d.lastSeen = t;
      devices.set(c.deviceId, d);
      if (!session.screens[s])
        session = applyCommand(
          session,
          { type: 'count', n: Math.max(s, session.count) },
          { by, at: t },
        ).state;
      return {
        ok: true,
        deviceId: c.deviceId,
        slot: s,
        token: d.token,
        unpaired,
      };
    },
    /** Heartbeat from any device; the controller's renews the lease. */
    beat(id) {
      const d = devices.get(id);
      if (!d) return;
      d.lastSeen = now();
      d.online = true;
      if (lease.holder === id) lease.at = now();
    },
    gone(id) {
      const d = devices.get(id);
      if (d) d.online = false;
      // A remote that asked for control and left takes its request with it.
      if (handover?.from === id) handover = null;
    },
    /**
     * A viewer asks for control. Granted at once only when nobody is in
     * control (offline or lapsed); otherwise the controller decides —
     * never silently (review/phase10 R14).
     */
    requestControl(id) {
      if (!holderOnline() || lease.holder === id) {
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
      lease.at = now();
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
    /**
     * A paired screen changes its own layers and display from its keyboard
     * (L / D at the wall; Jesse, 23 Oct 2026). Its own slot only, these
     * fields only, no lease needed: the session stays the one truth, so
     * the remote shows the change at once. Role, mode, pin and anything
     * wall-wide stay on the remote.
     */
    screenCommand({ by, cmd }) {
      const d = devices.get(by);
      if (d?.kind !== 'screen' || !d.slot)
        return { ok: false, error: 'This screen is not paired' };
      const own = Number(cmd?.target) === d.slot;
      let safe = null;
      if (cmd?.type === 'reset' && own)
        safe = { type: 'reset', target: d.slot };
      if (cmd?.type === 'screens' && own) {
        const p = cmd.patch || {};
        const patch = {};
        const flags = (o, keys) =>
          Object.fromEntries(
            Object.entries(o && typeof o === 'object' ? o : {})
              .filter(([k, v]) => keys.has(k) && typeof v === 'boolean')
              .slice(0, 40),
          );
        if ('layers' in p) {
          const l = flags(p.layers, LAYER_KEYS);
          if (Object.keys(l).length) patch.layers = l;
        }
        if ('motion' in p) {
          const m = flags(p.motion, MOTION_KEYS);
          if (Object.keys(m).length) patch.motion = m;
        }
        if (SCALES.has(p.scale)) patch.scale = p.scale;
        if (Number.isFinite(p.textScale))
          patch.textScale = Math.max(1, Math.min(3.5, p.textScale));
        if (Object.keys(patch).length)
          safe = { type: 'screens', target: d.slot, patch };
      }
      if (!safe)
        return {
          ok: false,
          error: 'A screen changes only its own layers and display',
        };
      const r = applyCommand(session, safe, { by: `S${d.slot}`, at: now() });
      session = r.state;
      return { ok: true, rev: session.rev, changed: r.changed, slot: d.slot };
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
    /** A device's slot (to address thumbnails and identify). */
    slotOf(id) {
      return devices.get(id)?.slot ?? null;
    },
    kindOf(id) {
      return devices.get(id)?.kind ?? null;
    },
  };
}
