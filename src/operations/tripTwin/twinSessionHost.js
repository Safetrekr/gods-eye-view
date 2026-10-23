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
// Phase CF K5 (BE-1, SEC-11, CF-D8, §4.4, F-0003): every paired device has
// a public ref ('D3', persisted, sequential, never the device id) and a
// name the host owns — kind names only ("iPad", "iPad 2", "Phone",
// "Laptop"; a remote on this computer is "Trip Twin computer"; screens
// "S4"). State holds refs only; the ref table keeps every ref ever issued
// with its name, so a change still names a device that is gone. Setup and
// pairing write as the host (D0, "Trip Twin computer", via 'system').
// Command refusals carry a code (twinProtocol.js CODE).
// Prototype only — production needs TLS, device enrolment, operator SSO,
// signed commands and an audit log (07-production-delta).
import { applyCommand, applyUndo, createSession } from './twinSession.js';
import {
  ACTOR_FIELDS as ACTOR_KEYS,
  CODE,
  DENY,
  HOST_NAME,
  HOST_REF,
  REMOTE_NAMES,
  VIA,
  isRef,
} from './twinProtocol.js';
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

const refNo = (ref) => (isRef(ref) ? Number(ref.slice(1)) : 0);
const HOST_ENTRY = Object.freeze({ kind: 'host', name: HOST_NAME, slot: null });

/**
 * The kind name for a remote (CF-D8): the Trip Twin computer when its
 * socket is on this computer, else the page's kind from a closed list
 * (remote.js sends 'iPad', 'Phone' or 'Laptop'); anything else is a
 * Laptop, as remote.js itself decides. Never free text.
 */
export function remoteKindName(name, { local = false } = {}) {
  if (local) return HOST_NAME;
  return REMOTE_NAMES.includes(name) ? name : 'Laptop';
}

/** "iPad", then "iPad 2", "iPad 3" … : the first name not in `taken`. */
export function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1)
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * Rewrite every attribution in a state to a ref (restore migration,
 * BE-1): a ref the table knows stays; a device id becomes that device's
 * ref; 'setup' (the pre-K5 host writer) becomes the host; anything else
 * (an unknown id, the old default 'remote') becomes null. In place.
 */
export function migrateAttribution(session, { refs, refOfId }) {
  const fix = (by) =>
    by == null
      ? null
      : refs[by] || by === HOST_REF
        ? by
        : refOfId(by) || (by === 'setup' ? HOST_REF : null);
  const fixMeta = (meta) => {
    if (!meta || typeof meta !== 'object') return;
    for (const m of Object.values(meta))
      if (m && typeof m === 'object' && 'by' in m) m.by = fix(m.by);
  };
  for (const s of Object.values(session?.screens || {})) fixMeta(s?.meta);
  fixMeta(session?.session?.meta);
  if (session?.lastUndo && typeof session.lastUndo === 'object')
    session.lastUndo.by = fix(session.lastUndo.by);
  return session;
}

/** Every ref a state names (to resolve in presence `actors`). */
export function refsInState(session) {
  const out = new Set();
  const add = (meta) => {
    for (const m of Object.values(meta || {})) if (isRef(m?.by)) out.add(m.by);
  };
  for (const s of Object.values(session?.screens || {})) add(s?.meta);
  add(session?.session?.meta);
  if (isRef(session?.lastUndo?.by)) out.add(session.lastUndo.by);
  return out;
}

