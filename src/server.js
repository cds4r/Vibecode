import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isPanelMock } from './config.js';
import { apiRouter } from './routes/api.js';
import { getSubFeed } from './provision.js';
import { startBot } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

async function main() {
  const ctx = { botUsername: null };

  // Запускаем Telegram-бота (если задан токен) — до старта сервера, чтобы узнать username.
  let bot = null;
  if (config.bot.token) {
    try {
      bot = await startBot();
      ctx.botUsername = bot?.botInfo?.username || null;
      console.log(`✓ Telegram-бот запущен: @${ctx.botUsername}`);
    } catch (e) {
      console.error('✗ Не удалось запустить бота:', e.message);
    }
  } else {
    console.log('ℹ BOT_TOKEN не задан — бот не запущен, работает только сайт.');
  }

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter(ctx));

  // Собственная ссылка-подписка: base64-список конфигов + заголовки для VPN-клиента.
  // Название подписки (Profile-Title) и имя сервера задаются в конфиге.
  app.get('/sub/:token', async (req, res) => {
    try {
      const feed = await getSubFeed(req.params.token);
      if (!feed) return res.status(404).type('text/plain').send('Subscription not found');
      res.set('Content-Type', 'text/plain; charset=utf-8');
      // Profile-Title в HTTP-заголовке передаём base64 (заголовки — только ASCII).
      res.set('Profile-Title', 'base64:' + Buffer.from(feed.title, 'utf8').toString('base64'));
      res.set('Profile-Update-Interval', String(feed.updateHours));
      res.set('Subscription-Userinfo', feed.userinfo);
      res.set('Profile-Web-Page-Url', config.publicUrl);
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(feed.title)}`);
      res.send(feed.body);
    } catch (e) {
      res.status(500).type('text/plain').send('Error');
    }
  });

  app.use(express.static(PUBLIC_DIR));

  // SPA-fallback на главную
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.listen(config.port, () => {
    console.log(`\n🚀 ${config.brandName} запущен: ${config.publicUrl}`);
    console.log(`   Порт: ${config.port}`);
    console.log(`   Панель 3x-ui: ${isPanelMock ? 'MOCK-режим (демо-конфиги)' : config.panel.url}`);
    console.log(`   Демо-оплата: ${config.allowMockPay ? 'включена' : 'выключена'}`);
  });
}

main().catch((e) => {
  console.error('Фатальная ошибка запуска:', e);
  process.exit(1);
});
