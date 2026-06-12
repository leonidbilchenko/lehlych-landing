// ═══════════════════════════════════════════════════════════
//  LEHLYCH WINERY — Бекенд (Google Apps Script)
//  Нова Пошта (проксі) · Замовлення → Google Таблиця (первинно)
//  + Notion (CRM) · LiqPay · Листи
//
//  Конфіг — у Script Properties (Project Settings → Script properties).
//  НІЯКИХ ключів у коді!
//    ORDERS_SHEET_ID   — ID Google Таблиці (журнал замовлень)
//    NOTION_TOKEN      — токен інтеграції Notion (ntn_...)
//    NOTION_ORDERS_DB  — ID бази «Замовлення» в Notion
//    LIQPAY_PUBLIC     — публічний ключ LiqPay
//    LIQPAY_PRIVATE    — приватний ключ LiqPay
//    NP_KEY            — API-ключ Нової Пошти
//    SITE_URL          — https://lehlych.com
//    WINERY_EMAIL      — lehlychwinery@gmail.com
//    SANDBOX           — "1" для тесту LiqPay, інакше порожньо
// ═══════════════════════════════════════════════════════════

function P(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────
//  GET — проксі Нової Пошти (автопідказки міст/відділень)
// ─────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action || '';
    if (action === 'npCities')     return jsonOut({ items: npCities(e.parameter.q) });
    if (action === 'npWarehouses') return jsonOut({ items: npWarehouses(e.parameter.cityRef, e.parameter.q) });
    return jsonOut({ status: 'error', message: 'unknown action' });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err) });
  }
}

function npCall(model, method, props) {
  const res = UrlFetchApp.fetch('https://api.novaposhta.ua/v2.0/json/', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ apiKey: P('NP_KEY'), modelName: model, calledMethod: method, methodProperties: props }),
    muteHttpExceptions: true,
  });
  return JSON.parse(res.getContentText()).data || [];
}
function npCities(q) {
  if (!q || q.length < 2) return [];
  return npCall('Address', 'getCities', { FindByString: q, Limit: '15' })
    .map(c => ({ ref: c.Ref, name: c.Description, area: c.AreaDescription || '' }));
}
function npWarehouses(cityRef, q) {
  if (!cityRef) return [];
  return npCall('Address', 'getWarehouses', { CityRef: cityRef, FindByString: q || '', Limit: '30' })
    .map(w => ({ ref: w.Ref, name: w.Description }));
}

// ─────────────────────────────────────────────────────────
//  POST — створення замовлення АБО колбек LiqPay
// ─────────────────────────────────────────────────────────
function doPost(e) {
  try {
    if (e.parameter && e.parameter.data && e.parameter.signature) {
      return liqpayCallback(e.parameter.data, e.parameter.signature); // колбек LiqPay (form-data)
    }
    const order = JSON.parse(e.postData.contents);
    if (order.action === 'createOrder') return createOrder(order);
    return jsonOut({ status: 'error', message: 'unknown action' });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err) });
  }
}

// ── Створення замовлення ──
function createOrder(o) {
  const orderNum = 'LW' + Utilities.formatDate(new Date(), 'Europe/Kiev', 'yyMMdd-HHmmss');
  const itemsStr = o.items.map(i => i.name + ' ×' + i.qty).join(', ');

  // 1) ПЕРВИННО — Google Таблиця
  sheetAppend(orderNum, o, itemsStr);

  // 2) Notion (best-effort: якщо впаде — замовлення вже в Таблиці)
  try { notionCreatePage(orderNum, o, itemsStr); } catch (err) { /* ігноруємо */ }

  // 3) LiqPay — дані + підпис
  const params = {
    public_key: P('LIQPAY_PUBLIC'),
    version: 3, action: 'pay',
    amount: o.total, currency: 'UAH',
    description: 'Lehlych Winery — замовлення №' + orderNum,
    order_id: orderNum, language: 'uk',
    result_url: P('SITE_URL') + '/thank-you/?order=' + orderNum,
    server_url: ScriptApp.getService().getUrl(),
  };
  if (P('SANDBOX') === '1') params.sandbox = '1';

  // Фіскалізація ПРРО — дані товарів для чека
  params.rro_info = {
    items: o.items.map(function (it) {
      return {
        amount: it.qty,
        price: it.price,
        cost: it.qty * it.price,
        id: it.liqpayId,
      };
    }),
    delivery_emails: [o.email, P('WINERY_EMAIL')].filter(Boolean),
  };

  const data = Utilities.base64Encode(JSON.stringify(params), Utilities.Charset.UTF_8);
  return jsonOut({ status: 'ok', order: orderNum, data: data, signature: liqpaySign(data) });
}

