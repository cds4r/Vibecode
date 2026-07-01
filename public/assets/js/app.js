(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const api = (path, opts) => fetch('/api' + path, opts).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  });

  const TOKENS_KEY = 'vibevpn-tokens';
  const getTokens = () => { try { return JSON.parse(localStorage.getItem(TOKENS_KEY)) || []; } catch { return []; } };
  const saveToken = (t) => { const a = getTokens(); if (!a.includes(t)) { a.push(t); localStorage.setItem(TOKENS_KEY, JSON.stringify(a)); } };

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
        ${p.badge ? `<span class="plan__badge">${p.badge}</span>` : ''}
        <h3 class="plan__name">${p.name}</h3>
        <div class="plan__price"><b>${priceLabel(p)}</b> ${p.priceRub ? '<span>/ период</span>' : ''}</div>
        <p class="plan__desc">${p.description || ''}</p>
        <ul class="plan__list">${p.features.map((f) => `<li>${f}</li>`).join('')}</ul>
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
    try {
      const res = await api('/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (res.free && res.token) {
        saveToken(res.token);
        return showSubscription(res.token);
      }
      renderCheckout(plan, res.orderId, res.allowMockPay);
    } catch (e) { toast(e.message); }
  }

  function renderCheckout(plan, orderId, allowMockPay) {
    const body = $('#checkoutBody');
    const tg = appConfig.botUsername
      ? `<a class="btn btn--primary btn--block" href="https://t.me/${appConfig.botUsername}" target="_blank" rel="noopener">Оплатить в Telegram-боте</a>`
      : '';
    const mock = allowMockPay
      ? `<button class="btn ${tg ? 'btn--ghost' : 'btn--primary'} btn--block" id="mockPayBtn">Оплатить (демо-режим)</button>`
      : '';
    const noPay = !tg && !mock
      ? `<p class="co__hint">Онлайн-оплата ещё не настроена администратором. Свяжитесь с поддержкой для оплаты.</p>`
      : '';
    body.innerHTML = `
      <div class="co__plan">${plan.name}</div>
      <div class="co__price">${plan.priceRub} ₽ <span>/ период</span></div>
      <ul class="co__list">${plan.features.map((f) => `<li>${f}</li>`).join('')}</ul>
      <div class="co__pay">
        ${tg}
        ${tg && mock ? '<div class="co__or">или</div>' : ''}
        ${mock}
        ${noPay}
      </div>
      <p class="co__hint">Ключ выдаётся автоматически сразу после оплаты.</p>`;
    if (allowMockPay) {
      $('#mockPayBtn').addEventListener('click', async () => {
        const btn = $('#mockPayBtn');
        btn.disabled = true; btn.textContent = 'Обработка…';
        try {
          const { token } = await api(`/orders/${orderId}/confirm`, { method: 'POST' });
          saveToken(token);
          closeModal($('#checkoutModal'));
          showSubscription(token);
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
    } catch (e) { body.innerHTML = `<p class="co__hint">${e.message}</p>`; }
  }

  function subHtml(s) {
    return `
      <div class="sub-ok"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Подписка активна</div>
      <p class="co__hint">Тариф «${s.planName}». Сохранён в этом браузере — найдёте в «Мои подписки».</p>
      <div class="sub-meta">
        <span class="sub-chip">Действует до: <b>${fmtDate(s.expiresAt)}</b></span>
        ${s.daysLeft != null ? `<span class="sub-chip">Осталось: <b>${s.daysLeft} дн.</b></span>` : ''}
        <span class="sub-chip">Устройств: <b>${s.devices}</b></span>
        <span class="sub-chip">Трафик: <b>${s.trafficGb ? s.trafficGb + ' ГБ' : '∞'}</b></span>
      </div>
      ${s.mock ? '<div class="mock-note">⚠️ Демо-режим: ключ тестовый. Подключите панель 3x-ui (PANEL_URL) для реальных конфигов.</div>' : ''}
      ${s.qr ? `<img class="qr" src="${s.qr}" alt="QR-код конфигурации" />` : ''}
      <div class="field-label">Ключ VLESS</div>
      <div class="copybox"><input value="${s.link}" readonly /><button class="btn btn--ghost" data-copy="${encodeURIComponent(s.link)}">Копировать</button></div>
      ${s.subUrl ? `<div class="field-label">Ссылка-подписка</div><div class="copybox"><input value="${s.subUrl}" readonly /><button class="btn btn--ghost" data-copy="${encodeURIComponent(s.subUrl)}">Копировать</button></div>` : ''}
      <p class="co__hint" style="margin-top:16px">Импортируйте ключ в v2rayNG (Android), Streisand (iOS) или Hiddify (ПК).</p>`;
  }

  function wireCopy(root) {
    $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(decodeURIComponent(b.dataset.copy)); toast('Скопировано'); }
      catch { toast('Не удалось скопировать'); }
    }));
  }

  /* ---------- My subscriptions ---------- */
  async function showMine() {
    const body = $('#mineBody');
    const tokens = getTokens();
    openModal($('#mineModal'));
    if (!tokens.length) { body.innerHTML = '<p class="mine-empty">Пока нет сохранённых подписок.<br>Оформите тариф — и он появится здесь.</p>'; return; }
    body.innerHTML = '<p class="co__hint">Загрузка…</p>';
    const items = await Promise.all(tokens.map((t) => api('/subscription/' + t).catch(() => null)));
    const valid = items.filter(Boolean);
    if (!valid.length) { body.innerHTML = '<p class="mine-empty">Подписки не найдены.</p>'; return; }
    body.innerHTML = valid.map((s) => `
      <div class="mine-card">
        <div class="mine-card__top">
          <span class="mine-card__name"><span class="dot-live ${s.active ? 'on' : 'off'}"></span> ${s.planName}</span>
          <button class="btn btn--ghost" data-open="${s.token}">Показать ключ</button>
        </div>
        <div class="sub-meta" style="margin-bottom:0">
          <span class="sub-chip">до <b>${fmtDate(s.expiresAt)}</b></span>
          ${s.daysLeft != null ? `<span class="sub-chip"><b>${s.daysLeft} дн.</b></span>` : ''}
          ${s.usage ? `<span class="sub-chip">Использовано: <b>${(s.usage.used / 1073741824).toFixed(2)} ГБ</b></span>` : ''}
        </div>
      </div>`).join('');
    $$('[data-open]', body).forEach((b) => b.addEventListener('click', () => { closeModal($('#mineModal')); showSubscription(b.dataset.open); }));
  }

  /* ---------- Modals ---------- */
  function openModal(m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(m) { m.hidden = true; document.body.style.overflow = ''; }
  $$('[data-close]').forEach((el) => el.addEventListener('click', () => {
    $$('.modal').forEach(closeModal);
  }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal').forEach(closeModal); });

  /* ---------- Header / nav ---------- */
  function initChrome() {
    const header = $('#header');
    window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 8), { passive: true });
    const burger = $('#burger'), nav = $('#nav');
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
    $$('.nav__link').forEach((l) => l.addEventListener('click', () => { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }));
    $('#mySubsBtn').addEventListener('click', showMine);
    $('#year').textContent = new Date().getFullYear();
  }

  /* ---------- Init ---------- */
  async function init() {
    initChrome();
    renderFeatures();
    try {
      const [cfg, pl] = await Promise.all([api('/config'), api('/plans')]);
      appConfig = cfg;
      plans = pl.plans || [];
      document.title = `${cfg.brand} — быстрый VPN без ограничений`;
      $('#brandName').textContent = cfg.brand;
      if (cfg.botUsername) {
        const link = $('#tgLink');
        link.href = 'https://t.me/' + cfg.botUsername;
        link.hidden = false;
      }
    } catch (e) { toast('Не удалось загрузить данные: ' + e.message); }
    renderPlans();
  }
  init();
})();
