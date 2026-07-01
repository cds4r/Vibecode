import QRCode from 'qrcode';
import { db, id } from './store.js';
import { getPlan, planDurationMs, planDurationDays } from './plans.js';
import { createClient, getClientTraffic, subscriptionUrl } from './xui.js';
import { config } from './config.js';

function slug() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Создаёт заказ.
 */
export function createOrder({ planId, userId, source = 'web', contact = {} }) {
  const plan = getPlan(planId);
  if (!plan) throw new Error('Тариф не найден');
  const order = {
    id: id('ord_'),
    planId,
    userId: userId || null,
    source,
    contact,
    status: 'pending',
    amountRub: plan.priceRub,
    amountStars: plan.priceStars,
    createdAt: Date.now(),
    paidAt: null,
    subscriptionToken: null,
  };
  db.createOrder(order);
  return order;
}

/**
 * Помечает заказ оплаченным и выдаёт подписку (создаёт клиента в 3x-ui).
 * Идемпотентно: повторный вызов вернёт уже созданную подписку.
 */
export async function fulfillOrder(orderId, payment = {}) {
  const order = db.getOrder(orderId);
  if (!order) throw new Error('Заказ не найден');
  if (order.status === 'paid' && order.subscriptionToken) {
    return db.getSubscription(order.subscriptionToken);
  }

  const plan = getPlan(order.planId);
  if (!plan) throw new Error('Тариф не найден');

  const brandSlug = (config.brandName || 'vpn').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'vpn';
  const email = `${plan.id}-${slug()}@${brandSlug}`;
  const expiryMs = planDurationMs(plan);
  const client = await createClient({
    email,
    expiryMs,
    trafficGb: plan.trafficGb,
    limitIp: plan.devices,
  });

  const token = id('sub_');
  const sub = {
    token,
    orderId: order.id,
    userId: order.userId,
    planId: plan.id,
    planName: plan.name,
    email,
    clientId: client.clientId,
    subId: client.subId,
    link: client.link,
    subUrl: subscriptionUrl(client.subId),
    createdAt: Date.now(),
    expiresAt: expiryMs ? Date.now() + expiryMs : 0,
    devices: plan.devices,
    trafficGb: plan.trafficGb,
    mock: !!client.mock,
  };
  db.createSubscription(sub);
  db.updateOrder(order.id, {
    status: 'paid',
    paidAt: Date.now(),
    payment,
    subscriptionToken: token,
  });
  return sub;
}

// Лёгкая сводка подписки (без QR и запроса трафика) — для списков.
export function subscriptionSummary(sub) {
  return {
    token: sub.token,
    planId: sub.planId,
    planName: sub.planName,
    email: sub.email,
    createdAt: sub.createdAt,
    expiresAt: sub.expiresAt,
    devices: sub.devices,
    trafficGb: sub.trafficGb,
    daysLeft: sub.expiresAt ? Math.max(0, Math.ceil((sub.expiresAt - Date.now()) / 86400000)) : null,
    active: sub.expiresAt === 0 || sub.expiresAt > Date.now(),
    mock: sub.mock,
  };
}

export async function subscriptionView(token) {
  const sub = db.getSubscription(token);
  if (!sub) return null;
  let usage = null;
  try {
    const t = await getClientTraffic(sub.email);
    if (t) {
      usage = {
        up: t.up || 0,
        down: t.down || 0,
        used: (t.up || 0) + (t.down || 0),
        enable: t.enable !== false,
      };
    }
  } catch { /* ignore */ }

  let qr = null;
  try { qr = await QRCode.toDataURL(sub.link, { margin: 1, width: 320 }); } catch { /* ignore */ }

  return {
    token: sub.token,
    planName: sub.planName,
    email: sub.email,
    link: sub.link,
    subUrl: sub.subUrl,
    createdAt: sub.createdAt,
    expiresAt: sub.expiresAt,
    devices: sub.devices,
    trafficGb: sub.trafficGb,
    daysLeft: sub.expiresAt ? Math.max(0, Math.ceil((sub.expiresAt - Date.now()) / 86400000)) : null,
    active: sub.expiresAt === 0 || sub.expiresAt > Date.now(),
    mock: sub.mock,
    usage,
    qr,
  };
}

export { planDurationDays };
