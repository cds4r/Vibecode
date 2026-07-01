import express from 'express';
import { config, isPanelMock } from '../config.js';
import { plans, getPlan } from '../plans.js';
import { createOrder, fulfillOrder, subscriptionView, subscriptionSummary } from '../provision.js';
import { db } from '../store.js';
import { panelStatus } from '../xui.js';
import { register, login, logout, publicUser, authOptional, authRequired } from '../auth.js';

export function apiRouter(ctx = {}) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json({
      brand: config.brandName,
      allowMockPay: config.allowMockPay,
      panelMock: isPanelMock,
      botUsername: ctx.botUsername || null,
    });
  });

  router.get('/plans', (req, res) => res.json({ plans }));

  router.get('/status', async (req, res) => res.json(await panelStatus()));

  /* ===================== Auth ===================== */
  router.post('/auth/register', (req, res) => {
    try {
      const { email, password, name } = req.body || {};
      res.json(register({ email, password, name }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/auth/login', (req, res) => {
    try {
      const { email, password } = req.body || {};
      res.json(login({ email, password }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/auth/logout', authOptional, (req, res) => {
    logout(req.authToken);
    res.json({ ok: true });
  });

  router.get('/auth/me', authRequired, (req, res) => {
    const subs = db.subscriptionsByUser(req.user.id).map(subscriptionSummary);
    res.json({ user: publicUser(req.user), subscriptions: subs });
  });

  // Привязать анонимные подписки (по токенам из localStorage) к аккаунту.
  router.post('/auth/claim', authRequired, (req, res) => {
    const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
    let claimed = 0;
    for (const t of tokens) {
      const sub = db.getSubscription(t);
      if (sub && !sub.userId) {
        db.updateSubscription(t, { userId: req.user.id });
        if (sub.orderId) db.updateOrder(sub.orderId, { userId: req.user.id });
        claimed++;
      }
    }
    res.json({ claimed });
  });

  /* ===================== Checkout ===================== */
  router.post('/checkout', authOptional, async (req, res) => {
    try {
      const { planId, contact } = req.body || {};
      const plan = getPlan(planId);
      if (!plan) return res.status(400).json({ error: 'Тариф не найден' });

      const order = createOrder({
        planId,
        source: 'web',
        userId: req.user?.id || null,
        contact: contact || (req.user ? { email: req.user.email } : {}),
      });

      if (plan.priceRub === 0) {
        const sub = await fulfillOrder(order.id, { method: 'free' });
        return res.json({ orderId: order.id, free: true, token: sub.token });
      }
      res.json({ orderId: order.id, free: false, amountRub: plan.priceRub, allowMockPay: config.allowMockPay });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/orders/:id/confirm', async (req, res) => {
    if (!config.allowMockPay) return res.status(403).json({ error: 'Демо-оплата отключена. Настройте платёжного провайдера.' });
    try {
      const order = db.getOrder(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      const sub = await fulfillOrder(order.id, { method: 'mock' });
      res.json({ token: sub.token });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/subscription/:token', async (req, res) => {
    try {
      const view = await subscriptionView(req.params.token);
      if (!view) return res.status(404).json({ error: 'Подписка не найдена' });
      res.json(view);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ===================== Admin ===================== */
  const requireAdmin = (req, res, next) => {
    if (!config.adminKey || req.get('x-admin-key') !== config.adminKey) {
      return res.status(401).json({ error: 'Не авторизовано' });
    }
    next();
  };

  // Проверка ключа (для формы входа в админку)
  router.post('/admin/auth', requireAdmin, (req, res) => res.json({ ok: true }));

  router.get('/admin/stats', requireAdmin, (req, res) => res.json(db.stats()));

  router.get('/admin/orders', requireAdmin, (req, res) => {
    const orders = db.listOrders().map((o) => ({
      ...o,
      planName: getPlan(o.planId)?.name || o.planId,
      user: o.userId ? publicUser(db.getUser(o.userId)) : null,
    }));
    res.json({ orders });
  });

  router.get('/admin/subscriptions', requireAdmin, (req, res) => {
    res.json({ subscriptions: db.listSubscriptions().map(subscriptionSummary) });
  });

  router.get('/admin/users', requireAdmin, (req, res) => {
    const users = db.listUsers().map((u) => ({
      ...publicUser(u),
      telegramId: u.telegramId || null,
      username: u.username || null,
      subscriptions: db.subscriptionsByUser(u.id).length,
    }));
    res.json({ users });
  });

  router.post('/admin/orders/:id/fulfill', requireAdmin, async (req, res) => {
    try {
      const sub = await fulfillOrder(req.params.id, { method: 'admin' });
      res.json({ token: sub.token });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