function liqpaySign(data) {
  const priv = P('LIQPAY_PRIVATE');
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, priv + data + priv, Utilities.Charset.UTF_8)
  );
}

// ── Колбек LiqPay (підтвердження оплати) ──
function liqpayCallback(data, signature) {
  if (liqpaySign(data) !== signature) return jsonOut({ status: 'error', message: 'bad signature' });

  const payment = JSON.parse(Utilities.newBlob(Utilities.base64Decode(data)).getDataAsString());
  const orderNum = payment.order_id;
  const paid = (payment.status === 'success' || payment.status === 'sandbox');

  if (paid) {
    const found = sheetFind(orderNum);
    // ідемпотентність: LiqPay може слати колбек кілька разів — не дублюємо
    const already = found && String(found.row[11]) === 'Оплачено';
    if (found && !already) {
      sheetSetPaid(found.index);
      sendEmails(found.row, orderNum);
      // аналітика продажів (дата замовлення + позиції з колонки «Товари»)
      const d = (found.row[1] instanceof Date) ? found.row[1] : new Date();
      try { recordSale(d, parseItems(found.row[8])); } catch (err) { /* ігноруємо */ }
    }
    if (!already) {
      // Notion (best-effort)
      try {
        const page = notionFindOrder(orderNum);
        if (page) notionUpdate(page.id, {
          'Оплата': { select: { name: 'Оплачено' } },
          'Статус': { select: { name: 'Оплачено' } },
        });
      } catch (err) { /* ігноруємо */ }
    }
  }
  return jsonOut({ status: 'ok' });
}

// ─────────────────────────────────────────────────────────
//  Google Таблиця (первинний журнал)
//  Колонки A..M:
//  № | Дата | Прізвище | Ім'я | Телефон | Email | Місто |
//  Відділення | Товари | Сума | Статус | Оплата | Коментар
// ─────────────────────────────────────────────────────────
function sheet() {
  return SpreadsheetApp.openById(P('ORDERS_SHEET_ID')).getSheets()[0];
}
function sheetAppend(orderNum, o, itemsStr) {
  sheet().appendRow([
    orderNum, new Date(), o.lastName || '', o.firstName || '', o.phone || '',
    o.email || '', o.cityName || '', o.warehouseName || '', itemsStr, o.total,
    'Нове', 'Очікує', o.comment || '',
  ]);
}
function sheetFind(orderNum) {
  const data = sheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === orderNum) return { index: i + 1, row: data[i] };
  }
  return null;
}
function sheetSetPaid(rowIndex) {
  const sh = sheet();
  sh.getRange(rowIndex, 11).setValue('Оплачено'); // Статус
  sh.getRange(rowIndex, 12).setValue('Оплачено'); // Оплата
}

// ─────────────────────────────────────────────────────────
//  Notion (CRM)
// ─────────────────────────────────────────────────────────
function notionFetch(path, method, payload) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: method, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + P('NOTION_TOKEN'), 'Notion-Version': '2022-06-28' },
    payload: payload ? JSON.stringify(payload) : null, muteHttpExceptions: true,
  });
  return JSON.parse(res.getContentText());
}
function rt(s) { return { rich_text: [{ text: { content: String(s || '') } }] }; }

