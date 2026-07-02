(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const KEY_STORE = 'vibevpn-admin-key';
  const AUTH_KEY = 'vibevpn-auth'; // общий с основным сайтом ключ сессии

  const getKey = () => sessionStorage.getItem(KEY_STORE) || '';
  const setKey = (k) => sessionStorage.setItem(KEY_STORE, k);
  const clearKey = () => sessionStorage.removeItem(KEY_STORE);
  const getUserToken = () => { try { return (JSON.parse(localStorage.getItem(AUTH_KEY)) || {}).token || ''; } catch { return ''; } };
  const setUserAuth = (v) => localStorage.setItem(AUTH_KEY, JSON.stringify(v));

  async function adminApi(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const key = getKey(); if (key) headers['x-admin-key'] = key;
    const ut = getUserToken(); if (ut) headers['Authorization'] = 'Bearer ' + ut;
    const res = await fetch('/api' + path, { ...opts, headers });
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
  let loginMode = 'account';
  $$('#loginTabs .tab').forEach((t) => t.addEventListener('click', () => {
    loginMode = t.dataset.mode;
    $$('#loginTabs .tab').forEach((x) => x.classList.toggle('is-active', x === t));
    $('#accountFields').hidden = loginMode !== 'account';
    $('#keyFields').hidden = loginMode !== 'key';
    $('#loginError').textContent = '';
  }));

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      if (loginMode === 'key') {
        const key = $('#adminKey').value.trim();
        if (!key) return;
        setKey(key);
        await adminApi('/admin/auth', { method: 'POST' });
      } else {
        const email = $('#adminEmail').value.trim();
        const password = $('#adminPass').value;
        if (!email || !password) return;
        const r = await fetch('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Не удалось войти');
        setUserAuth({ token: d.token, user: d.user });
        await adminApi('/admin/auth', { method: 'POST' });
      }
      enterDashboard();
    } catch (err) {
      if (loginMode === 'key') clearKey();
      $('#loginError').textContent = err.unauthorized
        ? (loginMode === 'key' ? 'Неверный ключ администратора.' : 'Этот аккаунт не является администратором.')
        : err.message;
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

  function subStatusBadge(s) {
    if (s.disabled) return '<span class="badge badge--off">отключена</span>';
    if (s.active) return '<span class="badge badge--on">активна</span>';
    return '<span class="badge badge--pending">истекла</span>';
  }

  function renderSubs(d) {
    const subs = d.subscriptions || [];
    if (!subs.length) return '<p class="admin-empty">Подписок пока нет</p>';
    const rows = subs.map((s) => {
      const action = s.disabled
        ? `<button class="btn btn--ghost btn--sm" data-enable-sub="${esc(s.token)}">Включить</button>`
        : `<button class="btn btn--ghost btn--sm btn--danger" data-disable-sub="${esc(s.token)}">Отключить</button>`;
      return `<tr>
        <td>${esc(s.planName)}</td>
        <td class="mono">${esc(s.email)}</td>
        <td>${fmtDateTime(s.createdAt)}</td>
        <td>${fmtDate(s.expiresAt)}</td>
        <td>${s.daysLeft != null ? s.daysLeft + ' дн.' : '∞'}</td>
        <td>${subStatusBadge(s)}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
    return table(['Тариф', 'Email клиента (3x-ui)', 'Создана', 'До', 'Осталось', 'Статус', ''], rows);
  }

  function renderUsers(d) {
    const users = d.users || [];
    if (!users.length) return '<p class="admin-empty">Пользователей пока нет</p>';
    const rows = users.map((u) => {
      const status = u.blocked
        ? '<span class="badge badge--off">заблокирован</span>'
        : '<span class="badge badge--on">активен</span>';
      const action = u.blocked
        ? `<button class="btn btn--ghost btn--sm" data-unblock="${esc(u.id)}">Разблокировать</button>`
        : `<button class="btn btn--ghost btn--sm btn--danger" data-block="${esc(u.id)}">Заблокировать</button>`;
      return `<tr>
        <td>${esc(u.email || '—')}</td>
        <td>${u.telegramId ? '@' + esc(u.username || u.telegramId) : '—'}</td>
        <td>${fmtDateTime(u.createdAt)}</td>
        <td>${u.subscriptions}</td>
        <td>${status}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
    return table(['Email', 'Telegram', 'Регистрация', 'Подписок', 'Статус', ''], rows);
  }

  // Универсальный обработчик кнопок-действий с подтверждением и восстановлением подписи.
  function bindAction(selector, buildReq, confirmMsg) {
    $$(selector).forEach((b) => b.addEventListener('click', async () => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      const orig = b.textContent;
      b.disabled = true; b.textContent = '…';
      try {
        const { path, opts, done } = buildReq(b);
        await adminApi(path, opts);
        toast(done);
        refreshAll();
      } catch (err) { toast(err.message); b.disabled = false; b.textContent = orig; }
    }));
  }

  function wireActions() {
    bindAction('[data-fulfill]', (b) => ({
      path: `/admin/orders/${b.dataset.fulfill}/fulfill`, opts: { method: 'POST' }, done: 'Подписка выдана',
    }));
    const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    bindAction('[data-disable-sub]', (b) => ({
      path: `/admin/subscriptions/${b.dataset.disableSub}/disable`, opts: post({ disabled: true }), done: 'Подписка отключена',
    }), 'Отключить эту подписку? Клиент потеряет доступ.');
    bindAction('[data-enable-sub]', (b) => ({
      path: `/admin/subscriptions/${b.dataset.enableSub}/disable`, opts: post({ disabled: false }), done: 'Подписка включена',
    }));
    bindAction('[data-block]', (b) => ({
      path: `/admin/users/${b.dataset.block}/block`, opts: post({ blocked: true }), done: 'Пользователь заблокирован',
    }), 'Заблокировать пользователя? Его сессии завершатся, а подписки отключатся.');
    bindAction('[data-unblock]', (b) => ({
      path: `/admin/users/${b.dataset.unblock}/block`, opts: post({ blocked: false }), done: 'Пользователь разблокирован',
    }));
  }

  /* ---------- Init ---------- */
  if (getKey() || getUserToken()) {
    adminApi('/admin/auth', { method: 'POST' }).then(enterDashboard).catch(() => toLogin(''));
  }
})();
