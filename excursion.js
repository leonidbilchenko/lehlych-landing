// ─── Екскурсії: слоти, лічильники, бронювання ─────────────
const EXC_URL = 'https://script.google.com/macros/s/AKfycbwMR4ohnguTxkzUdoqDDERrM3caroSHZ99Ry8LUYguqVOboGpXp4GV60x2NLxzqQrtNVQ/exec';

// Ціни: пільгові — 900, діти — 0. Ціна дорослого береться зі слота.
const PRICE_REDUCED = 900;

let excSelected = null;                       // обраний слот
const excQty = { adult: 0, veteran: 0, sober: 0, kids: 0 };

function e$(id) { return document.getElementById(id); }
function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function plural(n, one, few, many) {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return few;
  return many;
}

// ─── Список слотів ────────────────────────────────────────
function renderSlots() {
  const box = e$('excSlots');
  if (!box) return;
  const slots = window.EXCURSIONS || [];
  if (!slots.length) {
    box.innerHTML = '<p class="exc-empty">Найближчі дати зʼявляться незабаром. Стежте за нашими соцмережами.</p>';
    return;
  }
  box.innerHTML = slots.map(s => {
    const full = !s.bookable;
    const label = s.kind === 'Корпоративна'
      ? 'Група зібрана'
      : (s.free > 0
          ? `лишилось ${s.free} ${plural(s.free, 'місце', 'місця', 'місць')} з ${s.capacity}`
          : 'Група зібрана');
    return `<article class="exc-slot${full ? ' full' : ''}" data-id="${escHtml(s.id)}">
      <div class="exc-slot-main">
        <p class="exc-slot-date">${escHtml(s.dateHuman)}${s.time ? ' · ' + escHtml(s.time) : ''}</p>
        <p class="exc-slot-free">${label}</p>
      </div>
      <div class="exc-slot-side">
        <span class="exc-slot-price">${s.price} грн<small>/особа</small></span>
        ${full ? '<button class="exc-slot-btn out" disabled>Місць немає</button>'
               : `<button class="exc-slot-btn" onclick="pickSlot('${escHtml(s.id)}')">Обрати</button>`}
      </div>
    </article>`;
  }).join('');
}

