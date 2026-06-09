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
    if (found) {
      sheetSetPaid(found.index);
      sendEmails(found.row, orderNum);
    }
    // Notion (best-effort)
    try {
      const page = notionFindOrder(orderNum);
      if (page) notionUpdate(page.id, {
        'Оплата': { select: { name: 'Оплачено' } },
        'Статус': { select: { name: 'Оплачено' } },
      });
    } catch (err) { /* ігноруємо */ }
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
