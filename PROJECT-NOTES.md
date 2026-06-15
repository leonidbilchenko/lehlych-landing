# Lehlych Winery — нотатки проєкту (handoff)

Стислий опис системи, щоб будь-хто (або новий сеанс AI) швидко зорієнтувався.

## Що це
Інтернет-магазин вина **lehlych.com** (статичний сайт на GitHub Pages + Cloudflare DNS).
Власник: ТОВ «АГРОКОНСТРУКЦІЯ», бренд Lehlych Winery, акаунт **lehlychwinery@gmail.com**.

## Архітектура
- **Сайт** — статичний (HTML/CSS/JS), хоститься GitHub Pages, домен lehlych.com (HTTPS увімкнено).
- **Контент/асортимент** — у **Notion** (CMS). База «Вина» (assortment).
- **Замовлення** — пишуться в **Google Таблицю** (первинний журнал) + дублюються в **Notion CRM**.
- **Бекенд** — **Google Apps Script** (Web App), тримає всі секрети, підписує платежі, шле листи.
- **Оплата** — **LiqPay** (еквайринг ПриватБанку) + **ПРРО «Каса»** (фіскальні чеки, авто-зміна 24/7).
- **Аналітика** — Meta Pixel + GA4 (вмикаються лише після згоди на cookie у віковому вікні 18+).

## Ключові файли
- `index.html` — головна (герой + каталог, генерується між маркерами CATALOG).
- `<slug>/index.html` — сторінки товарів (генеруються build-скриптом).
- `checkout/index.html`, `thank-you/index.html` — генеруються з `templates/checkout.html`, `templates/thankyou.html`.
- `templates/product.html` — шаблон сторінки товару.
- `style.css`, `script.js` (кошик, вікове вікно, трекінг), `checkout.js` (оформлення + LiqPay), `products.js` (дані для кошика, генерується).
- `products.json` — дані товарів (генерується sync-скриптом).
- `content/wines-content.json` — НЕ використовується (старий локальний контент; усе тягнеться з Notion).
- `google-apps-script.js` — код бекенду (вставляється в Apps Script Code.gs).
- `scripts/sync-notion.py` — забирає дані+фото з Notion → products.json + images/products/.
- `scripts/build-site.py` — генерує каталог, сторінки товарів, checkout, thank-you, products.js.
- `.github/workflows/notion-sync.yml` — авто-синхронізація щогодини + кнопка Run workflow.

## Як оновлюється асортимент
1. Редагуєш базу «Вина» в Notion (ціна, наявність, опис, бейджі, акція, Порядок, LiqPay ID, фото).
2. GitHub Action `notion-sync` щогодини сам робить sync+build і комітить зміни → сайт оновлюється.
3. Миттєво: GitHub → Actions → «Синхронізація асортименту з Notion» → Run workflow.
Локально вручну: `python3 scripts/sync-notion.py && python3 scripts/build-site.py`.

### Логіка полів Notion (база «Вина», id `379dec54c7e68022a9eee2b687a05d99`)
- Показ на сайті: `Site Status = Published`.
- Наявність: `Статус на сайті` = «Є в наявності».
- Ціна: `RRP`. Акція показується ЛИШЕ якщо всі 3: чекбокс `Акція` + `Акційна ціна` + тег «Акція» в `Bage`.
- Порядок у каталозі: `Порядок` (Number).
- Фіскалізація: `LiqPay ID` (Number) — id товару з LiqPay «Товари».
- Контент: Тип вина, Рік врожаю, Сорт винограду, Колір, Вміст спирту, Місткість, Температура подачі, Походження винограду, Ароматичний профіль, Опис.

## Замовлення / CRM
- Google Таблиця (журнал), ID: `1o5SDXNmEVABhplGpInRpwS6wP6YyULpwKhaUDjBHydU`.
- Notion CRM (база «CRM»), id: `379dec54c7e6808d975fc5f583d2483c`.
- Колонки CRM: № замовлення, Дата, Прізвище, Ім'я, Телефон, Email, Місто, Відділення, Товари, Сума, Статус (Нове/Оплачено/Відправлено/Доставлено/Скасовано), Оплата (Очікує/Оплачено), Коментар.
- Покупцю після оплати: лист-підтвердження (Apps Script) + фіскальний чек (LiqPay ПРРО). Копія листа — на lehlychwinery@gmail.com.