export function createSessionHost({
  now = () => Date.now(),
  random = Math.random,
  restore = null,
} = {}) {
  let session = restore?.session || createSession({ epochMs: now() });
  // id → {kind, slot, token, name, ref, lastSeen, online}
  const devices = new Map(
    (restore?.devices || []).map(([id, d]) => [id, { ...d, online: false }]),
  );
  // ref → {kind, name, slot}: every ref ever issued (F-0003). D0 is the host.
  const refs = {};
  for (const [r, e] of Object.entries(restore?.refs || {}))
    if (isRef(r) && r !== HOST_REF && e && typeof e === 'object')
      refs[r] = {
        kind: String(e.kind || ''),
        name: String(e.name || '').slice(0, 24),
        slot: Number.isInteger(e.slot) ? e.slot : null,
      };
  // A build from before K5 that ran on this store (a revert) keeps the
  // devices' refs but drops the table: rebuild those entries, so a ref in
  // the state still names the device it named, and is never issued again.
  for (const [, d] of devices)
    if (isRef(d.ref) && d.ref !== HOST_REF && !refs[d.ref]) {
      if (d.kind === 'remote' && d.token)
        refs[d.ref] = {
          kind: 'remote',
          name:
            REMOTE_NAMES.includes(d.name) || d.name === HOST_NAME
              ? d.name
              : 'Laptop',
          slot: null,
        };
      else if (d.kind === 'screen' && d.slot)
        refs[d.ref] = { kind: 'screen', name: `S${d.slot}`, slot: d.slot };
    }
  let nextRef = Math.max(
    1,
    Number.isInteger(restore?.nextRef) ? restore.nextRef : 1,
    ...Object.keys(refs).map((r) => refNo(r) + 1),
    ...[...devices.values()].map((d) => refNo(d.ref) + 1),
    // A ref the state names but no record holds (dropped by a reverted
    // build) is never issued again; the migration below clears it.
    ...[...refsInState(session)].map((r) => refNo(r) + 1),
  );
  const codes = new Map(); // code → {deviceId, expires}
  let tries = 0;
  let lockedUntil = 0;
  let lease = restore?.lease || { holder: null, at: 0 };
  let handover = null; // {from, at}
  // Setup tokens: the computer that chose Multi-view opens its own screen
  // windows and shows a QR for the remote; both carry this token.
  const setups = new Map(); // token → {expires}
  const undos = new Map(); // id → {undo, expires, of}
  let undoSeq = 0;

  /** Names taken by devices on the wall now, for one kind. */
  const namesInUse = (kind, notId = null) => {
    const out = new Set();
    for (const [id, d] of devices)
      if (id !== notId && d.kind === kind && refs[d.ref])
        out.add(refs[d.ref].name);
    return out;
  };
  /** A new ref for this device, with its name fixed for good. */
  const issueRef = (id, d, name) => {
    const ref = `D${nextRef++}`;
    refs[ref] = {
      kind: d.kind,
      name,
      slot: d.kind === 'screen' ? d.slot : null,
    };
    d.ref = ref;
    return ref;
  };
  /**
   * A paired screen's ref names its slot ("S4"). A screen moved to
   * another slot gets a new ref, so an old "by S2" never reads "S4".
   */
  const screenRef = (id, d) =>
    refs[d.ref]?.kind === 'screen' && refs[d.ref].slot === d.slot
      ? d.ref
      : issueRef(id, d, `S${d.slot}`);
  const refOfId = (id) => {
    const r = devices.get(id)?.ref;
    return refs[r] ? r : null;
  };

  // Restore migration (BE-1): before the first broadcast. Devices from a
  // pre-K5 store (or written by a reverted build) get refs; a ref two
  // records claim stays with the first; attributions become refs.
  {
    const seen = new Set();
    // First the records whose ref is good, so new names avoid theirs.
    for (const [, d] of devices)
      if (refs[d.ref] && !seen.has(d.ref) && refs[d.ref].kind === d.kind)
        seen.add(d.ref);
      else delete d.ref;
    for (const [id, d] of devices) {
      if (!d.ref && d.kind === 'screen' && d.slot && d.token) screenRef(id, d);
      if (!d.ref && d.kind === 'remote' && d.token) {
        const base =
          REMOTE_NAMES.includes(d.name) || d.name === HOST_NAME
            ? d.name
            : 'Laptop';
        issueRef(id, d, uniqueName(base, namesInUse('remote', id)));
      }
      if (d.kind === 'remote' && refs[d.ref]) d.name = refs[d.ref].name;
    }
    migrateAttribution(session, { refs, refOfId });
  }

  /** The public actor for a ref (§4.4); null for a ref never issued. */
  function actor(ref, via = VIA.TOUCH) {
    if (ref === HOST_REF) return { ref, ...HOST_ENTRY, via: VIA.SYSTEM };
    const e = refs[ref];
    return e ? { ref, kind: e.kind, name: e.name, slot: e.slot, via } : null;
  }
  /** Presence `actors`: devices on the wall, the host, refs the state names. */
  function actors() {
    const out = new Map([
      [HOST_REF, { ref: HOST_REF, ...HOST_ENTRY, online: true }],
    ]);
    for (const [, d] of devices)
      if (refs[d.ref])
        out.set(d.ref, {
          ref: d.ref,
          ...refs[d.ref],
          online:
            d.online !== false && (d.kind !== 'screen' || Boolean(d.slot)),
        });
    for (const r of refsInState(session))
      if (!out.has(r) && refs[r])
        out.set(r, { ref: r, ...refs[r], online: false });
    return [...out.values()].sort((a, b) => refNo(a.ref) - refNo(b.ref));
  }

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
          ref: d.ref ?? null,
        };
      if (d.kind === 'remote')
        remotes.push({
          id,
          ref: d.ref ?? null,
          name: refs[d.ref]?.name || d.name,
          online: d.online !== false,
          // A dropped remote keeps the lease for 30 s so it can come back,
          // but walls say "Remote offline" at once.
          controller: lease.holder === id && holderOnline(),
          controlSince:
            lease.holder === id && holderOnline()
              ? (lease.since ?? lease.at)
              : null,
        });
    }
    return {
      screens,
      remotes,
      actors: actors(),
      controller: holderOnline() ? lease.holder : null,
      handover: handover && {
        from: handover.from,
        fromRef: devices.get(handover.from)?.ref ?? null,
        fromName: devices.get(handover.from)?.name || 'Another remote',
        at: handover.at,
      },
    };
  }
  /** The lease to a new holder: `since` is when it changed hands. */
  const grant = (id) => {
    const t = now();
    lease = {
      holder: id,
      at: t,
      since: lease.holder === id ? (lease.since ?? t) : t,
    };
  };

  return {
    get state() {
      return session;
    },
    presence,
    actor,
    /** The actor for a device id (the relay's socket), or null. */
    actorOf(id, via = VIA.TOUCH) {
      const r = refOfId(id);
      return r ? actor(r, via) : null;
    },
    /** What the relay saves to disk (no setup tokens or codes). */
    snapshot() {
      return {
        session,
        devices: [...devices],
        lease,
        refs: { ...refs },
        nextRef,
      };
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
        { by: HOST_REF, at: t },
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
      local = false,
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
            ref: known?.ref,
            lastSeen: t,
            online: true,
          };
          devices.set(id, d);
          screenRef(id, d);
          if (!session.screens[s])
            session = applyCommand(
              session,
              { type: 'count', n: Math.max(s, session.count) },
              { by: HOST_REF, at: t },
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
        // A screen waiting for a code keeps a ref it had (it may pair back).
        devices.set(id, {
          kind,
          ...(known?.ref ? { ref: known.ref } : {}),
          lastSeen: t,
          online: true,
        });
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
      // The host names a remote once, at pairing; later hellos keep it.
      const d = {
        kind: 'remote',
        name: '',
        token: rt,
        ref: known?.ref,
        lastSeen: t,
        online: true,
      };
      if (!(refs[d.ref]?.kind === 'remote'))
        issueRef(
          id,
          d,
          uniqueName(remoteKindName(name, { local }), namesInUse('remote', id)),
        );
      d.name = refs[d.ref].name;
      devices.set(id, d);
      if (!holderOnline()) grant(id);
      return { type: 'remote', token: rt, controller: lease.holder === id };
    },
    /** The remote enters a screen's code and gives it a slot (1–6). */
    pair({ by, code, slot }) {
      const t = now();
      if (lease.holder !== by || !leaseLive())
        return {
          ok: false,
          code: CODE.LEASE_NOT_CONTROLLER,
          error: 'Only the remote in control can pair',
        };
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
      screenRef(c.deviceId, d);
      // The wall grows to fit as part of pairing: written by the host.
      if (!session.screens[s])
        session = applyCommand(
          session,
          { type: 'count', n: Math.max(s, session.count) },
          { by: HOST_REF, at: t },
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
        grant(id);
        handover = null;
        return { granted: true };
      }
      handover = { from: id, at: now() };
      return { granted: false, pending: true };
    },
    answerHandover(by, accept) {
      if (by !== lease.holder || !handover) return false;
      if (accept) grant(handover.from);
      handover = null;
      return true;
    },
    isController(id) {
      return lease.holder === id && leaseLive();
    },
    /** Run a command from the controlling remote. */
    command({ by, cmd }) {
      if (!(lease.holder === by && leaseLive()))
        return {
          ok: false,
          code: CODE.LEASE_NOT_CONTROLLER,
          error: 'This remote is not in control',
        };
      // Attribution is the socket's, never the message's (S-18, F-0009).
      const claimed =
        cmd && typeof cmd === 'object'
          ? ACTOR_KEYS.find((k) => Object.hasOwn(cmd, k))
          : null;
      if (claimed)
        return {
          ok: false,
          code: CODE.VALIDATION_COMMAND,
          error: `Not applied: ${claimed} is not valid`,
        };
      const r = applyCommand(session, cmd, { by: refOfId(by), at: now() });
      if (r.error)
        return { ok: false, code: CODE.UNKNOWN_COMMAND, error: r.error };
      session = r.state;
      lease.at = now();
      const undoId = `u${++undoSeq}`;
      undos.set(undoId, {
        undo: r.undo,
        expires: now() + UNDO_MS,
        of: session.rev,
      });
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
        return {
          ok: false,
          code: CODE.LEASE_NOT_CONTROLLER,
          error: 'This remote is not in control',
        };
      if (!u || u.expires < now())
        return {
          ok: false,
          code: CODE.UNDO_EXPIRED,
          error: 'Undo is no longer available',
        };
      undos.delete(undoId);
      session = applyUndo(session, u.undo, {
        by: refOfId(by),
        at: now(),
        of: u.of,
      });
      return { ok: true, rev: session.rev, of: u.of };
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
