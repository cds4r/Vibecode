import express from 'express';
import { config, isPanelMock } from '../config.js';
import { plans, getPlan } from '../plans.js';
import { createOrder, fulfillOrder, subscriptionView, subscriptionSummary } from '../provision.js';
import { db } from '../store.js';
import { panelStatus, setClientEnabled } from '../xui.js';
import { register, login, logout, publicUser, authOptional, authRequired, userFromToken, isAdminEmail } from '../auth.js';

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
  router.post('/auth/register', async (req, res) => {
    try {
      const { email, password, name } = req.body || {};
      res.json(await register({ email, password, name }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      res.json(await login({ email, password }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/auth/logout', authOptional, async (req, res) => {
    await logout(req.authToken);
    res.json({ ok: true });
  });

  router.get('/auth/me', authRequired, async (req, res) => {
    const list = await db.subscriptionsByUser(req.user.id);
    res.json({ user: publicUser(req.user), subscriptions: list.map(subscriptionSummary) });
  });

  // Привязать анонимные подписки (по токенам из localStorage) к аккаунту.
  router.post('/auth/claim', authRequired, async (req, res) => {
    const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
    let claimed = 0;
    for (const t of tokens) {
      const sub = await db.getSubscription(t);
      if (sub && !sub.userId) {
        await db.updateSubscription(t, { userId: req.user.id });
        if (sub.orderId) await db.updateOrder(sub.orderId, { userId: req.user.id });
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

      const isTrial = plan.priceRub === 0;
      // Пробный тариф — только для авторизованных и не более одного на аккаунт.
      if (isTrial) {
        if (!req.user) {
          return res.status(401).json({ error: 'Войдите в аккаунт, чтобы получить пробную подписку' });
        }
        const mine = await db.subscriptionsByUser(req.user.id);
        if (mine.some((s) => s.planId === plan.id)) {
          return res.status(409).json({ error: 'Пробная подписка уже была активирована на этом аккаунте' });
        }
      }

      const order = await createOrder({
        planId,
        source: 'web',
        userId: req.user?.id || null,
        contact: contact || (req.user ? { email: req.user.email } : {}),
      });

      if (isTrial) {
        const sub = await fulfillOrder(order.id, { method: 'free' });
        return res.json({ orderId: order.id, free: true, token: sub.token });
      }
      res.json({ orderId: order.id, free: false, amountRub: plan.priceRub, allowMockPay: config.allowMockPay });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/orders/:id/confirm', async (req, res) => {
    if (!config.allowMockPay) return res.status(403).json({ error: 'Демо-оплата отключена. Настройте платёжного провайдера.' });
    try {
      const order = await db.getOrder(req.params.id);
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
  const requireAdmin = async (req, res, next) => {
    // 1) По ключу администратора
    const key = req.get('x-admin-key');
    if (config.adminKey && key === config.adminKey) return next();
    // 2) По аккаунту из «белого списка» админ-почт (Bearer-токен сессии)
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        const user = await userFromToken(token);
        if (user && isAdminEmail(user.email)) return next();
      } catch { /* ignore */ }
    }
    return res.status(401).json({ error: 'Не авторизовано' });
  };

  // Проверка ключа (для формы входа в админку)
  router.post('/admin/auth', requireAdmin, (req, res) => res.json({ ok: true }));

  router.get('/admin/stats', requireAdmin, async (req, res) => res.json(await db.stats()));

  router.get('/admin/orders', requireAdmin, async (req, res) => {
    const list = await db.listOrders();
    const orders = await Promise.all(list.map(async (o) => ({
      ...o,
      planName: getPlan(o.planId)?.name || o.planId,
      user: o.userId ? publicUser(await db.getUser(o.userId)) : null,
    })));
    res.json({ orders });
  });

  router.get('/admin/subscriptions', requireAdmin, async (req, res) => {
    const list = await db.listSubscriptions();
    res.json({ subscriptions: list.map(subscriptionSummary) });
  });

  router.get('/admin/users', requireAdmin, async (req, res) => {
    const list = await db.listUsers();
    const users = await Promise.all(list.map(async (u) => ({
      ...publicUser(u),
      telegramId: u.telegramId || null,
      username: u.username || null,
      subscriptions: (await db.subscriptionsByUser(u.id)).length,
    })));
    res.json({ users });
  });

  router.post('/admin/orders/:id/fulfill', requireAdmin, async (req, res) => {
    try {
      const sub = await fulfillOrder(req.params.id, { method: 'admin' });
      res.json({ token: sub.token });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Блокировка / разблокировка пользователя. Блокировка отключает все его подписки
  // и завершает активные сессии; разблокировка снова включает подписки.
  router.post('/admin/users/:id/block', requireAdmin, async (req, res) => {
    try {
      const blocked = req.body?.blocked !== false;
      const user = await db.getUser(req.params.id);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      await db.setUserBlocked(req.params.id, blocked);
      // Отражаем состояние в панели 3x-ui (best-effort).
      const subs = await db.subscriptionsByUser(req.params.id);
      await Promise.all(subs.map((s) => setClientEnabled(s.email, !blocked)));
      res.json({ ok: true, blocked });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Включение / отключение конкретной подписки.
  router.post('/admin/subscriptions/:token/disable', requireAdmin, async (req, res) => {
    try {
      const disabled = req.body?.disabled !== false;
      const sub = await db.getSubscription(req.params.token);
      if (!sub) return res.status(404).json({ error: 'Подписка не найдена' });
      await db.updateSubscription(req.params.token, { disabled });
      await setClientEnabled(sub.email, !disabled);
      res.json({ ok: true, disabled });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
