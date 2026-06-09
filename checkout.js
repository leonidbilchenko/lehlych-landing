// ─── Checkout (Нова Пошта + LiqPay) ───────────────────────
const CHECKOUT_URL = 'https://script.google.com/macros/s/AKfycbwMR4ohnguTxkzUdoqDDERrM3caroSHZ99Ry8LUYguqVOboGpXp4GV60x2NLxzqQrtNVQ/exec';

// Тестовий режим: true — оплата вимкнена. false — оплата через LiqPay.
const TEST_MODE = true;

function $(id) { return document.getElementById(id); }
function val(id) { return ($(id)?.value || '').trim(); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ─── Підсумок замовлення ──────────────────────────────────
function renderSummary() {
  const cart = getCart();
  const slugs = Object.keys(cart);
  const box = $('checkoutItems');
  if (!box) return;
  if (!slugs.length) {
    box.innerHTML = '<p class="summary-empty">Кошик порожній. <a href="/#wines">Перейти до вин →</a></p>';
    $('checkoutTotal').textContent = '0 грн';
    updatePayButton();
    return;
  }
  let total = 0;
  box.innerHTML = slugs.map(slug => {
    const p = product(slug); if (!p) return '';
    const q = cart[slug]; const sum = p.price * q; total += sum;
    return `<div class="summary-item">
      <img src="${p.photo}" alt="${p.name}">
      <div class="summary-item-body">
        <span class="summary-item-name">${p.name}</span>
        <span class="summary-item-qty">${p.price} грн × ${q}</span>
      </div>
      <span class="summary-item-sum">${sum} грн</span>
    </div>`;
  }).join('');
  $('checkoutTotal').textContent = total + ' грн';
  updatePayButton();
}
function orderItems() {
  const c = getCart();
  return Object.keys(c).map(s => { const p = product(s); return { slug: s, name: p.name, qty: c[s], price: p.price }; });
}
function orderTotal() {
  const c = getCart();
  return Object.keys(c).reduce((t, s) => t + (product(s)?.price || 0) * c[s], 0);
}

function cstatus(msg, type) {
  const el = $('checkoutStatus');
  el.textContent = msg;
  el.className = 'form-status ' + type;
  el.hidden = false;
}

// ─── Нова Пошта — автодоповнення (graceful, працює й без ключа) ──
async function npFetch(params) {
  try {
    const res = await fetch(CHECKOUT_URL + '?' + params);
    const j = await res.json();
    return j.items || [];
  } catch (e) { return []; }
}

const fCity = $('fCity'), cityList = $('cityList');
const fWarehouse = $('fWarehouse'), warehouseList = $('warehouseList');

if (fCity) {
  fCity.addEventListener('input', debounce(async () => {
    $('fCityRef').value = '';
    const q = fCity.value.trim();
    // дозволяємо ручне введення: щойно є місто — відкриваємо поле відділення
    if (q.length >= 2 && fWarehouse) {
      fWarehouse.disabled = false;
      fWarehouse.placeholder = '№ відділення або адреса';
    }
    if (q.length < 2) { cityList.innerHTML = ''; return; }
    const items = await npFetch('action=npCities&q=' + encodeURIComponent(q));
    cityList.innerHTML = items.map(c =>
      `<li data-ref="${c.ref}" data-name="${c.name}${c.area ? ' (' + c.area + ')' : ''}" onclick="pickCity(this)">${c.name}${c.area ? ' · ' + c.area : ''}</li>`
    ).join('');
  }, 300));
}
function pickCity(li) {
  fCity.value = li.getAttribute('data-name');
  $('fCityRef').value = li.getAttribute('data-ref');
  cityList.innerHTML = '';
  fWarehouse.disabled = false;
  fWarehouse.placeholder = 'Почніть вводити відділення…';
}
if (fWarehouse) {
  fWarehouse.addEventListener('input', debounce(async () => {
    $('fWarehouseRef').value = '';
    const ref = $('fCityRef').value;
    const q = fWarehouse.value.trim();
    if (!ref || q.length < 1) { warehouseList.innerHTML = ''; return; }
    const items = await npFetch('action=npWarehouses&cityRef=' + encodeURIComponent(ref) + '&q=' + encodeURIComponent(q));
    warehouseList.innerHTML = items.map(w =>
      `<li data-ref="${w.ref}" data-name="${w.name}" onclick="pickWarehouse(this)">${w.name}</li>`
    ).join('');
  }, 300));
}
function pickWarehouse(li) {
  fWarehouse.value = li.getAttribute('data-name');
  $('fWarehouseRef').value = li.getAttribute('data-ref');
  warehouseList.innerHTML = '';
}

// ─── Кнопка оплати (згода + наявність товарів) ────────────
function updatePayButton() {
  const btn = $('payBtn'); if (!btn) return;
  if (TEST_MODE) { btn.disabled = true; return; }
  const agree = $('agreeTerms');
  const agreed = agree ? agree.checked : true;
  btn.disabled = !(agreed && Object.keys(getCart()).length > 0);
}
document.addEventListener('change', e => { if (e.target && e.target.id === 'agreeTerms') updatePayButton(); });

// ─── Відправка → LiqPay ───────────────────────────────────
function payLiqpay(data, signature) {
  const f = document.createElement('form');
  f.method = 'POST'; f.action = 'https://www.liqpay.ua/api/3/checkout'; f.acceptCharset = 'utf-8';
  f.innerHTML = `<input type="hidden" name="data" value="${data}"><input type="hidden" name="signature" value="${signature}">`;
  document.body.appendChild(f); f.submit();
}

async function submitOrder() {
  if (TEST_MODE) return;
  const order = {
    action: 'createOrder',
    lastName: val('fLastName'), firstName: val('fFirstName'),
    phone: val('fPhone'), email: val('fEmail'),
    cityName: val('fCity'), warehouseName: val('fWarehouse'),
    comment: val('fComment'), items: orderItems(), total: orderTotal(),
  };
  if (!order.lastName || !order.firstName || !order.phone || !order.email || !order.cityName || !order.warehouseName) {
    cstatus('Будь ласка, заповніть усі обовʼязкові поля.', 'error'); return;
  }
  if (!order.items.length) { cstatus('Кошик порожній.', 'error'); return; }
  const agree = $('agreeTerms');
  if (agree && !agree.checked) { cstatus('Підтвердіть згоду з офертою та політикою.', 'error'); return; }

  const btn = $('payBtn');
  btn.disabled = true;
  btn.querySelector('.pay-label').hidden = true;
  btn.querySelector('.pay-spinner').hidden = false;
  try {
    const res = await fetch(CHECKOUT_URL, { method: 'POST', body: JSON.stringify(order) });
    const j = await res.json();
    if (j.status === 'ok' && j.data && j.signature) {
      payLiqpay(j.data, j.signature);
    } else { throw new Error(j.message || 'fail'); }
  } catch (e) {
    cstatus('Сталася помилка. Спробуйте ще раз або напишіть нам у соцмережах.', 'error');
    btn.disabled = false;
    btn.querySelector('.pay-label').hidden = false;
    btn.querySelector('.pay-spinner').hidden = true;
  }
}

// init
renderSummary();
updatePayButton();
if (TEST_MODE) {
  cstatus('🍇 Магазин готується до відкриття — онлайн-оплата тимчасово недоступна. Зовсім скоро запускаємо продаж!', 'info');
}
