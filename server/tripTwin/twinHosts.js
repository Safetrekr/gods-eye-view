// Trip Twin Host and Origin rules (Phase CF K3; PHASE-CF-PLAN S-11, C22,
// §4.4; cf/01-security.md SEC-1, SEC-2, SEC-14; cf/06-qa.md QA-2). Pure: no
// fs, no os, no network, so every rule is a table in a test.
//   - hostLists(): the names this server answers to (per request, C22):
//     localhost, 127.0.0.1, [::1], the LAN addresses, os.hostname() plain
//     and .local, the Bonjour LocalHostName .local, TRIP_TWIN_ALLOWED_HOSTS.
//   - upgradeVerdict(): the new allowlist verdict for the relay socket
//     (exact path, Host on the list, Origin on the list; no or null Origin
//     refused).
//   - todayVerdict(): the rule at 3431392 (syncRelay.js:283-288): an Origin,
//     when present, must equal Host. Report mode keeps enforcing it (S-11,
//     sec B1), so no mode is weaker than today.
//   - twinHostGuard(): every /api/twin-* HTTP endpoint. Sec-Fetch-Site must
//     be same-origin or absent (always on, sec S9, N7); Host is checked in
//     report mode (recorded, not refused) until K12.
//   - localOnly(): for /boot and /log when they land (K11, K6). Always on,
//     whatever the mode (sec S2).
// Origin and Host are filters against browsers used as a confused deputy
// (rebinding, cross-site sockets), not authentication: tokens authorise.

