import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const empty = { users: [], orders: [], subscriptions: [], sessions: [] };

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
}

let data = null;

function load() {
  if (data) return data;
  ensure();
  try {
    data = { ...empty, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    data = { ...empty };
  }
  // Защита от повреждённых записей (null/дырки в массивах).
  for (const k of ['users', 'orders', 'subscriptions', 'sessions']) {
    data[k] = Array.isArray(data[k]) ? data[k].filter(Boolean) : [];
  }
  return data;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ensure();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  }, 50);
}

export function id(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const db = {
  get raw() { return load(); },

  // ---- Users ----
  upsertUser(user) {
    const d = load();
    const idx = d.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) d.users[idx] = { ...d.users[idx], ...user };
    else d.users.push(user);
    save();
    return d.users.find((u) => u.id === user.id);
  },
  findUserByTelegram(tgId) {
    return load().users.find((u) => u.telegramId === String(tgId)) || null;
  },
  findUserByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return load().users.find((u) => (u.email || '').toLowerCase() === e) || null;
  },
  getUser(uid) {
    return load().users.find((u) => u.id === uid) || null;
  },
  listUsers() {
    return load().users.slice().reverse();
  },

  // ---- Sessions ----
  createSession(session) {
    const d = load();
    d.sessions.push(session);
    save();
    return session;
  },
  getSession(token) {
    if (!token) return null;
    return load().sessions.find((s) => s && s.token === token) || null;
  },
  deleteSession(token) {
    const d = load();
    const i = d.sessions.findIndex((s) => s && s.token === token);
    if (i >= 0) { d.sessions.splice(i, 1); save(); }
  },

  // ---- Orders ----
  createOrder(order) {
    const d = load();
    d.orders.push(order);
    save();
    return order;
  },
  getOrder(oid) {
    return load().orders.find((o) => o.id === oid) || null;
  },
  updateOrder(oid, patch) {
    const d = load();
    const o = d.orders.find((x) => x.id === oid);
    if (o) { Object.assign(o, patch); save(); }
    return o;
  },
  listOrders() {
    return load().orders.slice().reverse();
  },

  // ---- Subscriptions ----
  createSubscription(sub) {
    const d = load();
    d.subscriptions.push(sub);
    save();
    return sub;
  },
  getSubscription(token) {
    return load().subscriptions.find((s) => s.token === token) || null;
  },
  updateSubscription(token, patch) {
    const d = load();
    const s = d.subscriptions.find((x) => x.token === token);
    if (s) { Object.assign(s, patch); save(); }
    return s;
  },
  subscriptionsByUser(uid) {
    return load().subscriptions.filter((s) => s.userId === uid);
  },
  subscriptionsByTelegram(tgId) {
    const user = this.findUserByTelegram(tgId);
    if (!user) return [];
    return this.subscriptionsByUser(user.id);
  },
  listSubscriptions() {
    return load().subscriptions.slice().reverse();
  },

  // ---- Aggregate stats ----
  stats() {
    const d = load();
    const now = Date.now();
    const paidOrders = d.orders.filter((o) => o.status === 'paid');
    const revenueRub = paidOrders.reduce((s, o) => s + (o.amountRub || 0), 0);
    const activeSubs = d.subscriptions.filter((s) => s.expiresAt === 0 || s.expiresAt > now).length;
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
