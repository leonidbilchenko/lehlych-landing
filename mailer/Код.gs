// ═══════════════════════════════════════════════════════════
//  LEHLYCH WINERY — Сервіс розсилок
//
//  Окремий проєкт Apps Script, привʼязаний до окремої Google
//  Таблиці. З бекендом замовлень (google-apps-script.js) не
//  пересікається — щоб помилка в розсилці не поклала чекаут.
//
//  Як запустити: див. MAILER.md в Обсідіані.
//
//  Script Properties (Project Settings → Script properties):
//    SENDER_EMAIL   — адреса відправника (аліас акаунта), напр. info@lehlych.com
//    SENDER_NAME    — Lehlych Winery
//    REPLY_TO       — куди падають відповіді, напр. bilchenko@lehlych.com
//    WEBAPP_URL     — URL розгортання цього веб-застосунку (для відписки)
//    UNSUB_SECRET   — довгий випадковий рядок для підпису посилань відписки
//    SITE_URL       — https://lehlych.com
//    HTML_FOLDER    — назва теки в Google Drive з HTML-файлами листів
//    TEST_EMAIL     — адреса для тестових відправок
//
//  НІЯКИХ ключів у коді.
// ═══════════════════════════════════════════════════════════

var SHEETS = {
  contacts:  'Контакти',
  campaigns: 'Кампанії',
  log:       'Лог',
  unsub:     'Відписки'
};

var HEADERS = {
  contacts: ['Email', 'Компанія', 'Імʼя', 'Категорії', 'Статус', 'Джерело',
             'Додано', 'Останній лист', 'Відмов', 'Примітка'],
  campaigns: ['Назва', 'Тема', 'Прехедер', 'Категорія', 'HTML', 'Текст (необовʼязково)',
              'Статус', 'Надіслано', 'Помилок', 'Пропущено', 'Ліміт на добу',
              'Створено', 'Остання активність', 'Нотатки'],
  log: ['Час', 'Кампанія', 'Email', 'Компанія', 'Результат', 'Деталі'],
  unsub: ['Email', 'Коли', 'Кампанія', 'Звідки']
};

// Статуси контакту, при яких лист не йде
var SKIP_STATUSES = ['відписався', 'відмова', 'мертвий домен', 'немає адреси', 'пауза'];

var DEFAULT_DAILY_CAP = 40;   // за добу на кампанію, якщо в рядку не вказано
var BATCH_PER_RUN     = 5;    // стеля за один запуск тригера
var PAUSE_BETWEEN_MS  = 4000; // пауза між листами

// Вікно відправки: B2B-лист у неділю ввечері — це майже гарантований
// архів або спам. Шлемо лише в робочі дні, у робочі години за Києвом,
// і розмазуємо добовий ліміт рівно по дню, а не вистрілюємо зранку.
var SEND_DAYS      = [1, 2, 3, 4, 5]; // пн–пт
var SEND_FROM_HOUR = 9;
var SEND_TO_HOUR   = 17;              // до 17:00, не включно
var TRIGGER_EVERY_MIN = 15;

function P(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function Pnum(key, dflt) { var v = parseInt(P(key), 10); return isNaN(v) ? dflt : v; }

// ─────────────────────────────────────────────────────────
//  МЕНЮ
// ─────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📧 Розсилка')
    .addItem('Підготувати таблицю', 'setupSheets')
    .addSeparator()
    .addItem('Перевірити кампанію (без відправки)', 'checkCampaign')
    .addItem('Тест на себе', 'sendTest')
    .addSeparator()
    .addItem('▶︎ Запустити розсилку', 'startCampaign')
    .addItem('⏸ Поставити на пазу', 'pauseCampaign')
    .addItem('Надіслати наступну порцію зараз', 'processQueue')
    .addSeparator()
    .addItem('Стан і квота', 'statusReport')
    .addItem('Порахувати відповіді', 'countReplies')
    .addItem('Зібрати відмови з пошти', 'scanBounces')
    .addToUi();
}

function ss() { return SpreadsheetApp.getActive(); }
function ui() { return SpreadsheetApp.getUi(); }

function sh(name) {
  var s = ss().getSheetByName(name);
  if (!s) throw new Error('Немає аркуша «' + name + '». Запусти «Підготувати таблицю»');
  return s;
}

