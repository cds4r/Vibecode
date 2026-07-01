// Тарифы подписок. Цены: priceRub — для оплаты провайдером/на сайте,
// priceStars — количество звёзд Telegram. trafficGb: 0 = безлимит.
export const plans = [
  {
    id: 'trial',
    name: 'Пробный',
    months: 0,
    days: 3,
    priceRub: 0,
    priceStars: 0,
    trafficGb: 5,
    devices: 1,
    highlight: false,
    features: ['3 дня доступа', 'До 5 ГБ трафика', '1 устройство', 'Все локации'],
    description: 'Попробуйте бесплатно перед покупкой.',
  },
  {
    id: 'm1',
    name: '1 месяц',
    months: 1,
    days: 0,
    priceRub: 149,
    priceStars: 75,
    trafficGb: 0,
    devices: 3,
    highlight: false,
    features: ['30 дней доступа', 'Безлимитный трафик', 'До 3 устройств', 'Скорость до 1 Гбит/с'],
    description: 'Идеально, чтобы начать.',
  },
  {
    id: 'm3',
    name: '3 месяца',
    months: 3,
    days: 0,
    priceRub: 379,
    priceStars: 190,
    trafficGb: 0,
    devices: 5,
    highlight: true,
    badge: 'Выгодно',
    features: ['90 дней доступа', 'Безлимитный трафик', 'До 5 устройств', 'Приоритетная поддержка'],
    description: 'Экономия 15% по сравнению с помесячной.',
  },
  {
    id: 'm6',
    name: '6 месяцев',
    months: 6,
    days: 0,
    priceRub: 690,
    priceStars: 345,
    trafficGb: 0,
    devices: 5,
    highlight: false,
    features: ['180 дней доступа', 'Безлимитный трафик', 'До 5 устройств', 'Приоритетная поддержка'],
    description: 'Оптимальный баланс цены и срока.',
  },
  {
    id: 'y1',
    name: '1 год',
    months: 12,
    days: 0,
    priceRub: 1190,
    priceStars: 595,
    trafficGb: 0,
    devices: 10,
    highlight: false,
    badge: 'Максимум',
    features: ['365 дней доступа', 'Безлимитный трафик', 'До 10 устройств', 'Максимальная экономия'],
    description: 'Лучшая цена за день использования.',
  },
];

export const getPlan = (id) => plans.find((p) => p.id === id) || null;

export function planDurationMs(plan) {
  const days = (plan.days || 0) + (plan.months || 0) * 30;
  return days * 24 * 60 * 60 * 1000;
}

export function planDurationDays(plan) {
  return (plan.days || 0) + (plan.months || 0) * 30;
}
