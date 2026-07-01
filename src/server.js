import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isPanelMock } from './config.js';
import { apiRouter } from './routes/api.js';
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
