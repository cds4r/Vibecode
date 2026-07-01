import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import QRCode from 'qrcode';
import { config } from './config.js';
import { plans, getPlan } from './plans.js';
import { db, id } from './store.js';
import { createOrder, fulfillOrder } from './provision.js';
import { getClientTraffic } from './xui.js';

const fmtBytes = (b) => {
  if (!b) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
};

const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('ru-RU') : 'бессрочно');

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛒 Купить подписку', 'buy')],
    [Markup.button.callback('📱 Мои подписки', 'mine')],
    [Markup.button.callback('❓ Помощь', 'help')],
  ]);
}

function plansKeyboard() {
  const rows = plans.map((p) => {
    const price = p.priceRub === 0 ? 'бесплатно' : payLabel(p);
    return [Markup.button.callback(`${p.name} — ${price}`, `plan:${p.id}`)];
  });
  rows.push([Markup.button.callback('« Назад', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

function payLabel(plan) {
  if (config.bot.payment === 'stars') return `${plan.priceStars} ⭐`;
  return `${plan.priceRub} ${config.bot.currency}`;
}

async function registerUser(ctx) {
  const from = ctx.from;
  if (!from) return null;
  let user = db.findUserByTelegram(from.id);
  if (!user) {
    user = db.upsertUser({
      id: id('usr_'),
      telegramId: String(from.id),
      username: from.username || '',
      name: [from.first_name, from.last_name].filter(Boolean).join(' '),
      createdAt: Date.now(),
    });
  }
  return user;
}

async function sendSubscription(ctx, sub) {
  const lines = [
    `✅ Подписка активна: *${escapeMd(sub.planName)}*`,
    '',
    `📅 Действует до: ${fmtDate(sub.expiresAt)}`,
    `📱 Устройств: ${sub.devices}`,
    `📦 Трафик: ${sub.trafficGb ? sub.trafficGb + ' ГБ' : 'безлимит'}`,
    '',
    '🔗 Ключ для подключения (VLESS):',
    '`' + sub.link + '`',
  ];
  if (sub.subUrl) {
    lines.push('', '📥 Ссылка-подписка (для приложений):', '`' + sub.subUrl + '`');
  }
  if (sub.mock) {
    lines.push('', '⚠️ _Демо-режим: ключ тестовый, панель 3x-ui не подключена._');
  }
  const caption = lines.join('\n');

  try {
    const png = await QRCode.toBuffer(sub.link, { margin: 1, width: 512 });
    await ctx.replyWithPhoto({ source: png }, { caption, parse_mode: 'Markdown' });
  } catch {
    await ctx.reply(caption, { parse_mode: 'Markdown' });
  }
  await ctx.reply(
    '📖 Как подключиться: установите приложение (v2rayNG для Android, Streisand/Shadowrocket для iOS, Hiddify/NekoBox для ПК), нажмите «+», выберите импорт из буфера обмена или по ссылке-подписке и вставьте ключ выше.',
    mainMenu(),
  );
}

function escapeMd(s = '') {
  return String(s).replace(/([_*\[\]()`])/g, '\\$1');
}

function notifyAdmins(bot, text) {
  for (const adminId of config.bot.adminIds) {
    bot.telegram.sendMessage(adminId, text).catch(() => {});
  }
}

async function startBuy(ctx, planId) {
  const plan = getPlan(planId);
  if (!plan) return ctx.answerCbQuery('Тариф не найден');
  const user = await registerUser(ctx);
  const order = createOrder({
    planId,
    userId: user?.id || null,
    source: 'bot',
    contact: { telegramId: String(ctx.from.id), username: ctx.from.username || '' },
  });

  // Бесплатный тариф — сразу выдаём.
  if (plan.priceRub === 0 && plan.priceStars === 0) {
    await ctx.answerCbQuery('Оформляем пробную подписку…');
    const sub = await fulfillOrder(order.id, { method: 'free' });
    notifyAdmins(ctx.telegram || ctx.tg, `🆕 Пробная подписка: @${ctx.from.username || ctx.from.id} — ${plan.name}`);
    return sendSubscription(ctx, sub);
  }

  const mode = config.bot.payment;

  if (mode === 'mock') {
    if (!config.allowMockPay) return ctx.answerCbQuery('Оплата временно недоступна');
    await ctx.answerCbQuery();
    return ctx.reply(
      `Тариф «${plan.name}» — ${payLabel(plan)}.\nДемо-режим оплаты.`,
      Markup.inlineKeyboard([[Markup.button.callback('✅ Оплатить (демо)', `confirm:${order.id}`)]]),
    );
  }

  // Оплата инвойсом (Stars или платёжный провайдер).
  try {
    await ctx.answerCbQuery();
    const isStars = mode === 'stars';
    const currency = isStars ? 'XTR' : config.bot.currency;
    const amount = isStars ? plan.priceStars : plan.priceRub * 100;
    await ctx.replyWithInvoice({
      title: `${config.brandName} — ${plan.name}`,
      description: plan.features.join(' · '),
      payload: order.id,
      provider_token: isStars ? '' : config.bot.providerToken,
      currency,
      prices: [{ label: plan.name, amount }],
    });
  } catch (e) {
    await ctx.reply('Не удалось создать счёт на оплату: ' + e.message);
  }
}

export async function startBot() {
  const bot = new Telegraf(config.bot.token);

  bot.start(async (ctx) => {
    await registerUser(ctx);
    await ctx.reply(
      `👋 Добро пожаловать в *${escapeMd(config.brandName)}*!\n\n` +
        'Быстрый и надёжный VPN без ограничений. Выберите тариф — и через минуту получите ключ для подключения.',
      { parse_mode: 'Markdown', ...mainMenu() },
    );
  });

  bot.action('menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Главное меню:', mainMenu());
  });

  bot.action('buy', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Выберите тариф:', plansKeyboard());
  });

  bot.action('help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      'ℹ️ *Как это работает*\n\n' +
        '1. Выберите тариф и оплатите.\n' +
        '2. Получите VLESS-ключ и QR-код.\n' +
        '3. Установите приложение (v2rayNG / Streisand / Hiddify) и импортируйте ключ.\n\n' +
        'Проблемы с подключением? Напишите нам — поможем.',
      { parse_mode: 'Markdown', ...mainMenu() },
    );
  });

  bot.action('mine', async (ctx) => {
    await ctx.answerCbQuery();
    const subs = db.subscriptionsByTelegram(ctx.from.id);
    if (!subs.length) {
      return ctx.reply('У вас пока нет подписок.', plansKeyboard());
    }
    for (const sub of subs) {
      let usageLine = '';
      try {
        const t = await getClientTraffic(sub.email);
        if (t) usageLine = `\n📊 Использовано: ${fmtBytes((t.up || 0) + (t.down || 0))}`;
      } catch { /* ignore */ }
      const active = sub.expiresAt === 0 || sub.expiresAt > Date.now();
      await ctx.reply(
        `${active ? '🟢' : '🔴'} *${escapeMd(sub.planName)}*\n` +
          `📅 до ${fmtDate(sub.expiresAt)}${usageLine}\n\n` +
          '🔗 Ключ:\n`' + sub.link + '`',
        { parse_mode: 'Markdown' },
      );
    }
    await ctx.reply('Меню:', mainMenu());
  });

  bot.action(/^plan:(.+)$/, (ctx) => startBuy(ctx, ctx.match[1]));

  bot.action(/^confirm:(.+)$/, async (ctx) => {
    if (!config.allowMockPay) return ctx.answerCbQuery('Демо-оплата отключена');
    await ctx.answerCbQuery('Подтверждаем оплату…');
    try {
      const sub = await fulfillOrder(ctx.match[1], { method: 'mock' });
      notifyAdmins(ctx.telegram, `💸 Демо-оплата: @${ctx.from.username || ctx.from.id} — ${sub.planName}`);
      await sendSubscription(ctx, sub);
    } catch (e) {
      await ctx.reply('Ошибка: ' + e.message);
    }
  });

  // Оплата инвойсом
  bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true).catch(() => {}));

  bot.on(message('successful_payment'), async (ctx) => {
    const orderId = ctx.message.successful_payment.invoice_payload;
    try {
      const sub = await fulfillOrder(orderId, {
        method: config.bot.payment,
        charge: ctx.message.successful_payment.telegram_payment_charge_id,
      });
      notifyAdmins(ctx.telegram, `💰 Оплата: @${ctx.from.username || ctx.from.id} — ${sub.planName}`);
      await sendSubscription(ctx, sub);
    } catch (e) {
      await ctx.reply('Оплата прошла, но выдать подписку не удалось: ' + e.message + '\nНапишите в поддержку.');
    }
  });

  bot.on(message('text'), async (ctx) => {
    await ctx.reply('Выберите действие в меню:', mainMenu());
  });

  bot.catch((err) => console.error('Ошибка бота:', err));

  // getMe перед запуском, чтобы узнать username; launch — в фоне.
  bot.botInfo = await bot.telegram.getMe();
  bot.launch();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}
