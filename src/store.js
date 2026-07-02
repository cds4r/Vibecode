import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isDbMysql } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export function id(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const parseJSON = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/* =========================================================================
 * JSON-хранилище (по умолчанию). Данные — в data/db.json.
 * ======================================================================= */
const empty = { users: [], orders: [], subscriptions: [], sessions: [] };

function ensureJson() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
}

let data = null;
function load() {
  if (data) return data;
  ensureJson();
  try {
    data = { ...empty, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    data = { ...empty };
  }
  for (const k of ['users', 'orders', 'subscriptions', 'sessions']) {
    data[k] = Array.isArray(data[k]) ? data[k].filter(Boolean) : [];
  }
  return data;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ensureJson();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  }, 50);
}

const jsonBackend = {
  async init() { ensureJson(); load(); },

  // ---- Users ----
  async upsertUser(user) {
    const d = load();
    const idx = d.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) d.users[idx] = { ...d.users[idx], ...user };
    else d.users.push({ blocked: false, ...user });
    save();
    return d.users.find((u) => u.id === user.id);
  },
  async findUserByTelegram(tgId) {
    return load().users.find((u) => u.telegramId === String(tgId)) || null;
  },
  async findUserByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return load().users.find((u) => (u.email || '').toLowerCase() === e) || null;
  },
  async getUser(uid) {
    return load().users.find((u) => u.id === uid) || null;
  },
  async listUsers() {
    return load().users.slice().reverse();
  },
  async setUserBlocked(uid, blocked) {
    const d = load();
    const u = d.users.find((x) => x.id === uid);
    if (!u) return null;
    u.blocked = !!blocked;
    // Блокировка выключает все подписки пользователя, разблокировка — включает.
    for (const s of d.subscriptions) {
      if (s.userId === uid) s.disabled = !!blocked;
    }
    if (blocked) d.sessions = d.sessions.filter((s) => s && s.userId !== uid);
    save();
    return u;
  },

  // ---- Sessions ----
  async createSession(session) {
    const d = load();
    d.sessions.push(session);
    save();
    return session;
  },
  async getSession(token) {
    if (!token) return null;
    return load().sessions.find((s) => s && s.token === token) || null;
  },
  async deleteSession(token) {
    const d = load();
    const i = d.sessions.findIndex((s) => s && s.token === token);
    if (i >= 0) { d.sessions.splice(i, 1); save(); }
  },

  // ---- Orders ----
  async createOrder(order) {
    const d = load();
    d.orders.push(order);
    save();
    return order;
  },
  async getOrder(oid) {
    return load().orders.find((o) => o.id === oid) || null;
  },
  async updateOrder(oid, patch) {
    const d = load();
    const o = d.orders.find((x) => x.id === oid);
    if (o) { Object.assign(o, patch); save(); }
    return o;
  },
  async listOrders() {
    return load().orders.slice().reverse();
  },

  // ---- Subscriptions ----
  async createSubscription(sub) {
    const d = load();
    d.subscriptions.push({ disabled: false, ...sub });
    save();
    return sub;
  },
  async getSubscription(token) {
    return load().subscriptions.find((s) => s.token === token) || null;
  },
  async updateSubscription(token, patch) {
    const d = load();
    const s = d.subscriptions.find((x) => x.token === token);
    if (s) { Object.assign(s, patch); save(); }
    return s;
  },
  async subscriptionsByUser(uid) {
    return load().subscriptions.filter((s) => s.userId === uid);
  },
  async subscriptionsByTelegram(tgId) {
    const user = await this.findUserByTelegram(tgId);
    if (!user) return [];
    return this.subscriptionsByUser(user.id);
  },
  async listSubscriptions() {
    return load().subscriptions.slice().reverse();
  },

  // ---- Aggregate stats ----
  async stats() {
    const d = load();
    const now = Date.now();
    const paidOrders = d.orders.filter((o) => o.status === 'paid');
    const revenueRub = paidOrders.reduce((s, o) => s + (o.amountRub || 0), 0);
    const activeSubs = d.subscriptions.filter((s) => !s.disabled && (s.expiresAt === 0 || s.expiresAt > now)).length;
    return {
      users: d.users.length,
      orders: d.orders.length,
      paidOrders: paidOrders.length,
      pendingOrders: d.orders.filter((o) => o.status === 'pending').length,
      subscriptions: d.subscriptions.length,
      activeSubscriptions: activeSubs,
      revenueRub,
    };
  },
};

/* =========================================================================
 * MySQL / MariaDB-хранилище (если задан DB_HOST). Видно в phpMyAdmin.
 * ======================================================================= */
function userRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email || null,
    name: r.name || '',
    telegramId: r.telegram_id || undefined,
    username: r.username || undefined,
    salt: r.salt || undefined,
    passwordHash: r.password_hash || undefined,
    blocked: !!r.blocked,
    createdAt: Number(r.created_at) || 0,
  };
}
function orderRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    planId: r.plan_id,
    userId: r.user_id || null,
    source: r.source || 'web',
    contact: parseJSON(r.contact) || {},
    status: r.status,
    amountRub: r.amount_rub,
    amountStars: r.amount_stars,
    createdAt: Number(r.created_at) || 0,
    paidAt: r.paid_at != null ? Number(r.paid_at) : null,
    payment: parseJSON(r.payment),
    subscriptionToken: r.subscription_token || null,
  };
}
function subRow(r) {
  if (!r) return null;
  return {
    token: r.token,
    orderId: r.order_id || null,
    userId: r.user_id || null,
    planId: r.plan_id,
    planName: r.plan_name,
    email: r.email,
    clientId: r.client_id,
    subId: r.sub_id,
    link: r.link,
    subUrl: r.sub_url,
    createdAt: Number(r.created_at) || 0,
    expiresAt: Number(r.expires_at) || 0,
    devices: r.devices,
    trafficGb: r.traffic_gb,
    mock: !!r.mock,
    disabled: !!r.disabled,
  };
}

