require('dotenv').config();

const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const express = require('express');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error('Укажите TELEGRAM_BOT_TOKEN в файле .env.');
  process.exit(1);
}

const adminChatId = process.env.ADMIN_CHAT_ID?.trim();
const webAppUrl = process.env.WEB_APP_URL?.trim();
const port = Number(process.env.PORT) || 3000;
const currency = process.env.CURRENCY?.trim() || '₽';
const supportUsername = process.env.SUPPORT_USERNAME?.trim().replace(/^@/, '');
const plans = [
  { id: '1m', title: '1 месяц', price: process.env.PRICE_1M?.trim() || '100' },
  { id: '3m', title: '3 месяца', price: process.env.PRICE_3M?.trim() || '300' },
  { id: '6m', title: '6 месяцев', price: process.env.PRICE_6M?.trim() || '600' },
  { id: '12m', title: '1 год', price: process.env.PRICE_12M?.trim() || '1200' },
];

const bot = new Bot(token);
const pendingOrders = new Map();
const web = express();

if (webAppUrl) {
  let parsedWebAppUrl;
  try {
    parsedWebAppUrl = new URL(webAppUrl);
  } catch {
    console.error('WEB_APP_URL должен быть полным HTTPS URL.');
    process.exit(1);
  }
  if (parsedWebAppUrl.protocol !== 'https:') {
    console.error('WEB_APP_URL должен использовать HTTPS.');
    process.exit(1);
  }
}

web.get('/api/plans', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ currency, plans });
});
web.use(express.static(path.join(__dirname, 'webapp')));
web.listen(port, '0.0.0.0', () => {
  console.log(`Dom.VPN Mini App server listening on port ${port}.`);
});

function tariffKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const plan of plans) {
    keyboard.text(plan.title, `plan:${plan.id}`).row();
  }
  if (supportUsername) {
    keyboard.url('Поддержка', `https://t.me/${supportUsername}`);
  }
  return keyboard;
}

function planById(id) {
  return plans.find((plan) => plan.id === id);
}

bot.command('start', async (ctx) => {
  if (webAppUrl) {
    await ctx.reply('Dom.VPN\nОткройте магазин и выберите срок подписки:', {
      reply_markup: new Keyboard().webApp('Открыть магазин', webAppUrl).resized().persistent(),
    });
    return;
  }
  await ctx.reply('Dom.VPN\nВыберите тариф. Для Mini App задайте WEB_APP_URL в .env:', {
    reply_markup: tariffKeyboard(),
  });
});

bot.command('id', async (ctx) => {
  await ctx.reply(`Ваш Telegram ID: ${ctx.chat.id}`);
});

bot.command('cancel', async (ctx) => {
  pendingOrders.delete(ctx.from.id);
  await ctx.reply('Заявка отменена.', { reply_markup: { remove_keyboard: true } });
});

bot.callbackQuery('tariffs', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('Dom.VPN\nВыберите срок подписки:', {
    reply_markup: tariffKeyboard(),
  });
});

bot.callbackQuery(/^plan:(.+)$/, async (ctx) => {
  const plan = planById(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!plan) {
    await ctx.reply('Этот тариф сейчас недоступен. Откройте /start и выберите другой.');
    return;
  }

  const priceText = plan.price
    ? `Стоимость: ${plan.price} ${currency}`
    : 'Стоимость уточнит менеджер';
  const keyboard = new InlineKeyboard()
    .text('Оставить заявку', `order:${plan.id}`)
    .row()
    .text('Назад к тарифам', 'tariffs');

  await ctx.editMessageText(`Dom.VPN · ${plan.title}\n${priceText}`, {
    reply_markup: keyboard,
  });
});

bot.callbackQuery(/^order:(.+)$/, async (ctx) => {
  const plan = planById(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!plan) {
    await ctx.reply('Этот тариф сейчас недоступен. Откройте /start и выберите другой.');
    return;
  }
  if (!adminChatId) {
    await ctx.reply('Приём заявок пока не настроен. Напишите в поддержку.', {
      reply_markup: supportUsername
        ? new InlineKeyboard().url('Написать в поддержку', `https://t.me/${supportUsername}`)
        : undefined,
    });
    return;
  }

  await requestOrderContact(ctx, plan);
});

async function requestOrderContact(ctx, plan) {
  if (!adminChatId) {
    await ctx.reply('Приём заявок пока не настроен. Напишите в поддержку.', {
      reply_markup: supportUsername
        ? new InlineKeyboard().url('Написать в поддержку', `https://t.me/${supportUsername}`)
        : undefined,
    });
    return;
  }

  pendingOrders.set(ctx.from.id, plan.id);
  await ctx.reply(
    `Вы выбрали «${plan.title}» за ${plan.price} ${currency}.\n` +
      'Для заявки отправьте свой номер кнопкой ниже. Менеджер свяжется для оплаты и подключения. Для отмены отправьте /cancel.',
    { reply_markup: new Keyboard().requestContact('Отправить номер телефона').resized().oneTime() },
  );
}

bot.on('message:web_app_data', async (ctx) => {
  let data;
  try {
    data = JSON.parse(ctx.message.web_app_data.data);
  } catch {
    await ctx.reply('Не удалось прочитать заказ. Откройте магазин и попробуйте ещё раз.');
    return;
  }

  if (data?.action !== 'order' || typeof data.planId !== 'string') {
    await ctx.reply('Неизвестный заказ. Откройте магазин и выберите тариф заново.');
    return;
  }

  const plan = planById(data.planId);
  if (!plan) {
    await ctx.reply('Этот тариф недоступен. Откройте магазин и выберите другой.');
    return;
  }

  await requestOrderContact(ctx, plan);
});

bot.on('message:contact', async (ctx) => {
  const planId = pendingOrders.get(ctx.from.id);
  if (!planId) return;

  const contact = ctx.message.contact;
  if (contact.user_id !== ctx.from.id) {
    await ctx.reply('Пожалуйста, отправьте свой номер через кнопку Telegram.');
    return;
  }

  const plan = planById(planId);
  if (!plan) {
    pendingOrders.delete(ctx.from.id);
    await ctx.reply('Тариф больше недоступен. Откройте /start, чтобы посмотреть варианты.', {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  const username = ctx.from.username ? `@${ctx.from.username}` : 'не указан';
  const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
  await bot.api.sendMessage(
    adminChatId,
    [
      'Новая заявка Dom.VPN',
      `Тариф: ${plan.title}`,
      `Клиент: ${fullName || 'не указано'}`,
      `Username: ${username}`,
      `Телефон: ${contact.phone_number}`,
      `Telegram ID: ${ctx.from.id}`,
    ].join('\n'),
  );

  pendingOrders.delete(ctx.from.id);
  await ctx.reply('Заявка отправлена менеджеру. Он свяжется с вами для оплаты и подключения.', {
    reply_markup: { remove_keyboard: true },
  });
});

bot.catch((error) => {
  console.error('Ошибка Telegram-бота:', error.message);
});

bot.start();
console.log('Dom.VPN бот запущен.');