// ─────────────────────────────────────────────────────────
//  ПІДГОТОВКА ТАБЛИЦІ
// ─────────────────────────────────────────────────────────
function setupSheets() {
  var book = ss();
  var created = [];

  Object.keys(SHEETS).forEach(function (key) {
    var name = SHEETS[key];
    var s = book.getSheetByName(name);
    if (!s) { s = book.insertSheet(name); created.push(name); }
    var hdr = HEADERS[key];
    s.getRange(1, 1, 1, hdr.length).setValues([hdr])
      .setFontWeight('bold').setBackground('#F2E6DC');
    s.setFrozenRows(1);
    if (s.getMaxColumns() > hdr.length) {
      s.deleteColumns(hdr.length + 1, s.getMaxColumns() - hdr.length);
    }
  });

  // HTML тримаємо як довгий текст — щоб Таблиця не чудила з переносами
  var c = book.getSheetByName(SHEETS.campaigns);
  c.getRange('E2:F').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  c.setColumnWidth(5, 220);
  c.setColumnWidth(6, 180);

  // Секрет для підпису посилань відписки — створюємо раз
  if (!P('UNSUB_SECRET')) {
    PropertiesService.getScriptProperties()
      .setProperty('UNSUB_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  ui().alert('Готово',
    created.length ? 'Створено аркуші: ' + created.join(', ') : 'Аркуші вже були, заголовки оновлено',
    ui().ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────
//  КОНТАКТИ
// ─────────────────────────────────────────────────────────
function contactsAll() {
  var s = sh(SHEETS.contacts);
  var vals = s.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    var email = String(r[0] || '').trim().toLowerCase();
    if (!email) continue;
    out.push({
      row: i + 1,
      email: email,
      company: String(r[1] || '').trim(),
      name: String(r[2] || '').trim(),
      cats: String(r[3] || '').split(/[,;]/).map(function (x) { return x.trim().toLowerCase(); })
              .filter(String),
      status: String(r[4] || '').trim().toLowerCase(),
      source: String(r[5] || '').trim()
    });
  }
  return out;
}

function recipientsFor(category) {
  var cat = String(category || '').trim().toLowerCase();
  var unsubscribed = unsubSet();
  var seen = {};
  return contactsAll().filter(function (c) {
    if (cat && c.cats.indexOf(cat) === -1) return false;
    if (SKIP_STATUSES.indexOf(c.status) !== -1) return false;
    if (unsubscribed[c.email]) return false;
    if (seen[c.email]) return false;
    seen[c.email] = true;
    return true;
  });
}

function unsubSet() {
  var s = sh(SHEETS.unsub);
  var vals = s.getDataRange().getValues();
  var set = {};
  for (var i = 1; i < vals.length; i++) {
    var e = String(vals[i][0] || '').trim().toLowerCase();
    if (e) set[e] = true;
  }
  return set;
}

function setContactField(row, header, value) {
  var s = sh(SHEETS.contacts);
  var col = HEADERS.contacts.indexOf(header) + 1;
  if (col > 0) s.getRange(row, col).setValue(value);
}

// ─────────────────────────────────────────────────────────
//  КАМПАНІЇ
// ─────────────────────────────────────────────────────────
function currentCampaign() {
  var s = sh(SHEETS.campaigns);
  var row = s.getActiveCell().getRow();
  if (row < 2) throw new Error('Стань курсором на рядок кампанії в аркуші «Кампанії»');
  return readCampaign(row);
}

function readCampaign(row) {
  var s = sh(SHEETS.campaigns);
  var v = s.getRange(row, 1, 1, HEADERS.campaigns.length).getValues()[0];
  var c = {};
  HEADERS.campaigns.forEach(function (h, i) { c[h] = v[i]; });
  c.row = row;
  c.name = String(c['Назва'] || '').trim();
  c.subject = String(c['Тема'] || '').trim();
  c.preheader = String(c['Прехедер'] || '').trim();
  c.category = String(c['Категорія'] || '').trim();
  c.htmlSrc = String(c['HTML'] || '').trim();
  c.textSrc = String(c['Текст (необовʼязково)'] || '').trim();
  c.status = String(c['Статус'] || '').trim().toLowerCase();
  c.cap = parseInt(c['Ліміт на добу'], 10) || DEFAULT_DAILY_CAP;
  if (!c.name) throw new Error('У кампанії не заповнена «Назва»');
  if (!c.subject) throw new Error('У кампанії не заповнена «Тема»');
  if (!c.htmlSrc) throw new Error('У кампанії не вказано «HTML»');
  return c;
}

function setCampaignField(row, header, value) {
  var s = sh(SHEETS.campaigns);
  var col = HEADERS.campaigns.indexOf(header) + 1;
  if (col > 0) s.getRange(row, col).setValue(value);
}

function touchCampaign(row) {
  setCampaignField(row, 'Остання активність', new Date());
}

// ─────────────────────────────────────────────────────────
//  HTML: звідки брати
//    1) якщо починається з «<» — це сам код у клітинці
//    2) якщо схоже на URL — тягнемо по https
//    3) інакше — назва файлу в теці Drive (HTML_FOLDER)
// ─────────────────────────────────────────────────────────
function loadHtml(src) {
  var s = String(src || '').trim();
  if (!s) throw new Error('Порожнє джерело HTML');

  if (s.charAt(0) === '<') return s;

  if (/^https?:\/\//i.test(s)) {
    var res = UrlFetchApp.fetch(s, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('HTML за URL не віддався: код ' + res.getResponseCode());
    }
    return res.getContentText('UTF-8');
  }

  var folderName = P('HTML_FOLDER');
  if (!folderName) throw new Error('Не задано HTML_FOLDER у Script Properties');
  var folders = DriveApp.getFoldersByName(folderName);
  if (!folders.hasNext()) throw new Error('Немає теки «' + folderName + '» у Drive');
  var folder = folders.next();

  var files = folder.getFilesByName(s);
  if (!files.hasNext() && !/\.html?$/i.test(s)) files = folder.getFilesByName(s + '.html');
  if (!files.hasNext()) throw new Error('У теці «' + folderName + '» немає файлу «' + s + '»');

  return files.next().getBlob().getDataAsString('UTF-8');
}

// ─────────────────────────────────────────────────────────
//  UTM на всі посилання сайту
// ─────────────────────────────────────────────────────────
function addUtm(html, campaignName) {
  var site = (P('SITE_URL') || 'https://lehlych.com').replace(/\/+$/, '');
  var host = site.replace(/^https?:\/\//, '');
  var tag = 'utm_source=email&utm_medium=email&utm_campaign=' +
            encodeURIComponent(slug(campaignName));

  return html.replace(/href="(https?:\/\/[^"]*)"/gi, function (whole, url) {
    if (url.indexOf(host) === -1) return whole;        // чужі домени не чіпаємо
    if (/[?&]utm_/.test(url)) return whole;            // вже є UTM
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    var hashAt = url.indexOf('#');
    if (hashAt === -1) return 'href="' + url + sep + tag + '"';
    return 'href="' + url.slice(0, hashAt) + sep + tag + url.slice(hashAt) + '"';
  });
}