function notionCreatePage(orderNum, o, itemsStr) {
  notionFetch('/pages', 'post', {
    parent: { database_id: P('NOTION_ORDERS_DB') },
    properties: {
      '№ замовлення': { title: [{ text: { content: orderNum } }] },
      'Дата': { date: { start: new Date().toISOString() } },
      'Прізвище': rt(o.lastName),
      'Ім\'я': rt(o.firstName),
      'Телефон': { phone_number: String(o.phone || '') },
      'Email': { email: o.email || null },
      'Місто': rt(o.cityName),
      'Відділення': rt(o.warehouseName),
      'Товари': rt(itemsStr),
      'Сума': { number: o.total },
      'Статус': { select: { name: 'Нове' } },
      'Оплата': { select: { name: 'Очікує' } },
      'Коментар': rt(o.comment),
    },
  });
}
function notionFindOrder(orderNum) {
  const res = notionFetch('/databases/' + P('NOTION_ORDERS_DB') + '/query', 'post', {
    filter: { property: '№ замовлення', title: { equals: orderNum } },
  });
  return (res.results && res.results[0]) || null;
}
function notionUpdate(pageId, properties) {
  notionFetch('/pages/' + pageId, 'patch', { properties: properties });
}

// ─────────────────────────────────────────────────────────
//  Листи (дані беремо з рядка Таблиці)
//  row: [0]№ [2]Прізвище [3]Ім'я [4]Телефон [5]Email
//       [6]Місто [7]Відділення [8]Товари [9]Сума [12]Коментар
// ─────────────────────────────────────────────────────────
function sendEmails(row, orderNum) {
  const winery = P('WINERY_EMAIL');
  const firstName = row[3], lastName = row[2], phone = row[4], email = row[5];
  const city = row[6], wh = row[7], items = row[8], total = row[9], comment = row[12];

  if (email) {
    const plain =
      'Вітаємо, ' + firstName + '!\n\n' +
      'Дякуємо за ваше замовлення — оплату успішно отримано.\n\n' +
      'Замовлення №' + orderNum + '\n' + items + '\nРазом: ' + total + ' грн\n\n' +
      'Доставка: ' + city + ', ' + wh + ' (Нова Пошта).\n\n' +
      'Ми відправляємо замовлення з понеділка по пʼятницю. ' +
      'Щойно передамо посилку — ви отримаєте сповіщення про відправку в застосунку Нової Пошти.\n\n' +
      'Якщо виникнуть питання — просто відповідайте на цей лист.\n\n' +
      'З теплом,\nКоманда Lehlych Winery 🍷';

    const html =
      '<div style="margin:0;padding:0;background:#f4f1ec;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:32px 16px;">' +
      '<tr><td align="center">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Georgia,\'Times New Roman\',serif;color:#2b2b2b;">' +

      // Шапка
      '<tr><td style="background:#1f0f0c;padding:16px 24px;text-align:center;">' +
      '<img src="https://lehlych.com/logo/Logo%20Lehlych%20White@4x.png" alt="Lehlych Winery" width="380" style="display:inline-block;width:100%;max-width:380px;height:auto;border:0;">' +
      '</td></tr>' +

      // Тіло
      '<tr><td style="padding:36px 32px 12px;">' +
      '<h1 style="margin:0 0 8px;font-size:24px;font-weight:400;color:#2b2b2b;">Дякуємо за замовлення!</h1>' +
      '<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#555;">Вітаємо, ' + firstName + '! Оплату успішно отримано — ваше вино вже чекає на відправку.</p>' +

      // Деталі замовлення
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;border-radius:10px;padding:0;margin:0 0 24px;">' +
      '<tr><td style="padding:20px 22px;">' +
      '<p style="margin:0 0 10px;font-size:13px;letter-spacing:1px;color:#9a8f7a;text-transform:uppercase;">Замовлення №' + orderNum + '</p>' +
      '<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#2b2b2b;">' + items + '</p>' +
      '<p style="margin:0;font-size:18px;color:#2b2b2b;"><strong>Разом: ' + total + ' грн</strong></p>' +
      '</td></tr></table>' +

      // Доставка
      '<p style="margin:0 0 6px;font-size:13px;letter-spacing:1px;color:#9a8f7a;text-transform:uppercase;">Доставка</p>' +
      '<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#2b2b2b;">' + city + ', ' + wh + '<br><span style="color:#888;">Нова Пошта</span></p>' +

      // Інфо про відправку
      '<div style="border-left:3px solid #9a8f7a;padding:4px 0 4px 16px;margin:0 0 28px;">' +
      '<p style="margin:0;font-size:15px;line-height:1.65;color:#555;">Ми відправляємо замовлення <strong>з понеділка по пʼятницю</strong>. Щойно передамо посилку — ви отримаєте <strong>сповіщення про відправку в застосунку Нової Пошти</strong>.</p>' +
      '</div>' +

      '<p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#555;">Якщо виникнуть питання — просто відповідайте на цей лист.</p>' +
      '</td></tr>' +

      // Підпис
      '<tr><td style="padding:8px 32px 36px;">' +
      '<p style="margin:0;font-size:16px;color:#2b2b2b;">З теплом,<br>Команда Lehlych Winery 🍷</p>' +
      '</td></tr>' +

      // Футер
      '<tr><td style="background:#1f0f0c;padding:20px 32px;text-align:center;">' +
      '<p style="margin:0 0 6px;font-size:12px;color:#9a8f7a;">lehlych.com · lehlychwinery@gmail.com</p>' +
      '<p style="margin:0;font-size:11px;color:#6f6a5f;">18+ Надмірне споживання алкоголю шкідливе для вашого здоровʼя</p>' +
      '</td></tr>' +

      '</table>' +
      '</td></tr></table>' +
      '</div>';

    MailApp.sendEmail({
      to: email, replyTo: winery,
      subject: 'Lehlych Winery — замовлення №' + orderNum + ' оплачено',
      body: plain,
      htmlBody: html,
      name: 'Lehlych Winery',
    });
  }
  MailApp.sendEmail({
    to: winery,
    subject: '[Оплачено №' + orderNum + '] ' + firstName + ' ' + lastName + ' — ' + total + ' грн',
    body: firstName + ' ' + lastName + '\n' + phone + '\n' + email + '\n' + city + ', ' + wh +
      '\n\n' + items + '\nРазом: ' + total + ' грн\n\nКоментар: ' + (comment || '—'),
  });
}

