// ═══════════════════════════════════════════════════════════
//  LEHLYCH WINERY — Google Apps Script
//  Вставити в: Extensions → Apps Script → Code.gs
// ═══════════════════════════════════════════════════════════

const WINERY_EMAIL = 'lehlych@gmail.com'; // ← ваша пошта (звідси йтиме лист)

function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Порядковий номер = кількість рядків даних + 1
    const lastRow = sheet.getLastRow();
    const orderNum = lastRow > 1 ? lastRow : 1; // рядок 1 — заголовки

    const total = (data.chardonnay || 0) + (data.sauvignon || 0) + (data.trpilske || 0);

    // Записуємо рядок у таблицю
    sheet.appendRow([
      orderNum,                              // № замовлення
      new Date(),                            // Дата
      data.lastName  || '',                  // Прізвище
      data.firstName || '',                  // Ім'я
      data.phone     || '',                  // Телефон
      data.email     || '',                  // Email
      data.city      || '',                  // Місто
      data.novaPoshta || '',                 // Відділення НП
      data.chardonnay || 0,                  // Chardonnay
      data.sauvignon  || 0,                  // Sauvignon Blanc
      data.trpilske   || 0,                  // Трипільське Сонце
      total,                                 // Всього пляшок
      data.comment   || '',                  // Коментар
    ]);

    // Лист подяки покупцю
    if (data.email) {
      sendThankYouEmail(data, orderNum, total);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', order: orderNum }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function sendThankYouEmail(data, orderNum, total) {
  const name = `${data.firstName} ${data.lastName}`;

  const wineLines = [];
  if (data.chardonnay > 0) wineLines.push(`— Chardonnay 2025: ${data.chardonnay} пляш${plural(data.chardonnay)}`);
  if (data.sauvignon  > 0) wineLines.push(`— Sauvignon Blanc 2025: ${data.sauvignon} пляш${plural(data.sauvignon)}`);
  if (data.trpilske   > 0) wineLines.push(`— Трипільське Сонце 2025: ${data.trpilske} пляш${plural(data.trpilske)}`);

  const subject = `Lehlych Winery — Передзамовлення №${orderNum} прийнято`;

  const body = `Вітаємо, ${data.firstName}!

Дякуємо, що цікавитесь вином Lehlych Winery — це для нас дуже важливо і надихає.

Ваше передзамовлення №${orderNum} прийнято:
${wineLines.join('\n')}
Разом: ${total} пляш${plural(total)}

Ми впевнені, що вино вас не розчарує — воно зроблене з любов'ю до місця, до моменту і до людей, які цінують справжнє.

Щойно ми відкриємо продаж, ви отримаєте листа з детальними інструкціями та варіантами оплати. Після отримання оплати — відправимо ваше замовлення одразу.

Якщо ви хочете внести зміни в замовлення, напишіть нам на ${WINERY_EMAIL} або в директ у соцмережах:
Instagram: https://www.instagram.com/lehlychwinery/
Facebook: https://www.facebook.com/profile.php?id=61572016280086

Ще раз дякуємо за довіру — бережіть себе, і до зустрічі за келихом!

З теплом,
Команда Lehlych Winery
Ржищів · Київщина`;

  MailApp.sendEmail({
    to:      data.email,
    replyTo: WINERY_EMAIL,
    subject: subject,
    body:    body,
  });

  // Копія вам
  MailApp.sendEmail({
    to:      WINERY_EMAIL,
    subject: `[Нове замовлення №${orderNum}] ${name} — ${total} пляш${plural(total)}`,
    body:    `Нове передзамовлення:\n\n${name}\n${data.phone}\n${data.email}\n${data.city}, НП: ${data.novaPoshta}\n\n${wineLines.join('\n')}\n\nКоментар: ${data.comment || '—'}`,
  });
}

function plural(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'ка';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'ки';
  return 'ок';
}

// ═══════════════════════════════════════════════════════════
//  ЯК НАЛАШТУВАТИ — покроково
// ═══════════════════════════════════════════════════════════
//
//  1. Відкрийте Google Sheets → створіть новий файл
//
//  2. Рядок 1 — заголовки (вставте вручну або скопіюйте):
//     № | Дата | Прізвище | Ім'я | Телефон | Email |
//     Місто | Відділення НП | Chardonnay | Sauvignon Blanc |
//     Трипільське Сонце | Всього пляшок | Коментар
//
//  3. Extensions → Apps Script
//     Видаліть весь вміст файлу Code.gs
//     Вставте цей код (без рядків з коментарем "ЯК НАЛАШТУВАТИ")
//     Змініть WINERY_EMAIL на вашу пошту
//
//  4. Збережіть (Ctrl+S)
//
//  5. Deploy → New deployment
//     Type: Web app
//     Execute as: Me
//     Who has access: Anyone
//     → Deploy
//     Скопіюйте Web app URL
//
//  6. У файлі script.js замініть:
//     const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_SCRIPT_URL_HERE';
//     на:
//     const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/ВАШ_ID/exec';
//
//  Готово! Форма записуватиме в таблицю і відправлятиме листи.
// ═══════════════════════════════════════════════════════════
