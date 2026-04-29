// ─── Google Sheets / Apps Script endpoint ────────────────
// Після налаштування Apps Script вставте URL сюди:
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwBbOR2lmywPl08mcwYhW49uy97Rp3CgwLDjkQeLse0SXj3_ycvwbhWisuVwiE_lR7bzw/exec';

// ─── Sticky header ────────────────────────────────────────
const heroLogo    = document.getElementById('heroLogo');
const stickyHeader = document.getElementById('stickyHeader');

const observer = new IntersectionObserver(
  ([entry]) => {
    stickyHeader.classList.toggle('visible', !entry.isIntersecting);
  },
  { threshold: 0.1 }
);
observer.observe(heroLogo);

// ─── Quantity controls ────────────────────────────────────
function changeQty(btn, delta) {
  const input = btn.parentElement.querySelector('.qty-input');
  const next  = Math.max(0, Math.min(99, parseInt(input.value || 0) + delta));
  input.value = next;
  syncWine(input.dataset.wine, next);
  updateSummary();
}

function syncWine(wine, val) {
  document.querySelectorAll(`.qty-input[data-wine="${wine}"]`).forEach(el => {
    el.value = val;
  });
}

document.querySelectorAll('.qty-input').forEach(input => {
  input.addEventListener('change', () => {
    const val = Math.max(0, Math.min(99, parseInt(input.value || 0)));
    input.value = val;
    syncWine(input.dataset.wine, val);
    updateSummary();
  });
});

// ─── Summary bar ──────────────────────────────────────────
function getQty(wine) {
  return parseInt(document.querySelector(`.qty-input[data-wine="${wine}"]`)?.value || 0);
}

function updateSummary() {
  const chard = getQty('chardonnay');
  const sauv  = getQty('sauvignon');
  const trip  = getQty('trpilske');
  const total = chard + sauv + trip;
  const text  = document.getElementById('summaryText');

  if (!total) { text.textContent = 'Оберіть вина вище'; return; }

  const parts = [];
  if (chard) parts.push(`Chardonnay ×${chard}`);
  if (sauv)  parts.push(`Sauvignon Blanc ×${sauv}`);
  if (trip)  parts.push(`Трипільське Сонце ×${trip}`);
  text.textContent = parts.join(' · ') + ` — ${total} пляш${plural(total)}`;
}

function plural(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'ка';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'ки';
  return 'ок';
}

// ─── Form submit ──────────────────────────────────────────
document.getElementById('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const lastName   = document.getElementById('fLastName').value.trim();
  const firstName  = document.getElementById('fFirstName').value.trim();
  const phone      = document.getElementById('fPhone').value.trim();
  const email      = document.getElementById('fEmail').value.trim();
  const city       = document.getElementById('fCity').value.trim();
  const novaPoshta = document.getElementById('fNovaPoshta').value.trim();
  const comment    = document.getElementById('fComment').value.trim();

  const chard = parseInt(document.getElementById('fQtyChardonnay').value || 0);
  const sauv  = parseInt(document.getElementById('fQtySauvignon').value || 0);
  const trip  = parseInt(document.getElementById('fQtyTrpilske').value || 0);

  if (!lastName || !firstName || !phone || !email || !city || !novaPoshta) {
    showStatus('Будь ласка, заповніть усі обов\'язкові поля.', 'error');
    return;
  }
  if (chard + sauv + trip === 0) {
    showStatus('Оберіть хоча б одну пляшку вина.', 'error');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.querySelector('.submit-label').hidden = true;
  btn.querySelector('.submit-spinner').hidden = false;

  const payload = {
    lastName, firstName, phone, email, city, novaPoshta, comment,
    chardonnay: chard, sauvignon: sauv, trpilske: trip
  };

  try {
    if (GOOGLE_SCRIPT_URL === 'YOUR_GOOGLE_SCRIPT_URL_HERE') {
      await new Promise(r => setTimeout(r, 900));
      onSuccess(firstName);
    } else {
      const res  = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.status === 'ok') onSuccess(firstName);
      else throw new Error();
    }
  } catch {
    showStatus('Сталася помилка. Спробуйте ще раз або напишіть нам у соцмережах.', 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.submit-label').hidden = false;
    btn.querySelector('.submit-spinner').hidden = true;
  }
});

function onSuccess(firstName) {
  showStatus(
    `Дякуємо, ${firstName}! Ваше передзамовлення прийнято. Лист-підтвердження вже летить на вашу пошту.`,
    'success'
  );
  document.getElementById('orderForm').reset();
  document.querySelectorAll('.qty-input').forEach(el => el.value = 0);
  updateSummary();
}

function showStatus(msg, type) {
  const el = document.getElementById('formStatus');
  el.textContent = msg;
  el.className   = `form-status ${type}`;
  el.hidden      = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
