(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const KEY_STORE = 'vibevpn-admin-key';

  const getKey = () => sessionStorage.getItem(KEY_STORE) || '';
  const setKey = (k) => sessionStorage.setItem(KEY_STORE, k);
  const clearKey = () => sessionStorage.removeItem(KEY_STORE);

  async function adminApi(path, opts = {}) {
    const res = await fetch('/api' + path, {
      ...opts,
      headers: { 'x-admin-key': getKey(), ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { const e = new Error('unauthorized'); e.unauthorized = true; throw e; }
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }

  let toastTimer;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2600); }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString('ru-RU') : '—');
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('ru-RU') : 'бессрочно');

  let currentTab = 'orders';

  /* ---------- Auth gate ---------- */
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#adminKey').value.trim();
    if (!key) return;
    setKey(key);
    try {
      await adminApi('/admin/auth', { method: 'POST' });
      enterDashboard();
    } catch (err) {
      clearKey();
      $('#loginError').textContent = err.unauthorized ? 'Неверный ключ администратора.' : err.message;
    }
  });

  function enterDashboard() {
    $('#loginGate').hidden = true;
    $('#dashboard').hidden = false;
    refreshAll();
  }

  function toLogin(msg) {
    clearKey();
    $('#dashboard').hidden = true;
    $('#loginGate').hidden = false;
    if (msg) $('#loginError').textContent = msg;
  }

  $('#adminLogout').addEventListener('click', () => toLogin(''));
  $('#refreshBtn').addEventListener('click', refreshAll);
  $$('#adminTabs .tab').forEach((t) => t.addEventListener('click', () => {
    currentTab = t.dataset.tab;
    $$('#adminTabs .tab').forEach((x) => x.classList.toggle('is-active', x === t));
    loadTable();
  }));

  /* ---------- Data ---------- */
  async function refreshAll() {
    try {
      await Promise.all([loadStats(), loadTable()]);
    } catch (err) { if (err.unauthorized) toLogin('Сессия истекла, войдите снова.'); else toast(err.message); }
  }

  async function loadStats() {
    const s = await adminApi('/admin/stats');
    const cards = [
      { b: s.users, s: 'Пользователей' },
      { b: s.paidOrders, s: 'Оплачено заказов' },
      { b: s.pendingOrders, s: 'Ожидают оплаты' },
      { b: s.activeSubscriptions, s: 'Активных подписок', accent: true },
      { b: s.revenueRub + ' ₽', s: 'Выручка', accent: true },
    ];
    $('#statsGrid').innerHTML = cards.map((c) => `<div class="stat-card ${c.accent ? 'stat-card--accent' : ''}"><b>${esc(c.b)}</b><span>${c.s}</span></div>`).join('');
  }

  async function loadTable() {
    const area = $('#tableArea');
    area.innerHTML = '<p class="co__hint">Загрузка…</p>';
    try {
      if (currentTab === 'orders') area.innerHTML = renderOrders(await adminApi('/admin/orders'));
      else if (currentTab === 'subscriptions') area.innerHTML = renderSubs(await adminApi('/admin/subscriptions'));
      else area.innerHTML = renderUsers(await adminApi('/admin/users'));
      wireActions();
    } catch (err) {
      if (err.unauthorized) return toLogin('Сессия истекла, войдите снова.');
      area.innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
    }
  }

  function table(head, rows) {
    if (!rows) return '<p class="admin-empty">Пусто</p>';
    return `<table class="admin-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderOrders(d) {
    const orders = d.orders || [];
    if (!orders.length) return '<p class="admin-empty">Заказов пока нет</p>';
    const rows = orders.map((o) => {
      const who = o.user?.email || o.contact?.email || (o.contact?.username ? '@' + o.contact.username : (o.contact?.telegramId || '—'));
      const status = o.status === 'paid'
        ? '<span class="badge badge--paid">оплачен</span>'
        : '<span class="badge badge--pending">ожидает</span>';
      const action = o.status === 'pending'
        ? `<button class="btn btn--ghost btn--sm" data-fulfill="${o.id}">Выдать</button>`
        : (o.subscriptionToken ? '<span class="mono">выдан</span>' : '—');
      return `<tr>
        <td class="mono">${esc(o.id)}</td>
        <td>${fmtDateTime(o.createdAt)}</td>
        <td>${esc(o.planName)}</td>
        <td>${o.amountRub} ₽</td>
        <td>${status}</td>
        <td>${esc(who)}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
    return table(['ID', 'Дата', 'Тариф', 'Сумма', 'Статус', 'Клиент', ''], rows);
  }

  function renderSubs(d) {
    const subs = d.subscriptions || [];
    if (!subs.length) return '<p class="admin-empty">Подписок пока нет</p>';
    const rows = subs.map((s) => `<tr>
      <td>${esc(s.planName)}</td>
      <td class="mono">${esc(s.email)}</td>
      <td>${fmtDateTime(s.createdAt)}</td>
      <td>${fmtDate(s.expiresAt)}</td>
      <td>${s.daysLeft != null ? s.daysLeft + ' дн.' : '∞'}</td>
      <td>${s.active ? '<span class="badge badge--on">активна</span>' : '<span class="badge badge--off">истекла</span>'}</td>
    </tr>`).join('');
    return table(['Тариф', 'Email клиента (3x-ui)', 'Создана', 'До', 'Осталось', 'Статус'], rows);
  }

  function renderUsers(d) {
    const users = d.users || [];
    if (!users.length) return '<p class="admin-empty">Пользователей пока нет</p>';
    const rows = users.map((u) => `<tr>
      <td>${esc(u.email || '—')}</td>
      <td>${u.telegramId ? '@' + esc(u.username || u.telegramId) : '—'}</td>
      <td>${fmtDateTime(u.createdAt)}</td>
      <td>${u.subscriptions}</td>
    </tr>`).join('');
    return table(['Email', 'Telegram', 'Регистрация', 'Подписок'], rows);
  }

  function wireActions() {
    $$('[data-fulfill]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = '…';
      try {
        await adminApi(`/admin/orders/${b.dataset.fulfill}/fulfill`, { method: 'POST' });
        toast('Подписка выдана');
        refreshAll();
      } catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Выдать'; }
    }));
  }

  /* ---------- Init ---------- */
  if (getKey()) {
    adminApi('/admin/auth', { method: 'POST' }).then(enterDashboard).catch(() => toLogin(''));
  }
})();