function makeMysqlBackend() {
  let pool = null;

  async function q(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
  }
  async function one(sql, params = []) {
    const rows = await q(sql, params);
    return rows[0] || null;
  }

  return {
    async init() {
      const mysql = (await import('mysql2/promise')).default;
      pool = mysql.createPool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.name,
        connectionLimit: config.db.connectionLimit,
        charset: 'utf8mb4_unicode_ci',
        namedPlaceholders: false,
      });
      await q(`CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) NULL,
        name VARCHAR(255) NULL,
        telegram_id VARCHAR(64) NULL,
        username VARCHAR(255) NULL,
        salt VARCHAR(255) NULL,
        password_hash TEXT NULL,
        blocked TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT 0,
        UNIQUE KEY uq_users_email (email),
        KEY idx_users_tg (telegram_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await q(`CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(128) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        created_at BIGINT NOT NULL DEFAULT 0,
        KEY idx_sessions_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await q(`CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(64) PRIMARY KEY,
        plan_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NULL,
        source VARCHAR(32) NULL,
        contact JSON NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        amount_rub INT NOT NULL DEFAULT 0,
        amount_stars INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT 0,
        paid_at BIGINT NULL,
        payment JSON NULL,
        subscription_token VARCHAR(64) NULL,
        KEY idx_orders_user (user_id),
        KEY idx_orders_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await q(`CREATE TABLE IF NOT EXISTS subscriptions (
        token VARCHAR(64) PRIMARY KEY,
        order_id VARCHAR(64) NULL,
        user_id VARCHAR(64) NULL,
        plan_id VARCHAR(64) NULL,
        plan_name VARCHAR(255) NULL,
        email VARCHAR(255) NULL,
        client_id VARCHAR(128) NULL,
        sub_id VARCHAR(128) NULL,
        link TEXT NULL,
        sub_url TEXT NULL,
        created_at BIGINT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL DEFAULT 0,
        devices INT NOT NULL DEFAULT 0,
        traffic_gb INT NOT NULL DEFAULT 0,
        mock TINYINT(1) NOT NULL DEFAULT 0,
        disabled TINYINT(1) NOT NULL DEFAULT 0,
        KEY idx_subs_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    },

    // ---- Users ----
    async upsertUser(user) {
      const existing = user.id ? userRow(await one('SELECT * FROM users WHERE id=?', [user.id])) : null;
      const u = { blocked: false, name: '', createdAt: Date.now(), ...(existing || {}), ...user };
      await q(
        `INSERT INTO users (id, email, name, telegram_id, username, salt, password_hash, blocked, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name), telegram_id=VALUES(telegram_id),
           username=VALUES(username), salt=VALUES(salt), password_hash=VALUES(password_hash),
           blocked=VALUES(blocked), created_at=VALUES(created_at)`,
        [u.id, u.email || null, u.name || '', u.telegramId || null, u.username || null,
         u.salt || null, u.passwordHash || null, u.blocked ? 1 : 0, u.createdAt],
      );
      return userRow(await one('SELECT * FROM users WHERE id=?', [u.id]));
    },
    async findUserByTelegram(tgId) {
      return userRow(await one('SELECT * FROM users WHERE telegram_id=?', [String(tgId)]));
    },
    async findUserByEmail(email) {
      const e = String(email || '').trim().toLowerCase();
      return userRow(await one('SELECT * FROM users WHERE LOWER(email)=?', [e]));
    },
    async getUser(uid) {
      return userRow(await one('SELECT * FROM users WHERE id=?', [uid]));
    },
    async listUsers() {
      return (await q('SELECT * FROM users ORDER BY created_at DESC')).map(userRow);
    },
    async setUserBlocked(uid, blocked) {
      const b = blocked ? 1 : 0;
      await q('UPDATE users SET blocked=? WHERE id=?', [b, uid]);
      await q('UPDATE subscriptions SET disabled=? WHERE user_id=?', [b, uid]);
      if (blocked) await q('DELETE FROM sessions WHERE user_id=?', [uid]);
      return this.getUser(uid);
    },

    // ---- Sessions ----
    async createSession(session) {
      await q('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)',
        [session.token, session.userId, session.createdAt]);
      return session;
    },
    async getSession(token) {
      if (!token) return null;
      const r = await one('SELECT * FROM sessions WHERE token=?', [token]);
      return r ? { token: r.token, userId: r.user_id, createdAt: Number(r.created_at) } : null;
    },
    async deleteSession(token) {
      await q('DELETE FROM sessions WHERE token=?', [token]);
    },

    // ---- Orders ----
    async createOrder(order) {
      await q(
        `INSERT INTO orders (id, plan_id, user_id, source, contact, status, amount_rub, amount_stars, created_at, paid_at, payment, subscription_token)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [order.id, order.planId, order.userId || null, order.source || 'web',
         JSON.stringify(order.contact || {}), order.status || 'pending',
         order.amountRub || 0, order.amountStars || 0, order.createdAt,
         order.paidAt || null, order.payment ? JSON.stringify(order.payment) : null,
         order.subscriptionToken || null],
      );
      return order;
    },
    async getOrder(oid) {
      return orderRow(await one('SELECT * FROM orders WHERE id=?', [oid]));
    },
    async updateOrder(oid, patch) {
      const cur = await this.getOrder(oid);
      if (!cur) return null;
      const o = { ...cur, ...patch };
      await q(
        `UPDATE orders SET plan_id=?, user_id=?, source=?, contact=?, status=?, amount_rub=?,
           amount_stars=?, paid_at=?, payment=?, subscription_token=? WHERE id=?`,
        [o.planId, o.userId || null, o.source || 'web', JSON.stringify(o.contact || {}),
         o.status, o.amountRub || 0, o.amountStars || 0, o.paidAt || null,
         o.payment ? JSON.stringify(o.payment) : null, o.subscriptionToken || null, oid],
      );
      return o;
    },
    async listOrders() {
      return (await q('SELECT * FROM orders ORDER BY created_at DESC')).map(orderRow);
    },

    // ---- Subscriptions ----
    async createSubscription(sub) {
      await q(
        `INSERT INTO subscriptions (token, order_id, user_id, plan_id, plan_name, email, client_id, sub_id,
           link, sub_url, created_at, expires_at, devices, traffic_gb, mock, disabled)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [sub.token, sub.orderId || null, sub.userId || null, sub.planId, sub.planName, sub.email,
         sub.clientId || null, sub.subId || null, sub.link || null, sub.subUrl || null,
         sub.createdAt, sub.expiresAt || 0, sub.devices || 0, sub.trafficGb || 0,
         sub.mock ? 1 : 0, sub.disabled ? 1 : 0],
      );
      return sub;
    },
    async getSubscription(token) {
      return subRow(await one('SELECT * FROM subscriptions WHERE token=?', [token]));
    },
    async updateSubscription(token, patch) {
      const cur = await this.getSubscription(token);
      if (!cur) return null;
      const s = { ...cur, ...patch };
      await q(
        `UPDATE subscriptions SET order_id=?, user_id=?, plan_id=?, plan_name=?, email=?, client_id=?,
           sub_id=?, link=?, sub_url=?, expires_at=?, devices=?, traffic_gb=?, mock=?, disabled=? WHERE token=?`,
        [s.orderId || null, s.userId || null, s.planId, s.planName, s.email, s.clientId || null,
         s.subId || null, s.link || null, s.subUrl || null, s.expiresAt || 0, s.devices || 0,
         s.trafficGb || 0, s.mock ? 1 : 0, s.disabled ? 1 : 0, token],
      );
      return s;
    },
    async subscriptionsByUser(uid) {
      return (await q('SELECT * FROM subscriptions WHERE user_id=? ORDER BY created_at DESC', [uid])).map(subRow);
    },
    async subscriptionsByTelegram(tgId) {
      const user = await this.findUserByTelegram(tgId);
      if (!user) return [];
      return this.subscriptionsByUser(user.id);
    },
    async listSubscriptions() {
      return (await q('SELECT * FROM subscriptions ORDER BY created_at DESC')).map(subRow);
    },

    // ---- Aggregate stats ----
    async stats() {
      const now = Date.now();
      const users = Number((await one('SELECT COUNT(*) c FROM users')).c);
      const orders = Number((await one('SELECT COUNT(*) c FROM orders')).c);
      const paidOrders = Number((await one("SELECT COUNT(*) c FROM orders WHERE status='paid'")).c);
      const pendingOrders = Number((await one("SELECT COUNT(*) c FROM orders WHERE status='pending'")).c);
      const subscriptions = Number((await one('SELECT COUNT(*) c FROM subscriptions')).c);
      const activeSubscriptions = Number((await one(
        'SELECT COUNT(*) c FROM subscriptions WHERE disabled=0 AND (expires_at=0 OR expires_at>?)', [now])).c);
      const revenueRub = Number((await one("SELECT COALESCE(SUM(amount_rub),0) s FROM orders WHERE status='paid'")).s);
      return { users, orders, paidOrders, pendingOrders, subscriptions, activeSubscriptions, revenueRub };
    },
  };
}

export const db = isDbMysql ? makeMysqlBackend() : jsonBackend;

// Инициализация хранилища (создание таблиц для MySQL / каталога для JSON).
export async function initStore() {
  await db.init();
}