function slug(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9а-яіїєґ]+/gi, '_').replace(/^_+|_+$/g, '') || 'campaign';
}

// ─────────────────────────────────────────────────────────
//  ЗМІННІ В ШАБЛОНІ
//    {{Компанія}} {{Імʼя}} {{Email}} {{unsubscribe_url}} {{Прехедер}}
//  Форма {{Компанія|ваша компанія}} — значення за замовчуванням,
//  якщо поле порожнє.
// ─────────────────────────────────────────────────────────
// Рендер у дві фази.
//
// Чому не в одну: UTM треба дописати в посилання, а в шаблоні вони
// написані як {{site_url}}/corporate/. Поки змінна не розкрита, це не
// URL, і addUtm його не бачить — кнопка пішла б без мітки. Тому спершу
// підставляємо те, що однакове для всіх, потім клеїмо UTM, і лише тоді
// підставляємо персональне.
function campaignMap(campaign) {
  return {
    'прехедер': campaign.preheader,
    'тема': campaign.subject,
    'site_url': (P('SITE_URL') || 'https://lehlych.com').replace(/\/+$/, '')
  };
}

function contactMap(contact, campaign) {
  return {
    'компанія': contact.company,
    'імʼя': contact.name,
    'ім\'я': contact.name,
    'email': contact.email,
    'unsubscribe_url': unsubUrl(contact.email, campaign.name)
  };
}

// Фаза 1: загальні змінні + UTM. Робиться один раз на кампанію.
function prepareHtml(src, campaign) {
  return addUtm(renderWith(loadHtml(src), campaignMap(campaign)), campaign.name);
}

// Фаза 2 — у renderWith(prepared, contactMap(...))

function render(tpl, contact, campaign) {
  var map = campaignMap(campaign), b = contactMap(contact, campaign);
  Object.keys(b).forEach(function (k) { map[k] = b[k]; });
  return renderWith(tpl, map);
}

function renderWith(tpl, map) {
  return String(tpl).replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g,
    function (whole, key, dflt) {
      var k = String(key).toLowerCase();
      var v = map.hasOwnProperty(k) ? map[k] : undefined;
      if (v === undefined) return whole;                 // невідому змінну лишаємо як є
      if (v === '' || v === null) return dflt === undefined ? '' : dflt;
      return String(v);
    });
}

// Які змінні лишились нерозкритими — щоб не відправити «{{Компанія}}» живій людині
function unresolvedVars(html) {
  var found = {}, m;
  var rx = /\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g;
  while ((m = rx.exec(html)) !== null) found[m[1].trim()] = true;
  return Object.keys(found);
}

