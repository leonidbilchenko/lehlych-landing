// ─── Checkout (Нова Пошта + LiqPay) ───────────────────────
const CHECKOUT_URL = 'https://script.google.com/macros/s/AKfycbwMR4ohnguTxkzUdoqDDERrM3caroSHZ99Ry8LUYguqVOboGpXp4GV60x2NLxzqQrtNVQ/exec';

// Тестовий режим: true — оплата вимкнена. false — оплата через LiqPay.
const TEST_MODE = false;

function $(id) { return document.getElementById(id); }
function val(id) { return ($(id)?.value || '').trim(); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
// екранування для безпечної вставки в HTML-атрибути й текст (назви містять лапки!)
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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
        <span class="summary-item-price">${p.price} грн</span>
        <div class="summary-qty">
          <button type="button" onclick="ckQty('${slug}', ${q - 1})" aria-label="Менше">−</button>
          <span>${q}</span>
          <button type="button" onclick="ckQty('${slug}', ${q + 1})" aria-label="Більше">+</button>
          <button type="button" class="summary-remove" onclick="ckRemove('${slug}')" aria-label="Видалити" title="Видалити">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
      <span class="summary-item-sum">${sum} грн</span>
    </div>`;
  }).join('');
  $('checkoutTotal').textContent = total + ' грн';
  updatePayButton();
}

// Зміна кількості / видалення прямо в підсумку
function ckQty(slug, qty) { setCartQty(slug, qty); renderSummary(); }
function ckRemove(slug) { removeFromCart(slug); renderSummary(); }
function orderItems() {
  const c = getCart();
  return Object.keys(c).map(s => { const p = product(s); return { slug: s, name: p.name, qty: c[s], price: p.price, liqpayId: p.liqpayId }; });
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
      `<li data-ref="${esc(c.ref)}" data-name="${esc(c.name + (c.area ? ' (' + c.area + ')' : ''))}" onclick="pickCity(this)">${esc(c.name)}${c.area ? ' · ' + esc(c.area) : ''}</li>`
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
    // якщо це «Поштомат/Відділення + номер» — шукаємо лише за номером
    const m = q.match(/^(?:поштомат|відділення|нова\s*пошта|нп)?\s*[№#nN]?\s*(\d+)\s*$/i);
    const apiQ = m ? m[1] : q;
    const items = await npFetch('action=npWarehouses&cityRef=' + encodeURIComponent(ref) + '&q=' + encodeURIComponent(apiQ));
    warehouseList.innerHTML = items.map(w =>
      `<li data-ref="${esc(w.ref)}" data-name="${esc(w.name)}" onclick="pickWarehouse(this)">${esc(w.name)}</li>`
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
  if (order.phone.replace(/\D/g, '').length !== 12) {
    cstatus('Введіть коректний номер телефону (9 цифр після +380).', 'error'); return;
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

// ─── Телефон: фіксований +380, далі лише 9 цифр ───────────
const fPhone = $('fPhone');
if (fPhone) {
  const normPhone = () => {
    let d = fPhone.value.replace(/\D/g, '');     // лишаємо цифри
    if (d.startsWith('380')) d = d.slice(3);      // прибираємо код, якщо ввели
    d = d.slice(0, 9);                            // максимум 9 цифр
    fPhone.value = '+380' + d;
  };
  fPhone.addEventListener('input', normPhone);
  fPhone.addEventListener('focus', () => { if (!fPhone.value) fPhone.value = '+380'; });
  // не дати стерти префікс клавішами
  fPhone.addEventListener('keydown', e => {
    if ((e.key === 'Backspace' || e.key === 'Delete') &&
        fPhone.selectionStart <= 4 && fPhone.selectionEnd <= 4) {
      e.preventDefault();
    }
  });
}

// ─── Відновлення замовлення з листа (?recover=) ───────────
(function tryRecover() {
  const r = new URLSearchParams(location.search).get('recover');
  if (!r) return;
  try {
    const bytes = Uint8Array.from(atob(decodeURIComponent(r)), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    // відновлюємо кошик
    if (Array.isArray(data.items) && data.items.length) {
      const cart = {};
      data.items.forEach(it => { if (it.slug) cart[it.slug] = it.qty; });
      localStorage.setItem('lehlych_cart', JSON.stringify(cart));
    }
    // підставляємо поля, які клієнт уже заповнював
    const set = (id, v) => { const el = $(id); if (el && v) el.value = v; };
    set('fLastName', data.lastName); set('fFirstName', data.firstName);
    set('fPhone', data.phone); set('fEmail', data.email);
    set('fCity', data.city); set('fWarehouse', data.warehouse);
    set('fComment', data.comment);
    const wh = $('fWarehouse'); if (wh && data.warehouse) wh.disabled = false;
    // людина вже погоджувалась з офертою/політикою на першій спробі — ставимо галочку
    const agree = $('agreeTerms'); if (agree) agree.checked = true;
    // прибираємо recover з адреси (щоб не застосовувалось повторно)
    history.replaceState({}, '', location.pathname);
  } catch (e) { /* ігноруємо биті посилання */ }
})();

// init
renderSummary();
updatePayButton();
if (TEST_MODE) {
  cstatus('🍇 Магазин готується до відкриття — онлайн-оплата тимчасово недоступна. Зовсім скоро запускаємо продаж!', 'info');
}
