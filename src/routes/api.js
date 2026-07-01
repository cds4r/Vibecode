import express from 'express';
import { config, isPanelMock } from '../config.js';
import { plans, getPlan } from '../plans.js';
import { createOrder, fulfillOrder, subscriptionView } from '../provision.js';
import { db } from '../store.js';
import { panelStatus } from '../xui.js';

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

  router.get('/plans', (req, res) => {
    res.json({ plans });
  });

  router.get('/status', async (req, res) => {
    res.json(await panelStatus());
  });

  // Создать заказ. Для бесплатного тарифа сразу выдаём подписку.
  router.post('/checkout', async (req, res) => {
    try {
      const { planId, contact } = req.body || {};
      const plan = getPlan(planId);
      if (!plan) return res.status(400).json({ error: 'Тариф не найден' });

      const order = createOrder({ planId, source: 'web', contact: contact || {} });

      if (plan.priceRub === 0) {
        const sub = await fulfillOrder(order.id, { method: 'free' });
        return res.json({ orderId: order.id, free: true, token: sub.token });
      }

      res.json({
        orderId: order.id,
        free: false,
        amountRub: plan.priceRub,
        allowMockPay: config.allowMockPay,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Демо-подтверждение оплаты (только если ALLOW_MOCK_PAY=true).
  router.post('/orders/:id/confirm', async (req, res) => {
    if (!config.allowMockPay) {
      return res.status(403).json({ error: 'Демо-оплата отключена. Настройте платёжного провайдера.' });
    }
    try {
      const order = db.getOrder(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      const sub = await fulfillOrder(order.id, { method: 'mock' });
      res.json({ token: sub.token });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/subscription/:token', async (req, res) => {
    try {
      const view = await subscriptionView(req.params.token);
      if (!view) return res.status(404).json({ error: 'Подписка не найдена' });
      res.json(view);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Админ ----
  const requireAdmin = (req, res, next) => {
    if (!config.adminKey || req.get('x-admin-key') !== config.adminKey) {
      return res.status(401).json({ error: 'Не авторизовано' });
    }
    next();
  };

  router.get('/admin/orders', requireAdmin, (req, res) => {
    res.json({ orders: db.listOrders() });
  });

  router.post('/admin/orders/:id/fulfill', requireAdmin, async (req, res) => {
    try {
      const sub = await fulfillOrder(req.params.id, { method: 'admin' });
      res.json({ token: sub.token });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
