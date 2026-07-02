import 'dotenv/config';

const bool = (v, def = false) => {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  port: num(process.env.PORT, 3000),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 3000)}`).replace(/\/$/, ''),
  brandName: process.env.BRAND_NAME || 'VibeVPN',
  allowMockPay: bool(process.env.ALLOW_MOCK_PAY, true),
  adminKey: process.env.ADMIN_KEY || '',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Настройки ссылки-подписки (собственный endpoint /sub/:token).
  sub: {
    // Название подписки (Profile-Title) — как оно отображается в VPN-клиенте.
    title: process.env.SUB_TITLE || process.env.BRAND_NAME || 'VibeVPN',
    // Название сервера (remark каждого конфига), напр. «🇷🇺 Россия».
    serverName: process.env.SUB_SERVER_NAME || '🇷🇺 Россия',
    // Базовый публичный адрес, по которому доступна подписка (обычно адрес сайта).
    publicBase: (process.env.SUB_PUBLIC_URL || process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 3000)}`).replace(/\/$/, ''),
    // Как часто клиент обновляет подписку, часов.
    updateHours: num(process.env.SUB_UPDATE_HOURS, 24),
  },

  // Встроенный HTTPS (для отдачи подписки по https, если нет внешнего reverse-proxy).
  // Указываете пути к сертификату (лучше fullchain) и ключу + порт.
  tls: {
    cert: process.env.TLS_CERT || '',
    key: process.env.TLS_KEY || '',
    port: num(process.env.TLS_PORT, 0),
  },

  panel: {
    url: (process.env.PANEL_URL || '').replace(/\/$/, ''),
    username: process.env.PANEL_USERNAME || '',
    password: process.env.PANEL_PASSWORD || '',
    apiToken: process.env.PANEL_API_TOKEN || '',
    inboundId: num(process.env.PANEL_INBOUND_ID, 1),
    nodeHost: process.env.NODE_HOST || '',
    subBaseUrl: (process.env.SUB_BASE_URL || '').replace(/\/$/, ''),
    // Панель часто с self-signed или локальным TLS — по умолчанию не проверяем сертификат.
    insecureTLS: bool(process.env.PANEL_INSECURE_TLS, true),
  },

  // Хранилище данных. Если задан DB_HOST — используется MySQL/MariaDB
  // (данные видны в phpMyAdmin). Иначе — простой JSON-файл в data/db.json.
  db: {
    host: process.env.DB_HOST || '',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'vibevpn',
    connectionLimit: num(process.env.DB_POOL, 10),
  },

  bot: {
    token: process.env.BOT_TOKEN || '',
    payment: (process.env.BOT_PAYMENT || 'stars').toLowerCase(),
    providerToken: process.env.BOT_PROVIDER_TOKEN || '',
    currency: (process.env.BOT_CURRENCY || 'RUB').toUpperCase(),
    adminIds: (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

// В MOCK-режиме работаем, если не задан адрес панели.
export const isPanelMock = !config.panel.url;

// Используем MySQL/MariaDB, если задан DB_HOST. Иначе — JSON-файл.
export const isDbMysql = !!config.db.host;
