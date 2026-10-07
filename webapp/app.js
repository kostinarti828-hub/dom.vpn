const plansContainer = document.querySelector('#plans');
const planCount = document.querySelector('#plan-count');
const selectionTitle = document.querySelector('#selection-title');
const buttonPrice = document.querySelector('#button-price');
const orderButton = document.querySelector('#order-button');
const loadError = document.querySelector('#load-error');
const appStatus = document.querySelector('#app-status');
const telegram = window.Telegram?.WebApp;

let plans = [];
let currency = '₽';
let selectedPlanId = '';

if (telegram) {
  telegram.ready();
  telegram.expand();
}

function money(value) {
  const amount = Number(value);
  return `${Number.isFinite(amount) ? amount.toLocaleString('ru-RU') : value} ${currency}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function selectedPlan() {
  return plans.find((plan) => plan.id === selectedPlanId);
}

function render() {
  plansContainer.innerHTML = plans.map((plan, index) => `
    <button class="plan-card" type="button" data-plan-id="${escapeHtml(plan.id)}" aria-pressed="${plan.id === selectedPlanId}">
      <span class="plan-card-top">
        <span class="plan-index">0${index + 1} / DOM.VPN</span>
        ${plan.id === '12m' ? '<span class="plan-badge">12 МЕСЯЦЕВ</span>' : ''}
      </span>
      <span class="plan-title">${escapeHtml(plan.title)}</span>
      <span class="plan-card-bottom">
        <span class="plan-price">${money(plan.price)}</span>
        <span class="plan-check" aria-hidden="true">✓</span>
      </span>
    </button>`).join('');

  const current = selectedPlan();
  selectionTitle.textContent = current ? current.title : 'Выберите тариф';
  buttonPrice.textContent = current ? money(current.price) : '—';
  orderButton.disabled = !current;
  planCount.textContent = `${plans.length} тарифа`;
}

plansContainer.addEventListener('click', (event) => {
  const card = event.target.closest('[data-plan-id]');
  if (!card) return;
  selectedPlanId = card.dataset.planId;
  appStatus.textContent = '';
  render();
});

orderButton.addEventListener('click', () => {
  const current = selectedPlan();
  if (!current) return;
  if (!telegram || typeof telegram.sendData !== 'function') {
    appStatus.textContent = 'Откройте магазин кнопкой «Открыть магазин» в чате с Dom.VPN.';
    return;
  }

  orderButton.disabled = true;
  appStatus.textContent = 'Возвращаем вас в чат для оформления заявки…';
  telegram.sendData(JSON.stringify({ action: 'order', planId: current.id }));
});

fetch('/api/plans', { cache: 'no-store' })
  .then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить тарифы');
    return response.json();
  })
  .then((catalog) => {
    plans = Array.isArray(catalog.plans) ? catalog.plans : [];
    currency = typeof catalog.currency === 'string' ? catalog.currency : currency;
    if (plans.length === 0) throw new Error('Тарифы не настроены');
    selectedPlanId = plans[0].id;
    render();
  })
  .catch(() => {
    loadError.hidden = false;
    planCount.textContent = 'Ошибка загрузки';
    orderButton.disabled = true;
  });