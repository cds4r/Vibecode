import crypto from 'node:crypto';
import { db, id } from './store.js';
import { config } from './config.js';

const SESSION_TTL = 90 * 24 * 60 * 60 * 1000; // 90 дней

export function isAdminEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return !!e && config.adminEmails.includes(e);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function issueSession(userId) {
  const token = 'ses_' + crypto.randomBytes(24).toString('hex');
  await db.createSession({ token, userId, createdAt: Date.now() });
  return token;
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || null,
    name: u.name || '',
    createdAt: u.createdAt,
    admin: isAdminEmail(u.email),
    blocked: !!u.blocked,
  };
}

export async function register({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  if (!validEmail(email)) throw new Error('Введите корректный email');
  if (!password || password.length < 6) throw new Error('Пароль должен быть не короче 6 символов');
  if (await db.findUserByEmail(email)) throw new Error('Пользователь с таким email уже существует');

  const { salt, hash } = hashPassword(password);
  const user = await db.upsertUser({
    id: id('usr_'),
    email,
    name: name || '',
    salt,
    passwordHash: hash,
    createdAt: Date.now(),
  });
  const token = await issueSession(user.id);
  return { token, user: publicUser(user) };
}

export async function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const user = await db.findUserByEmail(email);
  if (!user || !user.passwordHash) throw new Error('Неверный email или пароль');
  if (!verifyPassword(password, user.salt, user.passwordHash)) throw new Error('Неверный email или пароль');
  if (user.blocked) throw new Error('Аккаунт заблокирован. Обратитесь в поддержку.');
  const token = await issueSession(user.id);
  return { token, user: publicUser(user) };
}

export async function logout(token) {
  if (token) await db.deleteSession(token);
}

export async function userFromToken(token) {
  if (!token) return null;
  const session = await db.getSession(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    await db.deleteSession(token);
    return null;
  }
  const user = await db.getUser(session.userId);
  // Заблокированный пользователь не может пользоваться сессией.
  if (user && user.blocked) {
    await db.deleteSession(token);
    return null;
  }
  return user;
}

// Express-middleware: кладёт req.user (или null)
export async function authOptional(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.authToken = token;
  try {
    req.user = await userFromToken(token);
    next();
  } catch (e) {
    next(e);
  }
}

export function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
    next();
  });
}
