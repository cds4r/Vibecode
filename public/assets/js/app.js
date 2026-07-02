(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const TOKENS_KEY = 'vibevpn-tokens';
  const AUTH_KEY = 'vibevpn-auth';
  const getTokens = () => { try { return JSON.parse(localStorage.getItem(TOKENS_KEY)) || []; } catch { return []; } };
  const saveToken = (t) => { const a = getTokens(); if (!a.includes(t)) { a.push(t); localStorage.setItem(TOKENS_KEY, JSON.stringify(a)); } };
  const getAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; } };
  const setAuth = (v) => localStorage.setItem(AUTH_KEY, JSON.stringify(v));
  const clearAuth = () => localStorage.removeItem(AUTH_KEY);
  const authHeaders = () => { const a = getAuth(); return a?.token ? { Authorization: 'Bearer ' + a.token } : {}; };

  const api = (path, opts = {}) => fetch('/api' + path, opts).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  });

  let appConfig = { brand: 'VibeVPN', allowMockPay: true, panelMock: true, botUsername: null };
  let plans = [];

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('ru-RU') : 'бессрочно');
  const priceLabel = (p) => (p.priceRub === 0 ? 'Бесплатно' : `${p.priceRub} ₽`);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Features ---------- */
  const FEATURES = [
    { t: 'Без логов', d: 'Мы не храним историю посещений и не передаём данные третьим лицам.', i: 'M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z' },
    { t: 'Высокая скорость', d: 'Тонкие серверы и современные протоколы — до 1 Гбит/с без просадок.', i: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z' },
    { t: 'VLESS + Reality', d: 'Обходит блокировки там, где обычные VPN не работают.', i: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20' },
    { t: 'Все устройства', d: 'Android, iOS, Windows, macOS, роутеры. До 10 устройств.', i: 'M4 4h16v12H4zM2 20h20' },
    { t: 'Локации по миру', d: 'Серверы в разных странах — выбирайте оптимальный маршрут.', i: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 2c3 3 3 17 0 20M2 12h20' },
    { t: 'Поддержка 24/7', d: 'Поможем подключиться и решим любой вопрос в Telegram.', i: 'M21 15a4 4 0 01-4 4H8l-5 3V6a4 4 0 014-4h9a4 4 0 014 4z' },
  ];
  function renderFeatures() {
    $('#features-grid').innerHTML = FEATURES.map((f) => `
      <article class="feature">
        <div class="feature__icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${f.i}"/></svg></div>
        <h3>${f.t}</h3><p>${f.d}</p>
      </article>`).join('');
  }

  /* ---------- Plans ---------- */
  function renderPlans() {
    const grid = $('#plans-grid');
    if (!plans.length) { grid.innerHTML = '<div class="plans__loading">Тарифы недоступны</div>'; return; }
    grid.innerHTML = plans.map((p) => `
      <article class="plan ${p.highlight ? 'plan--hot' : ''}">
        ${p.badge ? `<span class="plan__badge">${esc(p.badge)}</span>` : ''}
        <h3 class="plan__name">${esc(p.name)}</h3>
        <div class="plan__price"><b>${priceLabel(p)}</b> ${p.priceRub ? '<span>/ период</span>' : ''}</div>
        <p class="plan__desc">${esc(p.description || '')}</p>
        <ul class="plan__list">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <button class="btn ${p.highlight ? 'btn--primary' : 'btn--ghost'} btn--block" data-buy="${p.id}">
          ${p.priceRub === 0 ? 'Попробовать бесплатно' : 'Купить'}
        </button>
      </article>`).join('');
    $$('[data-buy]', grid).forEach((b) => b.addEventListener('click', () => startCheckout(b.dataset.buy)));
  }

  /* ---------- Checkout ---------- */
  async function startCheckout(planId) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    // Пробный тариф требует аккаунта (1 на пользователя).
    if (plan.priceRub === 0 && !getAuth()) {
      toast('Создайте аккаунт, чтобы получить пробную подписку');
      return openCabinet('register');
    }
    try {
      const res = await api('/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ planId }),
      });
      if (res.free && res.token) { saveToken(res.token); return showSubscription(res.token); }
      renderCheckout(plan, res.orderId, res.allowMockPay);
    } catch (e) { toast(e.message); }
  }

  function renderCheckout(plan, orderId, allowMockPay) {
    const body = $('#checkoutBody');
    const tg = appConfig.botUsername
      ? `<a class="btn btn--primary btn--block" href="https://t.me/${appConfig.botUsername}" target="_blank" rel="noopener">Оплатить в Telegram-боте</a>` : '';
    const mock = allowMockPay
      ? `<button class="btn ${tg ? 'btn--ghost' : 'btn--primary'} btn--block" id="mockPayBtn">Оплатить (демо-режим)</button>` : '';
    const noPay = !tg && !mock
      ? `<p class="co__hint">Онлайн-оплата ещё не настроена администратором. Свяжитесь с поддержкой для оплаты.</p>` : '';
    body.innerHTML = `
      <div class="co__plan">${esc(plan.name)}</div>
      <div class="co__price">${plan.priceRub} ₽ <span>/ период</span></div>
      <ul class="co__list">${plan.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <div class="co__pay">${tg}${tg && mock ? '<div class="co__or">или</div>' : ''}${mock}${noPay}</div>
      <p class="co__hint">Ключ выдаётся автоматически сразу после оплаты.${getAuth() ? '' : ' Войдите в кабинет, чтобы подписки хранились в аккаунте.'}</p>`;
    if (allowMockPay) {
      $('#mockPayBtn').addEventListener('click', async () => {
        const btn = $('#mockPayBtn'); btn.disabled = true; btn.textContent = 'Обработка…';
        try {
          const { token } = await api(`/orders/${orderId}/confirm`, { method: 'POST', headers: authHeaders() });
          saveToken(token); closeModal($('#checkoutModal')); showSubscription(token);
        } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Оплатить (демо-режим)'; }
      });
    }
    openModal($('#checkoutModal'));
  }

  /* ---------- Subscription view ---------- */
  async function showSubscription(token) {
    const body = $('#subBody');
    body.innerHTML = '<p class="co__hint">Загрузка…</p>';
    openModal($('#subModal'));
    try {
      const s = await api('/subscription/' + token);
      body.innerHTML = subHtml(s);
      wireCopy(body);
    } catch (e) { body.innerHTML = `<p class="co__hint">${esc(e.message)}</p>`; }
  }

  function subHtml(s) {
    const server = s.serverName || '🇷🇺 Россия';
    const stats = [
      ['Действует до', fmtDate(s.expiresAt)],
      s.daysLeft != null ? ['Осталось', s.daysLeft + ' дн.'] : null,
      ['Устройств', String(s.devices)],
      ['Трафик', s.trafficGb ? s.trafficGb + ' ГБ' : '∞'],
    ].filter(Boolean);
    const statsHtml = stats.map(([k, v]) => `<div class="stat"><span class="stat__k">${k}</span><span class="stat__v">${esc(v)}</span></div>`).join('');

    // Кнопки быстрого импорта в популярные клиенты (deep links).
    const apps = s.subUrl ? [
      { name: 'Happ', href: 'happ://add/' + s.subUrl },
      { name: 'v2RayTun', href: 'v2raytun://import/' + encodeURIComponent(s.subUrl) },
      { name: 'Hiddify', href: 'hiddify://import/' + encodeURIComponent(s.subUrl) },
      { name: 'Streisand', href: 'streisand://import/' + encodeURIComponent(s.subUrl) },
    ] : [];
    const appsHtml = apps.length ? `<div class="app-btns">${apps.map((a) => `
      <a class="app-btn" href="${esc(a.href)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>${a.name}</a>`).join('')}</div>` : '';

    const primary = s.subUrl
      ? `<div class="field-label">URL подписки</div>
         <div class="copybox"><input value="${esc(s.subUrl)}" readonly /><button class="btn btn--primary" data-copy="${encodeURIComponent(s.subUrl)}">Копировать</button></div>
         ${appsHtml}
         <ol class="steps">
           <li>Установите приложение: Happ, v2RayTun, Hiddify или Streisand.</li>
           <li>Нажмите кнопку приложения выше — или вставьте «URL подписки» в поле подписки вручную.</li>
           <li>Выберите сервер «${esc(server)}» и подключайтесь.</li>
         </ol>`
      : `<div class="field-label">Ключ VLESS</div>
         <div class="copybox"><input value="${esc(s.link)}" readonly /><button class="btn btn--primary" data-copy="${encodeURIComponent(s.link)}">Копировать</button></div>
         <p class="co__hint" style="margin-top:12px">Импортируйте ключ в v2rayNG (Android), Streisand (iOS) или Hiddify (ПК).</p>`;

    return `
      <div class="sub2">
        <div class="sub2__hero">
          <div class="sub2__check"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
          <h2 class="sub2__title">Подписка активна</h2>
          <p class="sub2__sub">Тариф «${esc(s.planName)}»</p>
          <span class="sub2__server">${esc(server)}</span>
        </div>
        ${s.mock ? '<div class="mock-note">⚠️ Демо-режим: ключ тестовый. Подключите панель 3x-ui (PANEL_URL) для реальных конфигов.</div>' : ''}
        ${s.qr ? `<div class="qr-card"><img src="${s.qr}" alt="QR-код подписки" /></div>` : ''}
        ${primary}
        <div class="sub2__stats">${statsHtml}</div>
        ${s.subUrl ? `<details class="sub-adv"><summary>Показать одиночный ключ VLESS</summary>
          <div class="copybox" style="margin-top:10px"><input value="${esc(s.link)}" readonly /><button class="btn btn--ghost" data-copy="${encodeURIComponent(s.link)}">Копировать</button></div>
        </details>` : ''}
      </div>`;
  }

  async function copyText(text) {
    // navigator.clipboard доступен только в защищённом контексте (HTTPS/localhost).
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback ниже */ }
    }
    // Фолбэк для HTTP: временный textarea + execCommand('copy').
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  function wireCopy(root) {
    $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
      const text = decodeURIComponent(b.dataset.copy);
      if (await copyText(text)) {
        toast('Скопировано');
      } else {
        // Последний резерв: выделяем поле рядом, чтобы можно было скопировать вручную.
        const inp = b.parentElement && b.parentElement.querySelector('input');
        if (inp) { inp.focus(); inp.select(); }
        toast('Выделено — нажмите «Копировать» в меню');
      }
    }));
  }

  /* ---------- Cabinet / Account ---------- */
  function openCabinet(tab) {
    openModal($('#cabinetModal'));
    if (getAuth()) renderAccount();
    else renderAuthForms(tab === 'register' ? 'register' : 'login');
  }

  function renderAuthForms(tab) {
    const body = $('#cabinetBody');
    const deviceSubs = getTokens();
    body.innerHTML = `
      <h2 class="modal__title">Личный кабинет</h2>
      <div class="tabs">
        <button class="tab ${tab === 'login' ? 'is-active' : ''}" data-tab="login">Вход</button>
        <button class="tab ${tab === 'register' ? 'is-active' : ''}" data-tab="register">Регистрация</button>
      </div>
      <form id="authForm" class="authform">
        <label class="field-label">Email</label>
        <input class="input" type="email" id="authEmail" placeholder="you@example.com" autocomplete="email" required />
        <label class="field-label">Пароль</label>
        <input class="input" type="password" id="authPass" placeholder="Минимум 6 символов" autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" required />
        <button class="btn btn--primary btn--block" type="submit" style="margin-top:16px">${tab === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
      </form>
      <p class="co__hint">Аккаунт хранит ваши подписки и доступен с любого устройства.</p>
      ${deviceSubs.length ? `<div class="co__or" style="margin:18px 0 8px">подписки на этом устройстве</div><div id="deviceSubs"></div>` : ''}`;
    $$('.tab', body).forEach((t) => t.addEventListener('click', () => renderAuthForms(t.dataset.tab)));
    $('#authForm').addEventListener('submit', (e) => { e.preventDefault(); doAuth(tab); });
    if (deviceSubs.length) renderDeviceSubs($('#deviceSubs'));
  }

  async function renderDeviceSubs(container) {
    const items = await Promise.all(getTokens().map((t) => api('/subscription/' + t).catch(() => null)));
    const valid = items.filter(Boolean);
    if (!valid.length) { container.innerHTML = ''; return; }
    container.innerHTML = valid.map(subCardHtml).join('');
    wireSubCards(container);
  }

  async function doAuth(tab) {
    const email = $('#authEmail').value.trim();
    const password = $('#authPass').value;
    try {
      const res = await api('/auth/' + (tab === 'login' ? 'login' : 'register'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      setAuth({ token: res.token, user: res.user });
      // Привяжем анонимные подписки к аккаунту.
      const tokens = getTokens();
      if (tokens.length) { try { await api('/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ tokens }) }); } catch {} }
      toast(tab === 'login' ? 'Вы вошли' : 'Аккаунт создан');
      updateAuthUI();
      renderAccount();
    } catch (e) { toast(e.message); }
  }

  async function renderAccount() {
    const body = $('#cabinetBody');
    const auth = getAuth();
    const isAdmin = !!auth?.user?.admin;
    body.innerHTML = `
      <div class="acct-head">
        <div><div class="acct-hi">Здравствуйте 👋</div><div class="acct-email">${esc(auth?.user?.email || '')}${isAdmin ? ' <span class="acct-badge">админ</span>' : ''}</div></div>
        <button class="btn btn--ghost" id="logoutBtn">Выйти</button>
      </div>
      <div id="acctSubs"><p class="co__hint">Загрузка подписок…</p></div>
      <a href="#plans" class="btn btn--primary btn--block" id="acctBuyMore" style="margin-top:16px">Купить ещё подписку</a>
      ${isAdmin ? '<a href="/admin/" class="btn btn--ghost btn--block" id="acctAdmin" style="margin-top:10px">Открыть админ-панель</a>' : ''}`;
    $('#logoutBtn').addEventListener('click', doLogout);
    $('#acctBuyMore').addEventListener('click', () => closeModal($('#cabinetModal')));
    try {
      const { subscriptions } = await api('/auth/me', { headers: authHeaders() });
      const box = $('#acctSubs');
      if (!subscriptions.length) { box.innerHTML = '<p class="mine-empty">У вас пока нет подписок. Оформите тариф ниже.</p>'; return; }
      box.innerHTML = subscriptions.map(subCardHtml).join('');
      wireSubCards(box);
    } catch (e) {
      if (String(e.message).includes('вход')) { clearAuth(); updateAuthUI(); return renderAuthForms('login'); }
      $('#acctSubs').innerHTML = `<p class="co__hint">${esc(e.message)}</p>`;
    }
  }

  function subCardHtml(s) {
    return `
      <div class="mine-card">
        <div class="mine-card__top">
          <span class="mine-card__name"><span class="dot-live ${s.active ? 'on' : 'off'}"></span> ${esc(s.planName)}</span>
          <div class="mine-card__btns">
            <button class="btn btn--ghost btn--sm" data-open="${s.token}">Ключ</button>
            <button class="btn btn--ghost btn--sm" data-renew="${s.planId}">Продлить</button>
          </div>
        </div>
        <div class="sub-meta" style="margin-bottom:0">
          <span class="sub-chip">${s.active ? 'до' : 'истекла'} <b>${fmtDate(s.expiresAt)}</b></span>
          ${s.daysLeft != null ? `<span class="sub-chip"><b>${s.daysLeft} дн.</b></span>` : ''}
          <span class="sub-chip">${s.trafficGb ? s.trafficGb + ' ГБ' : 'безлимит'}</span>
        </div>
      </div>`;
  }

  function wireSubCards(root) {
    $$('[data-open]', root).forEach((b) => b.addEventListener('click', () => { closeModal($('#cabinetModal')); showSubscription(b.dataset.open); }));
    $$('[data-renew]', root).forEach((b) => b.addEventListener('click', () => { closeModal($('#cabinetModal')); startCheckout(b.dataset.renew); }));
  }

  async function doLogout() {
    try { await api('/auth/logout', { method: 'POST', headers: authHeaders() }); } catch {}
    clearAuth();
    updateAuthUI();
    renderAuthForms('login');
    toast('Вы вышли из аккаунта');
  }

  function updateAuthUI() {
    const auth = getAuth();
    const authed = !!auth;
    const email = auth?.user?.email || '';
    const show = (sel, on) => { const el = $(sel); if (el) el.hidden = !on; };
    show('#loginBtn', !authed);
    show('#registerBtn', !authed);
    show('#cabinetBtn', authed);
    show('#navLoginBtn', !authed);
    show('#navRegisterBtn', !authed);
    show('#navCabinetBtn', authed);
    const hero = $('#heroRegisterBtn'); if (hero) hero.hidden = authed;
    if (authed) {
      const label = $('#cabinetBtnLabel'); if (label) label.textContent = email ? email.split('@')[0] : 'Кабинет';
      const av = $('#acctAvatar'); if (av) av.textContent = (email.trim()[0] || 'A').toUpperCase();
    }
  }

  /* ---------- Modals ---------- */
  function openModal(m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(m) { m.hidden = true; document.body.style.overflow = ''; }
  $$('[data-close]').forEach((el) => el.addEventListener('click', () => $$('.modal').forEach(closeModal)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal').forEach(closeModal); });

  /* ---------- Header / nav ---------- */
  function initChrome() {
    const header = $('#header');
    window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 8), { passive: true });
    const burger = $('#burger'), nav = $('#nav');
    burger.addEventListener('click', () => { const open = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open)); });
    $$('.nav__link').forEach((l) => l.addEventListener('click', () => { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }));
    const closeMenu = () => { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); };
    const bind = (id, tab) => { const el = $('#' + id); if (el) el.addEventListener('click', () => { closeMenu(); openCabinet(tab); }); };
    bind('loginBtn', 'login'); bind('navLoginBtn', 'login');
    bind('registerBtn', 'register'); bind('navRegisterBtn', 'register'); bind('heroRegisterBtn', 'register');
    bind('cabinetBtn'); bind('navCabinetBtn');
    $('#year').textContent = new Date().getFullYear();
    updateAuthUI();
  }

  /* ---------- Init ---------- */
  async function init() {
    initChrome();
    renderFeatures();
    try {
      const [cfg, pl] = await Promise.all([api('/config'), api('/plans')]);
      appConfig = cfg; plans = pl.plans || [];
      document.title = `${cfg.brand} — быстрый VPN без ограничений`;
      $('#brandName').textContent = cfg.brand;
      if (cfg.botUsername) { const link = $('#tgLink'); link.href = 'https://t.me/' + cfg.botUsername; link.hidden = false; }
    } catch (e) { toast('Не удалось загрузить данные: ' + e.message); }
    renderPlans();
  }
  init();
})();