// ═══════════════════════════════════════════════════════════
//  АНАЛІТИКА ПРОДАЖІВ  +  ЩОДЕННИЙ TELEGRAM-ЗВІТ
//  Script Properties: TELEGRAM_TOKEN, TELEGRAM_CHAT
// ═══════════════════════════════════════════════════════════

// Карта товарів { назва: {type, price} } — тягнеться з products.js сайту (кеш у межах виклику)
var _PMAP = null;
function productsMap() {
  if (_PMAP) return _PMAP;
  _PMAP = {};
  try {
    const res = UrlFetchApp.fetch(P('SITE_URL') + '/products.js', { muteHttpExceptions: true });
    const arr = JSON.parse(res.getContentText().match(/\[[\s\S]*\]/)[0]);
    arr.forEach(function (p) { _PMAP[p.name] = { type: p.type || '', price: p.price || 0 }; });
  } catch (e) { /* лишаємо порожню мапу */ }
  return _PMAP;
}

// Розбір «Назва ×2, Назва2 ×1» → [{name, qty}]
function parseItems(str) {
  if (!str) return [];
  return String(str).split(',').map(function (part) {
    const m = part.trim().match(/^(.*?)\s*[×x]\s*(\d+)$/);
    return m ? { name: m[1].trim(), qty: parseInt(m[2], 10) } : null;
  }).filter(Boolean);
}

