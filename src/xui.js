import crypto from 'node:crypto';
import { Agent } from 'undici';
import { config, isPanelMock } from './config.js';

/**
 * Клиент панели 3x-ui.
 * Поддерживает два способа авторизации:
 *  - API-токен (PANEL_API_TOKEN) через заголовок Authorization: Bearer — приоритетный;
 *  - логин по username/password (cookie-сессия) — если токен не задан.
 * Если PANEL_URL не задан — работает в MOCK-режиме и возвращает демо-данные.
 */

let cookie = null;
let cookieExpiresAt = 0;

// Панель обычно за self-signed/локальным TLS — по флагу не проверяем сертификат.
const panelDispatcher = config.panel.insecureTLS
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

const useToken = () => !!config.panel.apiToken;

function uuid() {
  return crypto.randomUUID();
}

// Панель может отдавать settings/streamSettings как строку ИЛИ как объект — нормализуем.
function asObj(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}
const asStr = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? {}));

// Сериализуем добавление клиентов (update перезаписывает инбаунд целиком — избегаем гонок).
let updateChain = Promise.resolve();
function withLock(fn) {
  const run = updateChain.then(fn, fn);
  updateChain = run.then(() => {}, () => {});
  return run;
}

async function login() {
  if (useToken()) return null; // токен — cookie не нужен
  if (cookie && Date.now() < cookieExpiresAt) return cookie;
  const res = await fetch(`${config.panel.url}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: config.panel.username,
      password: config.panel.password,
    }),
    redirect: 'manual',
    dispatcher: panelDispatcher,
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    const body = await res.text().catch(() => '');
    throw new Error(`3x-ui login failed (status ${res.status}): ${body.slice(0, 200)}`);
  }
  cookie = setCookie.split(';')[0];
  cookieExpiresAt = Date.now() + 55 * 60 * 1000; // ~55 минут
  return cookie;
}

async function panelFetch(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (useToken()) {
    headers.Authorization = `Bearer ${config.panel.apiToken}`;
  } else {
    headers.Cookie = await login();
  }
  const res = await fetch(`${config.panel.url}${pathname}`, {
    ...options,
    headers,
    dispatcher: panelDispatcher,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { success: false, msg: text.slice(0, 300) }; }
  return json;
}

async function getInbound(inboundId) {
  const json = await panelFetch(`/panel/api/inbounds/get/${inboundId}`);
  if (!json.success) throw new Error(`get inbound failed: ${json.msg || 'unknown'}`);
  return json.obj;
}

function hostFromPanel() {
  if (config.panel.nodeHost) return config.panel.nodeHost;
  try { return new URL(config.panel.url).hostname; } catch { return 'example.com'; }
}

/**
 * Собирает vless:// ссылку из данных инбаунда (best-effort).
 */
function buildVlessLink(inbound, clientId, email) {
  const host = hostFromPanel();
  const port = inbound.port;
  const stream = asObj(inbound.streamSettings);
  const net = stream.network || 'tcp';
  const security = stream.security || 'none';
  const params = new URLSearchParams();
  params.set('type', net);
  params.set('security', security);

  if (security === 'reality' && stream.realitySettings) {
    const rs = stream.realitySettings;
    const settings = rs.settings || {};
    if (rs.serverNames?.[0]) params.set('sni', rs.serverNames[0]);
    if (settings.publicKey) params.set('pbk', settings.publicKey);
    if (rs.shortIds?.[0]) params.set('sid', rs.shortIds[0]);
    if (settings.fingerprint) params.set('fp', settings.fingerprint);
    if (settings.spiderX) params.set('spx', settings.spiderX);
    params.set('flow', 'xtls-rprx-vision');
  } else if (security === 'tls' && stream.tlsSettings) {
    if (stream.tlsSettings.serverName) params.set('sni', stream.tlsSettings.serverName);
    if (stream.tlsSettings.settings?.fingerprint) params.set('fp', stream.tlsSettings.settings.fingerprint);
  }

  if (net === 'ws' && stream.wsSettings) {
    if (stream.wsSettings.path) params.set('path', stream.wsSettings.path);
    const h = stream.wsSettings.headers?.Host;
    if (h) params.set('host', h);
  } else if (net === 'grpc' && stream.grpcSettings) {
    if (stream.grpcSettings.serviceName) params.set('serviceName', stream.grpcSettings.serviceName);
  }

  const remark = encodeURIComponent(`${config.brandName}-${email}`);
  return `vless://${clientId}@${host}:${port}?${params.toString()}#${remark}`;
}

/**
 * Создаёт (или продлевает) клиента в инбаунде.
 * @returns {Promise<{clientId, email, subId, expiryTime, link}>}
 */
export async function createClient({ email, expiryMs, trafficGb, limitIp = 0 }) {
  const expiryTime = expiryMs ? Date.now() + expiryMs : 0;
  const totalBytes = trafficGb ? Math.round(trafficGb * 1024 * 1024 * 1024) : 0;

  if (isPanelMock) {
    const clientId = uuid();
    const subId = crypto.randomBytes(8).toString('hex');
    const link = `vless://${clientId}@demo.${config.brandName.toLowerCase()}.vpn:443?type=tcp&security=reality&sni=example.com&pbk=DEMOPUBLICKEY&fp=chrome&flow=xtls-rprx-vision#${encodeURIComponent(config.brandName + '-' + email)}`;
    return { clientId, email, subId, expiryTime, link, mock: true };
  }

  // Добавляем клиента через обновление инбаунда: read-modify-write под локом.
  // (Универсально для 3x-ui, в т.ч. когда у API-токена нет прав на addClient.)
  return withLock(async () => {
    const inbound = await getInbound(config.panel.inboundId);
    const stream = asObj(inbound.streamSettings);
    // Для Reality клиент должен использовать flow xtls-rprx-vision (иначе рукопожатие не сойдётся).
    const security = stream.security || 'none';
    const clientId = uuid();
    const subId = crypto.randomBytes(8).toString('hex');
    const client = {
      id: clientId,
      email,
      enable: true,
      expiryTime,
      totalGB: totalBytes,
      limitIp,
      tgId: '',
      subId,
      reset: 0,
      flow: security === 'reality' ? 'xtls-rprx-vision' : '',
    };

    const settings = asObj(inbound.settings);
    if (!Array.isArray(settings.clients)) settings.clients = [];
    settings.clients.push(client);

    const body = {
      id: inbound.id,
      up: inbound.up || 0,
      down: inbound.down || 0,
      total: inbound.total || 0,
      remark: inbound.remark || '',
      enable: inbound.enable !== false,
      expiryTime: inbound.expiryTime || 0,
      listen: inbound.listen || '',
      port: inbound.port,
      protocol: inbound.protocol,
      settings: JSON.stringify(settings),
      streamSettings: asStr(inbound.streamSettings),
      sniffing: asStr(inbound.sniffing),
    };
    const json = await panelFetch(`/panel/api/inbounds/update/${config.panel.inboundId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!json.success) throw new Error(`addClient failed: ${json.msg || 'unknown'}`);

    const link = buildVlessLink(inbound, clientId, email);
    return { clientId, email, subId, expiryTime, link, mock: false };
  });
}

/**
 * Включает/выключает клиента в инбаунде по email (best-effort).
 * В MOCK-режиме ничего не делает. Ошибки не пробрасываются наверх —
 * источник правды об отключении хранится в нашей БД.
 */
export async function setClientEnabled(email, enabled) {
  if (isPanelMock) return { ok: true, mock: true };
  try {
    return await withLock(async () => {
      const inbound = await getInbound(config.panel.inboundId);
      const settings = asObj(inbound.settings);
      const clients = Array.isArray(settings.clients) ? settings.clients : [];
      const client = clients.find((c) => c.email === email);
      if (!client) return { ok: false, notFound: true };
      client.enable = !!enabled;

      const body = {
        id: inbound.id,
        up: inbound.up || 0,
        down: inbound.down || 0,
        total: inbound.total || 0,
        remark: inbound.remark || '',
        enable: inbound.enable !== false,
        expiryTime: inbound.expiryTime || 0,
        listen: inbound.listen || '',
        port: inbound.port,
        protocol: inbound.protocol,
        settings: JSON.stringify(settings),
        streamSettings: asStr(inbound.streamSettings),
        sniffing: asStr(inbound.sniffing),
      };
      const json = await panelFetch(`/panel/api/inbounds/update/${config.panel.inboundId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { ok: !!json.success, msg: json.msg };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Возвращает трафик клиента по email: { up, down, total, expiryTime, enable }.
 */
export async function getClientTraffic(email) {
  if (isPanelMock) {
    return { up: 0, down: 0, total: 0, expiryTime: 0, enable: true, mock: true };
  }
  const json = await panelFetch(`/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`);
  if (!json.success || !json.obj) return null;
  return json.obj;
}

export function subscriptionUrl(subId) {
  if (config.panel.subBaseUrl && subId) return `${config.panel.subBaseUrl}/${subId}`;
  return null;
}

export async function panelStatus() {
  if (isPanelMock) return { ok: true, mock: true };
  try {
    if (useToken()) {
      const json = await panelFetch('/panel/api/inbounds/list');
      return { ok: !!json.success, mock: false };
    }
    await login();
    return { ok: true, mock: false };
  } catch (e) {
    return { ok: false, mock: false, error: e.message };
  }
}