// ─── Вибір слота → форма ──────────────────────────────────
function pickSlot(id) {
  const s = (window.EXCURSIONS || []).find(x => x.id === id);
  if (!s || !s.bookable) return;
  excSelected = s;
  excQty.adult = 1; excQty.veteran = 0; excQty.sober = 0; excQty.kids = 0;
  renderForm();
  e$('excForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function excSeats() { return excQty.adult + excQty.veteran + excQty.sober; }   // діти не рахуються
function excTotal() {
  const p = excSelected ? excSelected.price : 1200;
  return excQty.adult * p + (excQty.veteran + excQty.sober) * PRICE_REDUCED;
}

function excSet(kind, delta) {
  const next = excQty[kind] + delta;
  if (next < 0) return;
  // не більше вільних місць (діти не обмежені місткістю)
  if (kind !== 'kids' && delta > 0 && excSeats() >= excSelected.free) return;
  if (kind === 'kids' && next > 20) return;
  excQty[kind] = next;
  updateForm();
}

const EXC_ROWS = [
  { key: 'adult',   title: 'Дорослі',        note: 'повна вартість' },
  { key: 'veteran', title: 'Ветерани / УБД', note: 'посвідчення на місці' },
  { key: 'sober',   title: 'Без алкоголю',   note: 'без дегустації вина' },
  { key: 'kids',    title: 'Діти',           note: 'безкоштовно, місць не займають' },
];

function renderForm() {
  const wrap = e$('excForm');
  if (!wrap || !excSelected) return;
  const s = excSelected;
  const rows = EXC_ROWS.map(r => {
    const price = r.key === 'adult' ? s.price : (r.key === 'kids' ? 0 : PRICE_REDUCED);
    return `<div class="exc-row">
      <div class="exc-row-info">
        <span class="exc-row-title">${r.title}</span>
        <span class="exc-row-note">${price ? price + ' грн · ' : ''}${r.note}</span>
      </div>
      <div class="exc-counter">
        <button type="button" onclick="excSet('${r.key}',-1)" aria-label="Менше">−</button>
        <span id="q-${r.key}">0</span>
        <button type="button" onclick="excSet('${r.key}',1)" aria-label="Більше">+</button>
      </div>
    </div>`;
  }).join('');

  wrap.hidden = false;
  wrap.innerHTML = `
    <h2 class="exc-h2">Бронювання</h2>
    <p class="exc-chosen">${escHtml(s.dateHuman)}${s.time ? ' · ' + escHtml(s.time) : ''}
      <button type="button" class="exc-change" onclick="excClear()">змінити</button></p>
    <div class="exc-rows">${rows}</div>
    <div class="exc-sum"><span>Разом</span><span id="excTotal">0 грн</span></div>
    <p class="exc-seats-left" id="excLeft"></p>

    <div class="form-row">
      <div class="form-group"><label for="eLastName">Прізвище *</label>
        <input type="text" id="eLastName" placeholder="Шевченко" required></div>
      <div class="form-group"><label for="eFirstName">Ім'я *</label>
        <input type="text" id="eFirstName" placeholder="Тарас" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label for="ePhone">Телефон *</label>
        <input type="tel" id="ePhone" value="+380" required></div>
      <div class="form-group"><label for="eEmail">Email *</label>
        <input type="email" id="eEmail" placeholder="email@example.com" required></div>
    </div>
    <div class="form-group"><label for="eComment">Коментар</label>
      <textarea id="eComment" rows="2" placeholder="Побажання (необовʼязково)"></textarea></div>

    <div class="checkout-agree">
      <label class="agree-item">
        <input type="checkbox" id="eAgree">
        <span>Я приймаю <a href="../oferta-excursion/" target="_blank" rel="noopener">умови надання послуг</a> та <a href="https://bilchenko-bm.notion.site/378dec54c7e680b29832fe6d92147636" target="_blank" rel="noopener">політику конфіденційності</a>.</span>
      </label>
    </div>
    <button type="button" class="pay-btn" id="excPayBtn" onclick="excSubmit()" disabled>
      <span class="pay-label">Перейти до оплати</span>
      <span class="pay-spinner" hidden>Зачекайте…</span>
    </button>
    <div class="form-status" id="excStatus" hidden></div>`;

  bindPhone(e$('ePhone'));
  updateForm();
}

function excClear() {
  excSelected = null;
  const w = e$('excForm');
  if (w) { w.hidden = true; w.innerHTML = ''; }
  e$('dates').scrollIntoView({ behavior: 'smooth' });
}

function updateForm() {
  if (!excSelected) return;
  EXC_ROWS.forEach(r => { const el = e$('q-' + r.key); if (el) el.textContent = excQty[r.key]; });
  const t = e$('excTotal'); if (t) t.textContent = excTotal() + ' грн';
  const left = excSelected.free - excSeats();
  const l = e$('excLeft');
  if (l) l.textContent = left <= 3 ? `Залишилось ${left} ${plural(left, 'місце', 'місця', 'місць')}` : '';
  const btn = e$('excPayBtn');
  const agree = e$('eAgree');
  if (btn) btn.disabled = !(excSeats() > 0 && agree && agree.checked);
}
document.addEventListener('change', e => { if (e.target && e.target.id === 'eAgree') updateForm(); });

// ─── Телефон: фіксований +380 ─────────────────────────────
function bindPhone(input) {
  if (!input) return;
  const norm = () => {
    let d = input.value.replace(/\D/g, '');
    if (d.startsWith('380')) d = d.slice(3);
    input.value = '+380' + d.slice(0, 9);
  };
  input.addEventListener('input', norm);
  input.addEventListener('keydown', e => {
    if ((e.key === 'Backspace' || e.key === 'Delete') &&
        input.selectionStart <= 4 && input.selectionEnd <= 4) e.preventDefault();
  });
}

function excStatus(msg, type) {
  const el = e$('excStatus');
  if (!el) return;
  el.textContent = msg; el.className = 'form-status ' + type; el.hidden = false;
}

// ─── Відправка ────────────────────────────────────────────
async function excSubmit() {
  if (!excSelected) return;
  const val = id => (e$(id)?.value || '').trim();
  const order = {
    action: 'createBooking',
    slotId: excSelected.id,
    slotDate: excSelected.date,
    slotTime: excSelected.time,
    kind: excSelected.kind,
    adults: excQty.adult, veterans: excQty.veteran, sober: excQty.sober, kids: excQty.kids,
    seats: excSeats(), total: excTotal(),
    lastName: val('eLastName'), firstName: val('eFirstName'),
    phone: val('ePhone'), email: val('eEmail'), comment: val('eComment'),
  };
  if (!order.lastName || !order.firstName || !order.phone || !order.email) {
    excStatus('Будь ласка, заповніть усі обовʼязкові поля.', 'error'); return;
  }
  if (order.phone.replace(/\D/g, '').length !== 12) {
    excStatus('Введіть коректний номер телефону (9 цифр після +380).', 'error'); return;
  }
  if (order.seats < 1) { excStatus('Оберіть хоча б одне місце.', 'error'); return; }

  const btn = e$('excPayBtn');
  btn.disabled = true;
  btn.querySelector('.pay-label').hidden = true;
  btn.querySelector('.pay-spinner').hidden = false;
  try {
    const res = await fetch(EXC_URL, { method: 'POST', body: JSON.stringify(order) });
    const j = await res.json();
    if (j.status === 'ok' && j.payUrl) {
      location.href = j.payUrl;                 // сторінка оплати Monobank
    } else if (j.status === 'ok') {
      excStatus('Заявку прийнято! Ми звʼяжемось із вами найближчим часом.', 'info');
    } else { throw new Error(j.message || 'fail'); }
  } catch (err) {
    excStatus('Сталася помилка. Спробуйте ще раз або напишіть нам у Direct.', 'error');
    btn.disabled = false;
    btn.querySelector('.pay-label').hidden = false;
    btn.querySelector('.pay-spinner').hidden = true;
  }
}

renderSlots();
