// Trip Twin device tokens at rest (Phase CF L5; PHASE-CF-PLAN S-14,
// cf/01-security.md SEC-6 (hashing), cf/07-reasoning.md ET-7 R6c): the
// store and the host keep `tokenHash` = sha256(token), hex, and never the
// token. A presented token is hashed and compared with timingSafeEqual.
// The plain token exists only in the client and in the one welcome or
// `paired` message that delivers it.
//   - TOKENS: what the relay hands the session host (twinSessionHost.js
//     stays free of node: imports; it is in src/).
//   - hashDevices / scrubText: the v1 → v2 migration of a store, and of
//     the backup and quarantine/ (hashed in place, so no plain token is
//     left at rest).
//   - plainTokenFiles: the whole-folder scan (S-14) — the data folder,
//     session.prev.json, quarantine/ and the relay's os.tmpdir() files.
// Nothing here logs or returns a token.
import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HEX64 = /^[0-9a-f]{64}$/;

/** sha256 of a token, as 64 hex characters. */
export function tokenHash(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** Does `token` hash to `hash`? Constant time over the 32 bytes. */
export function sameToken(token, hash) {
  if (typeof token !== 'string' || !token) return false;
  if (typeof hash !== 'string' || !HEX64.test(hash)) return false;
  return timingSafeEqual(
    Buffer.from(tokenHash(token), 'hex'),
    Buffer.from(hash, 'hex'),
  );
}

export const isTokenHash = (v) => typeof v === 'string' && HEX64.test(v);

/** For createSessionHost({tokens}). */
export const TOKENS = Object.freeze({ hash: tokenHash, same: sameToken });

/**
 * Device pairs [id, record] with every plain `token` replaced by its
 * `tokenHash` (a record that already has a hash keeps it). Returns
 * {devices, hashed} (how many tokens were hashed). New objects.
 */
export function hashDevices(devices = []) {
  let hashed = 0;
  const out = devices.map(([id, d]) => {
    if (!d || typeof d !== 'object') return [id, d];
    const { token, ...rest } = d;
    if (typeof token === 'string' && token) {
      hashed += 1;
      if (!isTokenHash(rest.tokenHash)) rest.tokenHash = tokenHash(token);
    } else if (!('tokenHash' in rest)) rest.tokenHash = null;
    return [id, rest];
  });
  return { devices: out, hashed };
}

// `"token":"…"` as JSON.stringify writes it (spaces allowed for a hand
// edit). A token is base64url (or base36 before K7), never escaped.
const TOKEN_FIELD = /"token"(\s*):(\s*)"([^"\\]*)"/g;
const TOKEN_OPEN = /"token"\s*:\s*"/;

/**
 * Raw text with every plain token field turned into its hash field. Works
 * on a torn file too (quarantine/ holds files that are not JSON): a token
 * cut off by the tear is dropped with the rest of the file after it.
 * Returns {text, hashed, cut}.
 */
export function scrubText(text) {
  let hashed = 0;
  let out = String(text).replace(TOKEN_FIELD, (m, a, b, tk) => {
    hashed += 1;
    return `"tokenHash"${a}:${b}"${tokenHash(tk)}"`;
  });
  const open = out.search(TOKEN_OPEN);
  const cut = open >= 0;
  if (cut) out = out.slice(0, open);
  return { text: out, hashed, cut };
}

/** True when the text holds a plain token field (a string value). */
export const holdsPlainToken = (text) => TOKEN_OPEN.test(String(text));

/** Every file under `dir` (recursive); [] when it is absent. */
export function filesUnder(dir, fsi = fs) {
  try {
    return fsi
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(e.parentPath ?? e.path, e.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The whole-folder token scan (S-14): every file under `dirs` and every
 * file in `files`, as raw bytes. A file is a finding when it holds a plain
 * token field, or (tests and the harness, which hold the clients' tokens)
 * any of `tokens` verbatim. `skip` names files left out on purpose (the
 * plain pre-migration copy until its drill passes). Returns
 * [{file, why}]; never the token.
 */
export function plainTokenFiles({
  dirs = [],
  files = [],
  tokens = [],
  skip = [],
  fs: fsi = fs,
} = {}) {
  const leave = new Set(skip.map((f) => path.resolve(f)));
  const all = [
    ...new Set([...dirs.flatMap((d) => filesUnder(d, fsi)), ...files]),
  ].filter((f) => !leave.has(path.resolve(f)));
  const out = [];
  const known = tokens.filter((t) => typeof t === 'string' && t.length >= 8);
  for (const file of all) {
    let text;
    try {
      text = fsi.readFileSync(file, 'utf8');
    } catch {
      continue; // absent: nothing at rest
    }
    if (holdsPlainToken(text)) out.push({ file, why: 'plain token field' });
    else if (known.some((t) => text.includes(t)))
      out.push({ file, why: 'a known token, verbatim' });
  }
  return out;
}
