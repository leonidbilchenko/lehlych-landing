// ─── Трекінг (запускається лише після згоди) ──────────────
const FB_PIXEL_ID = '1290089053109937';
const GA_ID = 'G-2MG7SKFQFF';
let trackingLoaded = false;

function loadTracking() {
  if (trackingLoaded) return;
  trackingLoaded = true;

  // Meta Pixel
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', FB_PIXEL_ID);
  fbq('track', 'PageView');

  // Google tag (GA4)
  const g = document.createElement('script');
  g.async = true;
  g.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(g);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA_ID);
}

// ─── Age gate ────────────────────────────────────────────
(function () {
  const gate = document.getElementById('ageGate');
  if (localStorage.getItem('lehlych_age_ok') === '1') {
    if (gate) gate.classList.add('hidden');
    if (localStorage.getItem('lehlych_cookie_ok') === '1') loadTracking();
  }
})();

function ageYes() {
  localStorage.setItem('lehlych_age_ok', '1');
  localStorage.setItem('lehlych_cookie_ok', '1');
  document.getElementById('ageGate').classList.add('hidden');
  loadTracking();
}
function ageNo() {
  window.location.href = 'https://www.google.com';
}

// ─── Sticky header (лише там, де є герой) ─────────────────
(function () {
  const heroLogo = document.getElementById('heroLogo');
  const stickyHeader = document.getElementById('stickyHeader');
  if (heroLogo && stickyHeader) {
    const observer = new IntersectionObserver(
      ([entry]) => stickyHeader.classList.toggle('visible', !entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(heroLogo);
  }
})();

// ─── Кошик ────────────────────────────────────────────────
const CART_KEY = 'lehlych_cart';

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; }
  catch { return {}; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
  renderCart();
}
function product(slug) {
  return (window.PRODUCTS || []).find(p => p.slug === slug);
}

function addToCart(slug, qty) {
  qty = parseInt(qty || 1);
  if (qty < 1) qty = 1;
  const cart = getCart();
  cart[slug] = (cart[slug] || 0) + qty;
  saveCart(cart);
  openCart();
}
function setCartQty(slug, qty) {
  const cart = getCart();
  qty = parseInt(qty);
  if (!qty || qty < 1) delete cart[slug];
  else cart[slug] = Math.min(99, qty);
  saveCart(cart);
}
function removeFromCart(slug) {
  const cart = getCart();
  delete cart[slug];
  saveCart(cart);
}

function cartTotal() {
  const cart = getCart();
  return Object.entries(cart).reduce((sum, [slug, q]) => {
    const p = product(slug);
    return sum + (p ? p.price * q : 0);
  }, 0);
}
function cartCount() {
  return Object.values(getCart()).reduce((a, b) => a + b, 0);
}

function updateCartCount() {
  const el = document.getElementById('cartCount');
  if (!el) return;
  const n = cartCount();
  el.textContent = n;
  el.classList.toggle('has', n > 0);
}

function renderCart() {
  const box = document.getElementById('cartItems');
  if (!box) return;
  const cart = getCart();
  const slugs = Object.keys(cart);

  if (!slugs.length) {
    box.innerHTML = '<p class="cart-empty">Кошик порожній</p>';
  } else {
    box.innerHTML = slugs.map(slug => {
      const p = product(slug);
      if (!p) return '';
      const q = cart[slug];
      return `<div class="cart-item">
        <img src="${p.photo}" alt="${p.name}" class="cart-item-img">
        <div class="cart-item-body">
          <p class="cart-item-name">${p.name}</p>
          <p class="cart-item-price">${p.price} грн</p>
          <div class="cart-item-ctrl">
            <button onclick="setCartQty('${slug}', ${q - 1})">−</button>
            <span>${q}</span>
            <button onclick="setCartQty('${slug}', ${q + 1})">+</button>
            <button class="cart-item-del" onclick="removeFromCart('${slug}')" aria-label="Видалити" title="Видалити"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  const totalEl = document.getElementById('cartTotal');
  if (totalEl) totalEl.textContent = cartTotal() + ' грн';

  const checkout = document.getElementById('cartCheckout');
  if (checkout) checkout.classList.toggle('disabled', !slugs.length);

  renderShipBar();
}

// ─── Прогрес безкоштовної доставки ────────────────────────
const FREE_SHIP_QTY = 6;
function bottlesWord(n) {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return 'пляшка';
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 'пляшки';
  return 'пляшок';
}
function renderShipBar() {
  const bar = document.getElementById('shipBar');
  if (!bar) return;
  const n = cartCount();
  if (n === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  if (n >= FREE_SHIP_QTY) {
    bar.className = 'ship-bar done';
    bar.innerHTML = '🎉 Доставка безкоштовна!';
  } else {
    const left = FREE_SHIP_QTY - n;
    const pct = Math.round((n / FREE_SHIP_QTY) * 100);
    bar.className = 'ship-bar';
    bar.innerHTML = 'Ще <b>' + left + ' ' + bottlesWord(left) + '</b> — і доставка безкоштовна 🚚' +
      '<span class="ship-track"><span class="ship-fill" style="width:' + pct + '%"></span></span>';
  }
}

function openCart() {
  document.getElementById('cartDrawer')?.classList.add('open');
  document.getElementById('cartOverlay')?.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  document.getElementById('cartDrawer')?.classList.remove('open');
  document.getElementById('cartOverlay')?.classList.remove('show');
  document.body.style.overflow = '';
}

// ─── Вкладки на сторінці товару ───────────────────────────
function showTab(btn, panelId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(panelId)?.classList.add('active');
}

// ─── Галерея фото на сторінці товару ──────────────────────
function gallerySet(i) {
  const g = document.getElementById('productGallery');
  if (!g) return;
  const thumbs = g.querySelectorAll('.gallery-thumb');
  if (!thumbs.length) return;
  i = (i + thumbs.length) % thumbs.length;
  thumbs.forEach((t, idx) => t.classList.toggle('active', idx === i));
  const main = document.getElementById('galleryMainImg');
  const src = thumbs[i].querySelector('img').getAttribute('src');
  if (main && src) main.src = src;
  g.dataset.idx = i;
}
function galleryNav(d) {
  const g = document.getElementById('productGallery');
  if (!g) return;
  gallerySet((parseInt(g.dataset.idx || '0', 10)) + d);
}

// ─── Кількість на сторінці товару ─────────────────────────
function pqty(delta) {
  const input = document.getElementById('pQty');
  if (!input) return;
  input.value = Math.max(1, Math.min(99, (parseInt(input.value) || 1) + delta));
}

// init
updateCartCount();
renderCart();
