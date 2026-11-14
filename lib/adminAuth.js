// Lightweight admin session: a signed cookie, no session table needed.
// Secret is ADMIN_PASSWORD itself — only the server knows it, so it's safe
// to use as the HMAC key as well as the login password.
import crypto from 'node:crypto';

export const ADMIN_COOKIE = 'admin_session';
const SEVEN_DAYS = 7 * 24 * 3600;

function secret() {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error('ADMIN_PASSWORD must be set');
  return s;
}

function hmac(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('hex');
}

export function signSession() {
  const exp = Math.floor(Date.now() / 1000) + SEVEN_DAYS;
  const sig = hmac(`admin:${exp}`);
  return `${exp}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || !sig) return false;
  if (Date.now() / 1000 > exp) return false;
  const expected = hmac(`admin:${exp}`);
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function checkPassword(candidate) {
  if (!candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(secret());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