// ─────────────────────────────────────────────────────────
//  ТЕКСТОВА ВЕРСІЯ
//  Лист без text/plain частини отримує мінус у спам-фільтрі.
// ─────────────────────────────────────────────────────────
function htmlToPlain(html) {
  var t = String(html);

  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<head[\s\S]*?<\/head>/gi, '');
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

  // Прехедер і будь-який інший схований блок: у HTML він потрібен,
  // у текстовій версії — ні. Класу на ньому немає, ловимо по display:none
  t = t.replace(/<(div|span|td|p)\b[^>]*display\s*:\s*none[\s\S]*?<\/\1>/gi, '');

  t = t.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (w, href, inner) {
    var label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!label) return '';
    if (/^(mailto|tel):/i.test(href)) return label;
    return label + ' — ' + href;
  });

  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|tr|h1|h2|h3|li|table)>/gi, '\n');
  t = t.replace(/<li\b[^>]*>/gi, '— ');
  t = t.replace(/<[^>]+>/g, '');

  // Іменовані сутності
  var NAMED = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
    rsquo: 'ʼ', lsquo: '‘', rdquo: '”', ldquo: '“',
    mdash: '—', ndash: '–', laquo: '«', raquo: '»', middot: '·',
    bull: '•', hellip: '…', times: '×', deg: '°', copy: '©', reg: '®',
    trade: '™', euro: '€', sect: '§', para: '¶', zwnj: '', zwj: '', shy: ''
  };
  t = t.replace(/&([a-zA-Z]+);/g, function (w, n) {
    return NAMED.hasOwnProperty(n) ? NAMED[n] : w;
  });

  // Числові сутності — саме ними набиті «порожнювачі» прехедера (&#847;)
  t = t.replace(/&#x([0-9a-fA-F]+);/g, function (w, h) { return cp(parseInt(h, 16)); });
  t = t.replace(/&#(\d+);/g, function (w, d) { return cp(parseInt(d, 10)); });

  // Невидимі символи, якими розтягують прехедер
  t = t.replace(/[\u00AD\u034F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, '');

  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function cp(n) {
  if (!isFinite(n) || n < 0 || n > 0x10FFFF) return '';
  return String.fromCodePoint ? String.fromCodePoint(n) : String.fromCharCode(n);
}

// ─────────────────────────────────────────────────────────
//  ВІДПИСКА: підписане посилання, щоб адреси не перебирали
// ─────────────────────────────────────────────────────────
function unsubSig(email) {
  var secret = P('UNSUB_SECRET');
  if (!secret) throw new Error('Немає UNSUB_SECRET — запусти «Підготувати таблицю»');
  var raw = Utilities.computeHmacSha256Signature(String(email).toLowerCase(), secret);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').slice(0, 24);
}

function unsubUrl(email, campaignName) {
  var base = P('WEBAPP_URL');
  if (!base) return (P('SITE_URL') || 'https://lehlych.com') + '/#unsubscribe-not-configured';
  return base + '?u=' + encodeURIComponent(email) +
         '&s=' + unsubSig(email) +
         '&c=' + encodeURIComponent(slug(campaignName || ''));
}

// Gmail на кнопку «Відписатись» шле POST, а не GET — через
// List-Unsubscribe-Post. Обидва методи ведуть в один обробник,
// інакше рідна кнопка Gmail відвалювалась би з помилкою.
function doGet(e)  { return handleUnsub(e); }
function doPost(e) { return handleUnsub(e); }

function handleUnsub(e) {
  var p = (e && e.parameter) || {};
  var email = String(p.u || '').trim().toLowerCase();
  var sig = String(p.s || '').trim();

  if (!email || !sig) return page('Сторінка не знайдена', 'Посилання неповне');

  var ok = false;
  try { ok = (sig === unsubSig(email)); } catch (err) { ok = false; }
  if (!ok) return page('Посилання не підходить', 'Перевір, чи воно скопійоване повністю');

  try {
    if (!unsubSet()[email]) {
      sh(SHEETS.unsub).appendRow([email, new Date(), String(p.c || ''), 'лист']);
      contactsAll().forEach(function (c) {
        if (c.email === email) {
          setContactField(c.row, 'Статус', 'відписався');
          setContactField(c.row, 'Примітка', 'Відписався ' +
            Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy'));
        }
      });
    }
  } catch (err) {
    return page('Не вдалося зберегти', 'Напиши нам на ' + (P('REPLY_TO') || P('SENDER_EMAIL')) +
                ' — відпишемо вручну');
  }

  return page('Готово, ви відписані',
    'Більше листів від Lehlych Winery на <b>' + escapeHtml(email) + '</b> не надійде');
}

function page(title, text) {
  var site = P('SITE_URL') || 'https://lehlych.com';
  var html =
    '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title></head>' +
    '<body style="margin:0;background:#FFF7F2;font-family:Montserrat,Helvetica,Arial,sans-serif;' +
    'color:#1F0F0C;display:flex;align-items:center;justify-content:center;min-height:100vh;">' +
    '<div style="max-width:420px;padding:40px 24px;text-align:center;">' +
    '<div style="font-size:22px;font-weight:600;margin:0 0 12px;">' + escapeHtml(title) + '</div>' +
    '<div style="font-size:15px;line-height:1.6;color:#5A4038;">' + text + '</div>' +
    '<div style="margin-top:28px;"><a href="' + site + '" style="color:#9A6F28;font-size:14px;' +
    'text-decoration:none;">lehlych.com</a></div>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────
//  ВІДПРАВКА ОДНОГО ЛИСТА
//
//  Шлемо сирим MIME через Gmail API, а не MailApp — лише так
//  можна поставити List-Unsubscribe. Саме цей заголовок дає
//  в Gmail рідну кнопку «Відписатись» замість «Спам», і для
//  холодної розсилки це найважливіший технічний чинник.
//  Якщо Gmail API недоступний — падаємо на MailApp.
// ─────────────────────────────────────────────────────────
function sendOne(to, subject, html, plain, unsubLink) {
  var from = P('SENDER_EMAIL');
  var name = P('SENDER_NAME') || 'Lehlych Winery';
  var reply = P('REPLY_TO') || from;
  if (!from) throw new Error('Не задано SENDER_EMAIL у Script Properties');

  try {
    var raw = buildMime({
      fromEmail: from, fromName: name, to: to, replyTo: reply,
      subject: subject, html: html, plain: plain, unsubLink: unsubLink
    });
    Gmail.Users.Messages.send(
      { raw: Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8) }, 'me');
    return 'Gmail API';
  } catch (err) {
    // Gmail API не підключений як advanced service, або впав — страхуємося
    MailApp.sendEmail({
      to: to, subject: subject, body: plain, htmlBody: html,
      name: name, replyTo: reply
    });
    return 'MailApp (без List-Unsubscribe): ' + String(err).slice(0, 80);
  }
}

function buildMime(o) {
  var bnd = '----lehlych_' + Utilities.getUuid();
  var L = [];

  L.push('From: ' + mimeWord(o.fromName) + ' <' + o.fromEmail + '>');
  L.push('To: ' + o.to);
  L.push('Reply-To: ' + o.replyTo);
  L.push('Subject: ' + mimeWord(o.subject));
  L.push('Date: ' + Utilities.formatDate(new Date(), 'Europe/Kyiv',
          "EEE, dd MMM yyyy HH:mm:ss Z"));
  L.push('MIME-Version: 1.0');
  if (o.unsubLink) {
    L.push('List-Unsubscribe: <' + o.unsubLink + '>');
    L.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }
  L.push('Content-Type: multipart/alternative; boundary="' + bnd + '"');
  L.push('');

  L.push('--' + bnd);
  L.push('Content-Type: text/plain; charset="UTF-8"');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(b64wrap(o.plain));

  L.push('--' + bnd);
  L.push('Content-Type: text/html; charset="UTF-8"');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(b64wrap(o.html));

  L.push('--' + bnd + '--');
  L.push('');
  return L.join('\r\n');
}

// Кирилиця в темі й імені відправника — тільки через RFC 2047
function mimeWord(s) {
  var str = String(s || '');
  if (!/[^\x20-\x7E]/.test(str)) return str;
  return '=?UTF-8?B?' + Utilities.base64Encode(str, Utilities.Charset.UTF_8) + '?=';
}

// RFC 5322 забороняє рядки довші за 998 символів — ріжемо base64 по 76
function b64wrap(text) {
  var b = Utilities.base64Encode(String(text), Utilities.Charset.UTF_8);
  return (b.match(/.{1,76}/g) || ['']).join('\r\n');
}

// ─────────────────────────────────────────────────────────
//  ПЕРЕВІРКА ПЕРЕД ВІДПРАВКОЮ
// ─────────────────────────────────────────────────────────
function checkCampaign() {
  var c = currentCampaign();
  var html, warn = [], info = [];

  try { html = prepareHtml(c.htmlSrc, c); }
  catch (err) { ui().alert('HTML не читається', String(err), ui().ButtonSet.OK); return; }

  var people = recipientsFor(c.category);
  var sentSet = alreadySent(c.name);
  var left = people.filter(function (p) { return !sentSet[p.email]; });

  // рендеримо на першому одержувачі, щоб побачити живий результат
  var sample = left[0] || people[0] || { email: P('TEST_EMAIL') || 'test@example.com',
                                         company: 'Тестова компанія', name: '' };
  var rendered = renderWith(html, contactMap(sample, c));
  var plain = c.textSrc ? render(loadHtml(c.textSrc), sample, c) : htmlToPlain(rendered);

  var leftovers = unresolvedVars(rendered);
  if (leftovers.length) warn.push('Нерозкриті змінні: {{' + leftovers.join('}}, {{') + '}}');
  if (html.indexOf('{{unsubscribe_url}}') === -1) {
    warn.push('У шаблоні немає {{unsubscribe_url}} — у листі не буде відписки');
  }
  if (rendered.indexOf('{{unsubscribe_url}}') !== -1) warn.push('Посилання відписки не підставилось');
  if (!c.preheader) warn.push('Не заповнено прехедер');
  if (rendered.length > 102 * 1024) warn.push('HTML більший за 102 КБ — Gmail обріже лист');
  if (plain.length < 200) warn.push('Текстова версія підозріло коротка (' + plain.length + ' симв.)');
  if (!P('WEBAPP_URL')) warn.push('Не задано WEBAPP_URL — відписка працювати не буде');
  if (!P('SENDER_EMAIL')) warn.push('Не задано SENDER_EMAIL');

  var noCompany = left.filter(function (p) { return !p.company; }).length;
  if (noCompany) info.push(noCompany + ' одержувачів без назви компанії');

  info.push('Категорія: ' + (c.category || '— не задана, піде всім —'));
  info.push('У категорії: ' + people.length);
  info.push('Уже надіслано: ' + Object.keys(sentSet).length);
  info.push('Лишилось: ' + left.length);
  info.push('Ліміт на добу: ' + c.cap);
  info.push('Розмір HTML: ' + Math.round(rendered.length / 1024) + ' КБ');
  info.push('Текстова версія: ' + plain.length + ' симв.');
  info.push('Квота листів сьогодні: ' + MailApp.getRemainingDailyQuota());

  ui().alert('Перевірка «' + c.name + '»',
    (warn.length ? '⚠ ПРОБЛЕМИ\n• ' + warn.join('\n• ') + '\n\n' : '✓ Проблем не видно\n\n') +
    info.join('\n') +
    '\n\n— Початок тексту —\n' + plain.slice(0, 400),
    ui().ButtonSet.OK);
}

function sendTest() {
  var c = currentCampaign();
  var to = P('TEST_EMAIL');
  if (!to) { ui().alert('Не задано TEST_EMAIL у Script Properties'); return; }

  var html = prepareHtml(c.htmlSrc, c);
  var sample = recipientsFor(c.category)[0] ||
               { email: to, company: 'Тестова компанія', name: '' };
  sample = { email: to, company: sample.company, name: sample.name };

  var rendered = renderWith(html, contactMap(sample, c));
  var plain = c.textSrc ? render(loadHtml(c.textSrc), sample, c) : htmlToPlain(rendered);

  var how = sendOne(to, '[ТЕСТ] ' + c.subject, rendered, plain, unsubUrl(to, c.name));
  logRow(c.name, to, sample.company, 'тест', how);
  ui().alert('Тест пішов', 'Адреса: ' + to + '\nКанал: ' + how +
    '\n\nПідставлено компанію «' + sample.company + '» — як у справжнього одержувача',
    ui().ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────
//  ЗАПУСК І ЧЕРГА
// ─────────────────────────────────────────────────────────
function startCampaign() {
  var c = currentCampaign();
  var people = recipientsFor(c.category);
  var sentSet = alreadySent(c.name);
  var left = people.filter(function (p) { return !sentSet[p.email]; });

  if (!left.length) { ui().alert('Усім із цієї категорії вже надіслано'); return; }

  var answer = ui().alert('Запустити «' + c.name + '»?',
    'Одержувачів лишилось: ' + left.length +
    '\nКатегорія: ' + c.category +
    '\nЛіміт на добу: ' + c.cap +
    '\nТема: ' + c.subject +
    '\nДнів на всіх: ~' + Math.ceil(left.length / c.cap) + ' робочих' +
    '\n\nШле лише пн–пт з ' + SEND_FROM_HOUR + ':00 до ' + SEND_TO_HOUR + ':00 за Києвом, ' +
    'рівномірно протягом дня. Якщо зараз поза цим вікном — почне з найближчого робочого ранку',
    ui().ButtonSet.YES_NO);
  if (answer !== ui().Button.YES) return;

  PropertiesService.getScriptProperties().setProperty('ACTIVE_ROW', String(c.row));
  setCampaignField(c.row, 'Статус', 'відправляється');
  touchCampaign(c.row);
  ensureTrigger();
  processQueue();
  ui().alert('Пішло', 'Далі само. Стан — у меню «Стан і квота»', ui().ButtonSet.OK);
}

function pauseCampaign() {
  var row = parseInt(P('ACTIVE_ROW'), 10);
  if (row) setCampaignField(row, 'Статус', 'пауза');
  dropTrigger();
  PropertiesService.getScriptProperties().deleteProperty('ACTIVE_ROW');
  ui().alert('Пауза', 'Тригер прибрано, нічого більше не йде', ui().ButtonSet.OK);
}

function ensureTrigger() {
  dropTrigger();
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(TRIGGER_EVERY_MIN).create();
}

function kyivNow() {
  var d = new Date();
  return {
    dow:  parseInt(Utilities.formatDate(d, 'Europe/Kyiv', 'u'), 10),  // 1 = пн … 7 = нд
    hour: parseInt(Utilities.formatDate(d, 'Europe/Kyiv', 'H'), 10),
    min:  parseInt(Utilities.formatDate(d, 'Europe/Kyiv', 'm'), 10)
  };
}

function inSendWindow() {
  var k = kyivNow();
  return SEND_DAYS.indexOf(k.dow) !== -1 && k.hour >= SEND_FROM_HOUR && k.hour < SEND_TO_HOUR;
}

function runsLeftToday() {
  var k = kyivNow();
  var minutesLeft = (SEND_TO_HOUR * 60) - (k.hour * 60 + k.min);
  return Math.max(1, Math.floor(minutesLeft / TRIGGER_EVERY_MIN));
}

function dropTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processQueue') ScriptApp.deleteTrigger(t);
  });
}

function processQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;

  try {
    var row = parseInt(P('ACTIVE_ROW'), 10);
    if (!row) { dropTrigger(); return; }

    var c = readCampaign(row);
    if (c.status !== 'відправляється') { dropTrigger(); return; }

    var html = prepareHtml(c.htmlSrc, c);
    var textTpl = c.textSrc ? loadHtml(c.textSrc) : null;

    var people = recipientsFor(c.category);
    var sentSet = alreadySent(c.name);
    var left = people.filter(function (p) { return !sentSet[p.email]; });

    if (!left.length) {
      setCampaignField(row, 'Статус', 'завершено');
      touchCampaign(row);
      dropTrigger();
      PropertiesService.getScriptProperties().deleteProperty('ACTIVE_ROW');
      return;
    }

    if (!inSendWindow()) return;                     // вихідний або неробочі години

    var sentToday = countSentToday(c.name);
    var capLeft = Math.max(0, c.cap - sentToday);
    if (capLeft === 0) return;                       // добовий ліміт вичерпано, ждемо доби

    // Рівномірно: скільки лишилось на сьогодні ÷ скільки запусків лишилось до кінця вікна
    var perRun = Math.ceil(capLeft / Math.max(1, runsLeftToday()));

    var quota = MailApp.getRemainingDailyQuota();
    var batch = Math.min(BATCH_PER_RUN, perRun, capLeft, left.length, Math.max(0, quota - 2));
    if (batch <= 0) return;

    var okCount = 0, errCount = 0;

    for (var i = 0; i < batch; i++) {
      var person = left[i];
      try {
        var rendered = renderWith(html, contactMap(person, c));
        var leftovers = unresolvedVars(rendered);
        if (leftovers.length) throw new Error('нерозкриті змінні: ' + leftovers.join(', '));

        var plain = textTpl ? render(textTpl, person, c) : htmlToPlain(rendered);
        var how = sendOne(person.email, c.subject, rendered, plain,
                          unsubUrl(person.email, c.name));

        logRow(c.name, person.email, person.company, 'надіслано', how);
        setContactField(person.row, 'Останній лист',
          c.name + ' · ' + Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy'));
        okCount++;
      } catch (err) {
        logRow(c.name, person.email, person.company, 'помилка', String(err).slice(0, 300));
        errCount++;
      }
      if (i < batch - 1) Utilities.sleep(PAUSE_BETWEEN_MS);
    }

    setCampaignField(row, 'Надіслано', (parseInt(c['Надіслано'], 10) || 0) + okCount);
    setCampaignField(row, 'Помилок', (parseInt(c['Помилок'], 10) || 0) + errCount);
    touchCampaign(row);
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────
//  ЛОГ
// ─────────────────────────────────────────────────────────
function logRow(campaign, email, company, result, detail) {
  sh(SHEETS.log).appendRow([new Date(), campaign, email, company || '', result,
                            String(detail || '').slice(0, 500)]);
}

function alreadySent(campaignName) {
  var vals = sh(SHEETS.log).getDataRange().getValues();
  var set = {};
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][1]) !== String(campaignName)) continue;
    if (String(vals[i][4]) !== 'надіслано') continue;
    set[String(vals[i][2]).trim().toLowerCase()] = true;
  }
  return set;
}

function countSentToday(campaignName) {
  var today = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd');
  var vals = sh(SHEETS.log).getDataRange().getValues();
  var n = 0;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][1]) !== String(campaignName)) continue;
    if (String(vals[i][4]) !== 'надіслано') continue;
    var d = vals[i][0];
    if (!(d instanceof Date)) continue;
    if (Utilities.formatDate(d, 'Europe/Kyiv', 'yyyy-MM-dd') === today) n++;
  }
  return n;
}

