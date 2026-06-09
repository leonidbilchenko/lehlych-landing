// ─── Checkout ─────────────────────────────────────────────
// URL Apps Script (встав після деплою бекенду):
const CHECKOUT_URL = 'https://script.google.com/macros/s/AKfycbwMR4ohnguTxkzUdoqDDERrM3caroSHZ99Ry8LUYguqVOboGpXp4GV60x2NLxzqQrtNVQ/exec';

// Тестовий режим: true — оплата вимкнена. false — оплата через LiqPay.
const TEST_MODE = true;

// Рендер підсумку з кошика
function renderSummary() {
  const cart = getCart();
  const slugs = Object.keys(cart);
  const box = document.getElementById('summaryItems');
  if (!slugs.length) {
    box.innerHTML = '<p class="summary-empty">Кошик порожній. <a href="/#wines">Перейти до вин →</a></p>';
    document.getElementById('payBtn').disabled = true;
    document.getElementById('summaryTotal').textContent = '0 грн';
    return;
  }
  let total = 0;
  box.innerHTML = slugs.map(slug => {
    const p = product(slug);
    if (!p) return '';
    const q = cart[slug];
    const sum = p.price * q;
    total += sum;
    return `<div class="summary-item">
      <img src="${p.photo}" alt="${p.name}">
      <div class="summary-item-body">
        <span class="summary-item-name">${p.name}</span>
        <span class="summary-item-qty">${p.price} грн × ${q}</span>
      </div>
      <span class="summary-item-sum">${sum} грн</span>
    </div>`;
  }).join('');
  document.getElementById('summaryTotal').textContent = total + ' грн';
}

function buildOrderItems() {
  const cart = getCart();
  return Object.keys(cart).map(slug => {
    const p = product(slug);
    return { slug, name: p.name, qty: cart[slug], price: p.price };
  });
}
function orderTotal() {
  const cart = getCart();
  return Object.keys(cart).reduce((s, slug) => s + (product(slug)?.price || 0) * cart[slug], 0);
}

function checkoutStatus(msg, type) {
  const el = document.getElementById('checkoutStatus');
  el.textContent = msg;
  el.className = 'checkout-status ' + type;
  el.hidden = false;
}

// Сабміт у LiqPay (редірект на сторінку оплати)
function payLiqpay(data, signature) {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = 'https://www.liqpay.ua/api/3/checkout';
  f.acceptCharset = 'utf-8';
  f.innerHTML = `<input type="hidden" name="data" value="${data}">
                 <input type="hidden" name="signature" value="${signature}">`;
  document.body.appendChild(f);
  f.submit();
}

document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const order = {
    action: 'createOrder',
    lastName: document.getElementById('fLastName').value.trim(),
    firstName: document.getElementById('fFirstName').value.trim(),
    phone: document.getElementById('fPhone').value.trim(),
    email: document.getElementById('fEmail').value.trim(),
    cityName: document.getElementById('fCity').value.trim(),
    warehouseName: document.getElementById('fWarehouse').value.trim(),
    comment: document.getElementById('fComment').value.trim(),
    items: buildOrderItems(),
    total: orderTotal(),
  };

  if (!order.lastName || !order.firstName || !order.phone || !order.email || !order.cityName || !order.warehouseName) {
    checkoutStatus('Будь ласка, заповніть усі обов\'язкові поля.', 'error');
    return;
  }
  if (!order.items.length) {
    checkoutStatus('Кошик порожній.', 'error');
    return;
  }

  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  btn.querySelector('.pay-label').hidden = true;
  btn.querySelector('.pay-spinner').hidden = false;

  if (CHECKOUT_URL === 'YOUR_GOOGLE_SCRIPT_URL_HERE') {
    checkoutStatus('✓ Дані коректні. Бекенд (оплата) ще не підключено — це наступний крок.', 'error');
    btn.disabled = false;
    btn.querySelector('.pay-label').hidden = false;
    btn.querySelector('.pay-spinner').hidden = true;
    return;
  }

  try {
    const res = await fetch(CHECKOUT_URL, { method: 'POST', body: JSON.stringify(order) });
    const j = await res.json();
    if (j.status === 'ok' && j.data && j.signature) {
      payLiqpay(j.data, j.signature); // редірект на LiqPay
    } else {
      throw new Error(j.message || 'order failed');
    }
  } catch (err) {
    checkoutStatus('Сталася помилка. Спробуйте ще раз або напишіть нам у соцмережах.', 'error');
    btn.disabled = false;
    btn.querySelector('.pay-label').hidden = false;
    btn.querySelector('.pay-spinner').hidden = true;
  }
});

// Кнопка активна лише коли є товари і обидві галочки
function updatePayButton() {
  if (TEST_MODE) { document.getElementById('payBtn').disabled = true; return; }
  const hasItems = Object.keys(getCart()).length > 0;
  const agreed = document.getElementById('agreeTerms').checked;
  document.getElementById('payBtn').disabled = !(hasItems && agreed);
}
document.getElementById('agreeTerms').addEventListener('change', updatePayButton);

renderSummary();
updatePayButton();

if (TEST_MODE) {
  const el = document.getElementById('checkoutStatus');
  el.textContent = '🍇 Магазин готується до відкриття — онлайн-оплата тимчасово недоступна. Зовсім скоро запускаємо продаж! Слідкуйте за новинами в Instagram.';
  el.className = 'checkout-status info';
  el.hidden = false;
}