export const SYNC_PATH = '/api/twin-sync';
/** K3 has one mode; `enforce` comes in K12 (S-11). */
export const HOST_CHECK_MODES = Object.freeze(['report']);
export const DEFAULT_HOST_CHECK = 'report';
export const LOOPBACK_NAMES = Object.freeze([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);
/** Header values in a record are cut to this length (SEC-1). */
export const FIELD_MAX = 64;
/** At most this many TRIP_TWIN_ALLOWED_HOSTS entries are read. */
export const EXTRA_MAX = 32;

const NAME_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const HOST_RE = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/;

/** IPv4 LAN addresses (no loopback, no link-local). */
export function lanAddresses(ifaces = {}) {
  const out = [];
  for (const list of Object.values(ifaces || {}))
    for (const a of list || [])
      if (
        (a.family === 'IPv4' || a.family === 4) &&
        !a.internal &&
        !String(a.address).startsWith('169.254.')
      )
        out.push(a.address);
  return out;
}

/** "This computer" as the relay has always read it (syncRelay.js:289-290). */
export const isLoopbackPeer = (ip) =>
  /^(127\.|::1$|::ffff:127\.)/.test(String(ip || ''));

const validName = (n) =>
  NAME_RE.test(n) ||
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(n) ||
  /^\[[0-9a-f:.]+\]$/.test(n);

/**
 * A Host header as `name:port`, lower-cased, the default port filled in
 * (80, or 443 on TLS). Null when it is not a host name.
 */
export function parseHostHeader(value, { secure = false } = {}) {
  if (typeof value !== 'string') return null;
  const m = HOST_RE.exec(value.trim().toLowerCase());
  if (!m || !validName(m[1])) return null;
  const port = m[2] ? Number(m[2]) : secure ? 443 : 80;
  if (!(port >= 1 && port <= 65535)) return null;
  return `${m[1]}:${port}`;
}

/**
 * An Origin header as `scheme://name:port`, or the reason it is refused:
 * 'no-origin', 'null-origin', 'origin' (not an http(s) origin).
 */
export function normalizeOrigin(value) {
  if (value == null || value === '') return { reason: 'no-origin' };
  const s = String(value).trim().toLowerCase();
  if (s === 'null') return { reason: 'null-origin' };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { reason: 'origin' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return { reason: 'origin' };
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/')
    return { reason: 'origin' };
  const host = parseHostHeader(u.host, { secure: u.protocol === 'https:' });
  if (!host) return { reason: 'origin' };
  return { value: `${u.protocol}//${host}` };
}

/**
 * This machine's own names (C22, sec N6): os.hostname() as given and as
 * `<first label>.local`, and the Bonjour LocalHostName as `.local`. On
 * macOS the two can differ (a DHCP name, or `…-2` after a Bonjour clash).
 */
export function machineNames({ hostname = '', bonjour = '' } = {}) {
  const out = new Set();
  const h = String(hostname || '')
    .trim()
    .toLowerCase();
  if (h && NAME_RE.test(h)) {
    out.add(h);
    const first = h.split('.')[0];
    out.add(first);
    out.add(`${first}.local`);
  }
  const b = String(bonjour || '')
    .trim()
    .toLowerCase()
    .replace(/\.local$/, '');
  if (b && NAME_RE.test(b)) out.add(`${b}.local`);
  return [...out];
}

/**
 * TRIP_TWIN_ALLOWED_HOSTS: a comma list of names or addresses, each with an
 * optional port. No wildcards (S-2, sec N2): `*` and a leading dot are
 * refused, and so is anything with a scheme or a path.
 */
export function parseAllowedHosts(value) {
  const entries = [];
  const refused = [];
  const items = String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const raw of items.slice(0, EXTRA_MAX)) {
    const v = raw.toLowerCase();
    const no = (reason) => refused.push({ value: clip(raw), reason });
    if (v.includes('*') || v.startsWith('.')) no('wildcard');
    else if (v.includes('/') || v.includes('@')) no('not a host name');
    else {
      const m = HOST_RE.exec(v);
      if (!m || !validName(m[1])) no('not a host name');
      else if (m[2] && !(Number(m[2]) >= 1 && Number(m[2]) <= 65535))
        no('bad port');
      else entries.push({ name: m[1], port: m[2] ? Number(m[2]) : null });
    }
  }
  for (const raw of items.slice(EXTRA_MAX))
    refused.push({ value: clip(raw), reason: `more than ${EXTRA_MAX}` });
  return { entries, refused };
}

/** `http://` and `https://` for each allowed `host:port` (SEC-14). */
export function allowedOrigins(hosts) {
  const out = new Set();
  for (const h of hosts) {
    out.add(`http://${h}`);
    out.add(`https://${h}`);
  }
  return out;
}

/**
 * The allowlists for one request on `port` (C22): exact `host:port`
 * strings and the origins that go with them. `extra` is the parsed
 * TRIP_TWIN_ALLOWED_HOSTS; an entry without a port gets this port.
 */
export function hostLists({
  port,
  ifaces = {},
  hostname = '',
  bonjour = '',
  extra = [],
} = {}) {
  const names = new Set([
    ...LOOPBACK_NAMES,
    ...lanAddresses(ifaces),
    ...machineNames({ hostname, bonjour }),
  ]);
  const hosts = new Set();
  for (const n of names) hosts.add(`${n}:${port}`);
  for (const e of extra) hosts.add(`${e.name}:${e.port ?? port}`);
  return { port, hosts, origins: allowedOrigins(hosts) };
}

/** Is this Host on the list? `{ok}` or `{ok:false, reason:'host'}`. */
export function hostVerdict(host, lists, { secure = false } = {}) {
  const h = parseHostHeader(host, { secure });
  return h && lists.hosts.has(h) ? { ok: true } : { ok: false, reason: 'host' };
}

/** Upgrades the relay owns at all: today's prefix (the rest is Vite's). */
export const isSyncUpgrade = (url) => String(url || '').startsWith(SYNC_PATH);
/** The exact relay path; a query string is allowed (SEC-1). */
export const isSyncPath = (url) =>
  String(url || '').split('?')[0] === SYNC_PATH;

/**
 * The new rule for a relay upgrade (QA-2): `{ok}` or `{ok:false, reason}`,
 * reason 'path' | 'host' | 'no-origin' | 'null-origin' | 'origin'. The peer
 * address is not part of it: Host and Origin are checked for every peer,
 * loopback included.
 */
export function upgradeVerdict(
  { url = SYNC_PATH, host, origin, secure = false } = {},
  lists,
) {
  if (!isSyncPath(url)) return { ok: false, reason: 'path' };
  const h = hostVerdict(host, lists, { secure });
  if (!h.ok) return h;
  const o = normalizeOrigin(origin);
  if (o.reason) return { ok: false, reason: o.reason };
  if (!lists.origins.has(o.value)) return { ok: false, reason: 'origin' };
  return { ok: true };
}

/**
 * Today's rule, byte for byte (syncRelay.js:283-288 at 3431392): an Origin,
 * when present, must equal Host once its scheme is cut off. No Origin
 * passes. This is the floor report mode keeps (S-11).
 */
export function todayVerdict({ host, origin } = {}) {
  const o = origin || '';
  const h = host || '';
  return o && o.replace(/^https?:\/\//, '') !== h
    ? { ok: false, reason: 'origin-not-host' }
    : { ok: true };
}

/** Sec-Fetch-Site: only same-origin, or none sent (old browsers, Node). */
export const fetchSiteOk = (value) =>
  value == null || value === '' || value === 'same-origin';

/**
 * Only this computer, through a loopback name, from its own pages (§4.4,
 * sec S2): a loopback peer, Host localhost / 127.0.0.1 / [::1] with this
 * server's port, and Sec-Fetch-Site same-origin or absent. Always on.
 */
export function localOnly({
  remoteAddress,
  host,
  secFetchSite,
  port,
  secure = false,
} = {}) {
  if (!isLoopbackPeer(remoteAddress)) return { ok: false, reason: 'peer' };
  const h = parseHostHeader(host, { secure });
  if (!h || !LOOPBACK_NAMES.some((n) => h === `${n}:${port}`))
    return { ok: false, reason: 'host' };
  if (!fetchSiteOk(secFetchSite)) return { ok: false, reason: 'fetch-site' };
  return { ok: true };
}

/** localOnly() for a Node request on `port`. */
export const localOnlyRequest = (req, port) =>
  localOnly({
    remoteAddress: req?.socket?.remoteAddress,
    host: req?.headers?.host,
    secFetchSite: req?.headers?.['sec-fetch-site'],
    port: req?.socket?.localPort || port,
    secure: Boolean(req?.socket?.encrypted),
  });

/** A header value as it may be recorded: printable, at most 64 chars. */
export function clip(v) {
  if (v == null) return null;
  return String(v)
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, FIELD_MAX);
}

/** The path of a URL, without its query (queries are never recorded). */
export const pathOnly = (url) => clip(String(url || '').split('?')[0]);

/**
 * One would-refuse record (JSONL; K6 takes the file over). `reason` is the
 * new rule's; `today` is today's rule; `effect` is what this server did.
 * Never a token, a query string or a body.
 */
export function wouldRefuseLine({
  at,
  kind,
  mode,
  reason,
  today,
  effect,
  host,
  origin,
  peer,
  path,
  secure = false,
}) {
  return {
    v: 1,
    at,
    type: 'host.would_refuse',
    kind,
    mode,
    reason,
    today,
    effect,
    host: clip(host),
    origin: clip(origin),
    peer: clip(peer),
    path: pathOnly(path),
    secure: Boolean(secure),
  };
}

const GUARDED = Symbol('tripTwinHostGuard');

function forbid(res, error) {
  res.writeHead(403, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: false, error }));
}