// ─────────────────────────────────────────────────────────
//  СТАН
// ─────────────────────────────────────────────────────────
function statusReport() {
  var lines = [];
  lines.push('Квота листів на сьогодні: ' + MailApp.getRemainingDailyQuota());
  lines.push('Відправник: ' + (P('SENDER_EMAIL') || '— не задано —'));
  lines.push('Веб-застосунок: ' + (P('WEBAPP_URL') ? 'налаштовано' : '— НЕ задано —'));
  lines.push('');

  var row = parseInt(P('ACTIVE_ROW'), 10);
  if (row) {
    try {
      var c = readCampaign(row);
      var people = recipientsFor(c.category);
      var sentSet = alreadySent(c.name);
      lines.push('Активна кампанія: ' + c.name);
      lines.push('  статус: ' + c.status);
      lines.push('  надіслано всього: ' + Object.keys(sentSet).length + ' з ' + people.length);
      lines.push('  сьогодні: ' + countSentToday(c.name) + ' з ' + c.cap);
    } catch (err) { lines.push('Активна кампанія в рядку ' + row + ': ' + err); }
  } else {
    lines.push('Активної кампанії немає');
  }

  lines.push('');
  var contacts = contactsAll();
  var byStatus = {};
  contacts.forEach(function (c) {
    var k = c.status || 'активний';
    byStatus[k] = (byStatus[k] || 0) + 1;
  });
  lines.push('Контактів: ' + contacts.length);
  Object.keys(byStatus).forEach(function (k) { lines.push('  ' + k + ': ' + byStatus[k]); });
  lines.push('Відписок: ' + Object.keys(unsubSet()).length);
  lines.push('Тригер processQueue: ' +
    (ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'processQueue'; }) ? 'стоїть' : 'немає'));

  ui().alert('Стан розсилки', lines.join('\n'), ui().ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────
//  ВІДПОВІДІ
//
//  Якщо заклик листа — «напишіть у відповідь», то відповіді і є
//  головна метрика: відкриття неточні, переходи рідкісні. Шукаємо
//  в пошті листи з темою кампанії не від нас, звіряємо з тими, кому
//  слали, нових пишемо в «Лог» і в примітку контакту.
// ─────────────────────────────────────────────────────────
function countReplies() {
  var c = currentCampaign();
  var subj = c.subject.replace(/"/g, '');
  var threads = GmailApp.search('subject:"' + subj + '" -from:me newer_than:90d', 0, 300);

  var sent = alreadySent(c.name);
  var mine = [P('SENDER_EMAIL'), P('REPLY_TO')].map(function (x) { return String(x).toLowerCase(); });

  var logged = {};
  var vals = sh(SHEETS.log).getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][1]) === c.name && String(vals[i][4]) === 'відповідь') {
      logged[String(vals[i][2]).toLowerCase()] = true;
    }
  }

  var repliers = {};
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      var raw = m.getFrom();
      var em = ((raw.match(/<([^>]+)>/) || [null, raw])[1] || '').trim().toLowerCase();
      if (!em || mine.indexOf(em) !== -1) return;
      if (/mailer-daemon|postmaster|no-?reply/.test(em)) return;
      repliers[em] = repliers[em] || m.getDate();
    });
  });

  var contacts = contactsAll();
  var byEmail = {};
  contacts.forEach(function (x) { byEmail[x.email] = x; });

  var fresh = [], fromList = 0, otherAddr = [];
  Object.keys(repliers).forEach(function (em) {
    if (sent[em]) fromList++; else otherAddr.push(em);
    if (logged[em]) return;
    var ct = byEmail[em];
    logRow(c.name, em, ct ? ct.company : '', 'відповідь',
           Utilities.formatDate(repliers[em], 'Europe/Kyiv', 'dd.MM.yyyy HH:mm'));
    if (ct) setContactField(ct.row, 'Примітка', 'Відповів(ла) на «' + c.name + '» ' +
      Utilities.formatDate(repliers[em], 'Europe/Kyiv', 'dd.MM.yyyy'));
    fresh.push(ct ? ct.company + ' — ' + em : em);
  });

  var total = Object.keys(sent).length;
  var n = Object.keys(repliers).length;
  ui().alert('Відповіді на «' + c.name + '»',
    'Надіслано: ' + total +
    '\nВідповіли: ' + n + (total ? ' (' + (100 * n / total).toFixed(1) + '%)' : '') +
    (otherAddr.length ? '\n  з них з іншої адреси, ніж ми писали: ' + otherAddr.length +
      ' — це нормально, info@ часто пересилають людині' : '') +
    '\nНових з минулої перевірки: ' + fresh.length +
    (fresh.length ? '\n\n' + fresh.slice(0, 25).join('\n') : ''),
    ui().ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────
//  ВІДМОВИ
//
//  Свого сервісу розсилок не повідомляє про відмови — їх
//  приносить mailer-daemon у пошту відправника. Збираємо
//  звідти і гасимо адреси, щоб не бити в мертву скриньку.
// ─────────────────────────────────────────────────────────
function scanBounces() {
  var threads = GmailApp.search(
    'from:(mailer-daemon OR postmaster) newer_than:30d', 0, 150);
  var found = {}, rx = /[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  var mine = String(P('SENDER_EMAIL')).toLowerCase();

  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      var body = m.getPlainBody().slice(0, 4000);
      var hard = /(550|553|5\.1\.1|5\.1\.10|address not found|user unknown|does not exist|no such user|mailbox unavailable)/i.test(body);
      if (!hard) return;
      var hits = body.match(rx) || [];
      hits.forEach(function (e) {
        e = e.toLowerCase();
        if (e === mine) return;
        if (/mailer-daemon|postmaster|googlemail|google\.com$/.test(e)) return;
        found[e] = true;
      });
    });
  });

  var contacts = contactsAll();
  var marked = [], names = [];
  contacts.forEach(function (c) {
    if (!found[c.email]) return;
    if (c.status === 'відмова') return;
    setContactField(c.row, 'Статус', 'відмова');
    setContactField(c.row, 'Відмов', 1);
    setContactField(c.row, 'Примітка', 'Відмова ' +
      Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy'));
    logRow('—', c.email, c.company, 'відмова', 'знайдено в пошті');
    marked.push(c.email);
    names.push(c.company || c.email);
  });

  ui().alert('Відмови',
    'Адрес у відмовах за 30 днів: ' + Object.keys(found).length +
    '\nПозначено в контактах: ' + marked.length +
    (names.length ? '\n\n' + names.slice(0, 25).join('\n') : ''),
    ui().ButtonSet.OK);
}
