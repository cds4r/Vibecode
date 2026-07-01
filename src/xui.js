import crypto from 'node:crypto';
import { config, isPanelMock } from './config.js';

/**
 * Клиент панели 3x-ui.
 * Если PANEL_URL не задан — работает в MOCK-режиме и возвращает демо-данные,
 * чтобы можно было разрабатывать и тестировать сайт/бота без реальной панели.
 */

let cookie = null;
let cookieExpiresAt = 0;

function uuid() {
  return crypto.randomUUID();
}

async function login() {
  if (cookie && Date.now() < cookieExpiresAt) return cookie;
  const res = await fetch(`${config.panel.url}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: config.panel.username,
      password: config.panel.password,
    }),
    redirect: 'manual',
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
  const c = await login();
  const res = await fetch(`${config.panel.url}${pathname}`, {
    ...options,
    headers: { Cookie: c, ...(options.headers || {}) },
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
  let stream = {};
  try { stream = JSON.parse(inbound.streamSettings || '{}'); } catch { /* ignore */ }
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

  const inbound = await getInbound(config.panel.inboundId);
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
    flow: '',
  };
  const json = await panelFetch('/panel/api/inbounds/addClient', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: config.panel.inboundId,
      settings: JSON.stringify({ clients: [client] }),
    }),
  });
  if (!json.success) throw new Error(`addClient failed: ${json.msg || 'unknown'}`);

  const link = buildVlessLink(inbound, clientId, email);
  return { clientId, email, subId, expiryTime, link, mock: false };
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
    await login();
    return { ok: true, mock: false };
  } catch (e) {
    return { ok: false, mock: false, error: e.message };
  }
}
