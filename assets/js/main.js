(() => {
  'use strict';

  const root = document.documentElement;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Theme ---------- */
  const themeToggle = document.getElementById('themeToggle');
  const stored = localStorage.getItem('vibecode-theme');
  if (stored === 'light' || stored === 'dark') {
    root.setAttribute('data-theme', stored);
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    root.setAttribute('data-theme', 'light');
  }
  themeToggle?.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('vibecode-theme', next);
  });

  /* ---------- Header scroll state ---------- */
  const header = document.getElementById('header');
  const onScroll = () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 8);
    toTop?.classList.toggle('is-visible', window.scrollY > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Mobile nav ---------- */
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  const closeNav = () => {
    nav?.classList.remove('is-open');
    burger?.setAttribute('aria-expanded', 'false');
  };
  burger?.addEventListener('click', () => {
    const open = nav?.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(!!open));
  });
  nav?.querySelectorAll('.nav__link').forEach((link) => link.addEventListener('click', closeNav));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll('[data-reveal]');
  if (prefersReduced || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  } else {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('is-visible'), (i % 4) * 70);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- Animated counters ---------- */
  const counters = document.querySelectorAll('[data-count]');
  const formatNum = (n) => n.toLocaleString('ru-RU');
  const runCounter = (el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const duration = 1400;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatNum(Math.round(target * eased)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = formatNum(target) + suffix;
    };
    requestAnimationFrame(tick);
  };
  if (prefersReduced || !('IntersectionObserver' in window)) {
    counters.forEach((el) => { el.textContent = formatNum(parseFloat(el.dataset.count)) + (el.dataset.suffix || ''); });
  } else {
    const cio = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { runCounter(entry.target); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => cio.observe(el));
  }

  /* ---------- FAQ: single open at a time ---------- */
  const faqItems = document.querySelectorAll('.faq__item');
  faqItems.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (item.open) faqItems.forEach((o) => { if (o !== item) o.open = false; });
    });
  });

  /* ---------- CTA form ---------- */
  const form = document.getElementById('ctaForm');
  const emailInput = document.getElementById('email');
  const msg = document.getElementById('ctaMsg');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = (emailInput?.value || '').trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!valid) {
      emailInput?.classList.add('is-error');
      if (msg) { msg.textContent = 'Пожалуйста, введите корректный email.'; msg.style.color = '#ff5c93'; }
      emailInput?.focus();
      return;
    }
    emailInput?.classList.remove('is-error');
    if (msg) { msg.textContent = 'Готово! Мы отправили ссылку для входа на ' + value; msg.style.color = ''; }
    form.reset();
  });
  emailInput?.addEventListener('input', () => emailInput.classList.remove('is-error'));

  /* ---------- To top ---------- */
  const toTop = document.getElementById('toTop');
  toTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' }));

  /* ---------- Year ---------- */
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  onScroll();
})();