/**
 * The Host guard for Trip Twin HTTP endpoints (SEC-2), mounted first by
 * each Trip Twin plugin on its own paths. `check` is the server's host
 * check (twinHostCheck.js): {mode, lists(port), port(), record(line),
 * note(event, data), now()}. Trip Twin endpoints send no CORS headers.
 */
export function twinHostGuard({ check }) {
  return function tripTwinHostGuard(req, res, next) {
    if (req[GUARDED]) return next();
    req[GUARDED] = true;
    const path = req.originalUrl || req.url;
    const peer = req.socket?.remoteAddress || '';
    const site = req.headers?.['sec-fetch-site'];
    // Always on: a cross-site or same-site page cannot fire these blind.
    if (!fetchSiteOk(site)) {
      check.note('http.refused', {
        reason: 'fetch-site',
        site: clip(site),
        path: pathOnly(path),
      });
      return forbid(res, 'Cross-site requests are refused');
    }
    const secure = Boolean(req.socket?.encrypted);
    const port = req.socket?.localPort || check.port();
    const v = hostVerdict(req.headers?.host, check.lists(port), { secure });
    // Report mode (K3): today has no Host check here, so the floor allows;
    // the new rule's refusal is recorded. K12 refuses.
    if (!v.ok)
      check.record(
        wouldRefuseLine({
          at: new Date(check.now()).toISOString(),
          kind: 'http',
          mode: check.mode,
          reason: v.reason,
          today: 'allowed',
          effect: 'allowed',
          host: req.headers?.host,
          origin: req.headers?.origin,
          peer,
          path,
          secure,
        }),
      );
    return next();
  };
}