function money(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Вкладка «Продажі»
function salesSheet() {
  const ss = SpreadsheetApp.openById(P('ORDERS_SHEET_ID'));
  let sh = ss.getSheetByName('Продажі');
  if (!sh) {
    sh = ss.insertSheet('Продажі');
    sh.appendRow(['МІСЯЦЬ', 'ДАТА', 'БРЕНД', 'ТИП', 'ВИНО', 'ПРОДАНО, пл.', 'СУМА, грн']);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Записати продаж: агрегує по (день + вино), додає або інкрементує рядок
function recordSale(dateObj, items) {
  if (!items || !items.length) return;
  const map = productsMap();
  const sh = salesSheet();
  const tz = 'Europe/Kiev';
  const dateStr = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
  const monthStr = Utilities.formatDate(dateObj, tz, 'yyyyMM');
  const data = sh.getDataRange().getValues();

  items.forEach(function (it) {
    const info = map[it.name] || { type: '', price: 0 };
    const sum = it.qty * info.price;
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === dateStr && String(data[i][4]) === it.name) { rowIdx = i + 1; break; }
    }
    if (rowIdx > 0) {
      sh.getRange(rowIdx, 6).setValue(Number(sh.getRange(rowIdx, 6).getValue()) + it.qty);
      sh.getRange(rowIdx, 7).setValue(Number(sh.getRange(rowIdx, 7).getValue()) + sum);
    } else {
      const row = [monthStr, dateStr, 'Lehlych Winery', info.type, it.name, it.qty, sum];
      sh.appendRow(row);
      data.push(row); // щоб наступні позиції цього ж виклику знайшли свіжий рядок
    }
  });
}

// Перебудувати «Продажі» з нуля за всіма оплаченими замовленнями (одноразово / за потреби)
function backfillSales() {
  const sh = salesSheet();
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1); // чистимо дані, лишаємо заголовок
  const orders = sheet().getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < orders.length; i++) {
    const row = orders[i];
    if (String(row[11]) !== 'Оплачено') continue; // L = Оплата
    const d = (row[1] instanceof Date) ? row[1] : new Date(row[1]);
    recordSale(d, parseItems(row[8])); // I = Товари
    n++;
  }
  Logger.log('Перебудовано «Продажі» за ' + n + ' оплаченими замовленнями.');
}

// ── Telegram ──
function tgSend(text) {
  const token = P('TELEGRAM_TOKEN'), chat = P('TELEGRAM_CHAT');
  if (!token || !chat) { Logger.log('Немає TELEGRAM_TOKEN / TELEGRAM_CHAT'); return; }
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true }),
    muteHttpExceptions: true,
  });
}

// Тимчасова: дізнатись ID групи. Напиши щось у групу → Run → дивись Логи (Ctrl+Enter)
function getChatId() {
  const token = P('TELEGRAM_TOKEN');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  const upd = JSON.parse(res.getContentText());
  (upd.result || []).forEach(function (u) {
    const c = ((u.message || u.my_chat_member || u.channel_post || {}).chat) || null;
    if (c) Logger.log('CHAT_ID = ' + c.id + '   (' + (c.title || c.type) + ')');
  });
  if (!(upd.result || []).length) Logger.log('Порожньо. Напиши повідомлення у групу і запусти ще раз.');
}

// Щоденний звіт за ВЧОРА + підсумок з початку. Ставиться на таймер о 9:00.
function sendDailyReport() {
  const sh = salesSheet();
  const data = sh.getDataRange().getValues();
  const tz = 'Europe/Kiev';
  const yest = new Date(Date.now() - 24 * 3600 * 1000);
  const yStr = Utilities.formatDate(yest, tz, 'yyyy-MM-dd');
  const yHuman = Utilities.formatDate(yest, tz, 'dd.MM.yyyy');

  let dayB = 0, dayM = 0, totB = 0, totM = 0;
  const byWine = {};
  for (let i = 1; i < data.length; i++) {
    const date = String(data[i][1]), wine = data[i][4];
    const qty = Number(data[i][5]) || 0, sum = Number(data[i][6]) || 0;
    totB += qty; totM += sum;
    if (date === yStr) {
      dayB += qty; dayM += sum;
      if (!byWine[wine]) byWine[wine] = { qty: 0, sum: 0 };
      byWine[wine].qty += qty; byWine[wine].sum += sum;
    }
  }

  let msg = '📊 <b>Продажі за ' + yHuman + '</b>\n\n';
  const wines = Object.keys(byWine);
  if (!wines.length) {
    msg += 'Вчора оплачених замовлень не було.\n';
  } else {
    msg += '🍷 <b>По сортах:</b>\n';
    wines.sort(function (a, b) { return byWine[b].qty - byWine[a].qty; });
    wines.forEach(function (w) {
      msg += '• ' + w + ' — <b>' + byWine[w].qty + '</b> пл. · ' + money(byWine[w].sum) + ' грн\n';
    });
    msg += '\n✅ <b>Разом за день:</b> ' + dayB + ' пляшок · ' + money(dayM) + ' грн\n';
  }
  msg += '\n📈 <b>Усього з початку:</b> ' + totB + ' пляшок · ' + money(totM) + ' грн';
  tgSend(msg);
}
