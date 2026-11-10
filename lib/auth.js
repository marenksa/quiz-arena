// Nickname + PIN login with hashed PINs and HttpOnly session cookies.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'qa_session';
const SESSION_DAYS = 180;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPin(pin, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const key = await scrypt(pin, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected);
}

function readToken(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function createSession(sql, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${sha256(token)}, ${userId}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  return token;
}

export async function sessionUser(sql, request) {
  const token = readToken(request);
  if (!token) return null;
  const [user] = await sql`
    select u.id, u.nickname, u.streak, u.best_streak, u.include_pensum
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  return user || null;
}

export async function deleteSession(sql, request) {
  const token = readToken(request);
  if (token) await sql`delete from sessions where token_hash = ${sha256(token)}`;
}

function secureFlag(request) {
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  return proto === 'https' ? '; Secure' : '';
}

export function sessionCookie(request, token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureFlag(request)}`;
}

export function clearedCookie(request) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(request)}`;
}