## Аналітика продажів + Telegram-звіт
- Вкладка **«Продажі»** в Google Таблиці (МІСЯЦЬ/ДАТА/БРЕНД/ТИП/ВИНО/ПРОДАНО/СУМА). Агрегація по день+вино, лише оплачені.
- Запис автоматично при оплаті (`liqpayCallback` → `recordSale`, ідемпотентно). Ціну й тип бере з `products.js` сайту (`productsMap`); позиції — з колонки «Товари» (`parseItems`).
- `backfillSales()` — перебудувати «Продажі» з нуля за всіма оплаченими замовленнями (одноразово/за потреби).
- **Щоденний звіт о 9:00** (`sendDailyReport`) у Telegram-групу: за вчора по сортах + разом + підсумок з початку. Тригер: Apps Script → Тригери → Денний таймер 9:00–10:00.
- Telegram: бот «Lehlych Продажі», група «Lehlych_Sales». Script Properties: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT` (`-1004461856394`).
- `getChatId()` — тимчасова: дізнатись ID групи (Run → Логи).

## Бекенд (Apps Script)
- Web App URL (CHECKOUT_URL у checkout.js):
  `https://script.google.com/macros/s/AKfycbwMR4ohnguTxkzUdoqDDERrM3caroSHZ99Ry8LUYguqVOboGpXp4GV60x2NLxzqQrtNVQ/exec`
- doPost: createOrder (Таблиця → Notion → LiqPay data+signature, з rro_info для чека) + liqpayCallback (статус «Оплачено» + листи).
- doGet: проксі Нової Пошти (npCities/npWarehouses) для автодоповнення в checkout.
- **Після зміни коду** Code.gs треба перерозгорнути нову версію: Ввести в дію → Керування розгортаннями → ✏️ → Версія: Нова → Ввести в дію (URL не змінюється).
- **Зміна Script Properties** діє одразу, без редеплою.

## Секрети (НІДЕ в коді сайту!)
- **Apps Script → Project Settings → Script Properties:**
  ORDERS_SHEET_ID, NOTION_ORDERS_DB, NOTION_TOKEN, LIQPAY_PUBLIC (`i25552296555`), LIQPAY_PRIVATE, SANDBOX (`0`), SITE_URL (`https://lehlych.com`), WINERY_EMAIL, TELEGRAM_TOKEN, TELEGRAM_CHAT.
- **Локально:** `.secrets/notion-token.txt` (gitignored).
- **GitHub Secret:** `NOTION_TOKEN` (для авто-синхронізації).

## LiqPay / ПРРО
- Магазин активований, public_key **i25552296555**, підвʼязаний до ПРРО «Каса».
- Фіскалізація: rro_info будується в createOrder (items: amount/price/cost/id + delivery_emails [покупець, winery]).
- Каса: **авто-зміна** — відкривається при першій операції, закривається ~23:55 (Z-звіт). Чеки пробиваються автоматично.
- `TEST_MODE` у checkout.js = false (оплата увімкнена). Поставити true — вимкнути оплату (показує «магазин готується»).

## Публікація
Коміт локально (я) → користувач у **GitHub Desktop** натискає **Push origin** → GitHub Pages деплой (1-2 хв) → lehlych.com.
Перевірити деплой: GitHub → Actions → «pages build and deployment» (зелена галочка).
Примітка: у Chrome профілі «Робочий» є розширення, що блокує liqpay.ua — для роботи з LiqPay використовувати Safari або інкогніто.

## Готово ✅
Сайт, каталог, кошик, checkout, оплата LiqPay, фіскальний чек ПРРО (24/7), замовлення → Таблиця+Notion+листи, автосинхронізація Notion, HTTPS, 18+, оферта/політика/повернення/контакти, Meta Pixel + GA (після згоди).

## Опційно на майбутнє
- Instagram-стрічка (через Meta API — потрібен бізнес-акаунт IG + токен з оновленням кожні 60 днів; можна автоматизувати в build).
- Події покупок у пікселях (ViewContent/AddToCart/Purchase) для окупності реклами.
- Сторінки футера: «Доставка та оплата», «Екскурсія», «Корпоративні замовлення», «Співпраця» (зараз «розділ в розробці»).
- Прибрати тимчасову функцію `liqpayTest` з Apps Script Code.gs (безпечна, але зайва).
- Перевірити серверну валідацію цін у бекенді (зараз ціна довіряється з фронту — для масштабу варто звіряти з products.json/Notion).
