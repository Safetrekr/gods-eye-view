import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = '__Host-safetrekr-world';
const TTL = 300;
const signature = (payload, secret) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

// Authorizes public-provider usage only. Every private Core request still
// verifies the user's Supabase token, current profile and staff scope in Core.
export function issueProviderSession(res, secret, now = Date.now()) {
  if (!secret || secret.length < 32)
    throw new Error('Provider session secret missing');
  const payload = String(Math.floor(now / 1000) + TTL);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${payload}.${signature(payload, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}`,
  );
}

export function validProviderSession(cookie, secret, now = Date.now()) {
  if (!secret || secret.length < 32) return false;
  const value = String(cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value) return false;
  const [expires, mac, extra] = value.split('.');
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (
    extra ||
    !/^\d+$/.test(expires) ||
    !mac ||
    remaining <= 0 ||
    remaining > TTL
  )
    return false;
  const expected = Buffer.from(signature(expires, secret));
  const actual = Buffer.from(mac);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function clearProviderSession(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  );
}
