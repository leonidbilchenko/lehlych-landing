#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
#  LEHLYCH WINERY — збірка сайту з даних
#  products.json (+ content/wines-content.json) →
#     • каталог у index.html (між маркерами CATALOG)
#     • сторінки товарів  <slug>/index.html
#     • products.js (дані для кошика)
#
#  Запуск:  python3 scripts/build-site.py
# ─────────────────────────────────────────────────────────────
import json, pathlib, re, html as htmllib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PRODUCTS = json.loads((ROOT / "products.json").read_text())
CONTENT = json.loads((ROOT / "content" / "wines-content.json").read_text())
INDEX = ROOT / "index.html"
TEMPLATE = (ROOT / "templates" / "product.html").read_text()

BADGE_CLASS = {
    "Новинка": "new",
    "Bestseller": "best",
    "Limited": "limited",
    "Вибір сомельє": "somm",
    "Вибір сомель'є": "somm",
    "Вибір сомельʼє": "somm",
    "Акція": "sale",
    "Закінчується": "ending",
}


def esc(s):
    return htmllib.escape(str(s or ""))


def badges_html(badges):
    if not badges:
        return ""
    chips = "".join(
        f'<span class="badge badge-{BADGE_CLASS.get(b, "def")}">{esc(b)}</span>'
        for b in badges
    )
    return f'<div class="badges">{chips}</div>'


def price_html(p, cls="wine-price"):
    if p.get("onSale") and p.get("salePrice"):
        return (f'<p class="{cls}"><span class="price-old">{p["price"]} грн</span>'
                f'<span class="price-now">{p["salePrice"]} грн</span></p>')
    return f'<p class="{cls}">{p["price"]} грн</p>'


def catalog_card(p, href_prefix=""):
    subtitle = " · ".join(x for x in [p.get("wineType"), p.get("volume")] if x)
    if p["inStock"]:
        buy = f'<button class="buy-btn" onclick="addToCart(\'{p["slug"]}\')">Купити</button>'
    else:
        buy = '<button class="buy-btn out" disabled>Немає в наявності</button>'
    return f'''      <article class="wine-card">
        <a href="{href_prefix}{p["slug"]}/" class="wine-card-link">
          <div class="bottle-wrap">
            {badges_html(p.get("badges"))}
            <img src="/{esc(p["photo"])}" alt="{esc(p["name"])}" class="bottle-img">
          </div>
          <div class="wine-info">
            <h3 class="wine-name">{esc(p["name"])}</h3>
            <p class="wine-vintage">{esc(subtitle)}</p>
            {price_html(p)}
          </div>
        </a>
        <div class="wine-card-actions">{buy}</div>
      </article>'''


def spec_row(label, value):
    if not value:
        return ""
    return f'<div class="spec"><span class="spec-k">{esc(label)}</span><span class="spec-v">{esc(value)}</span></div>'


def related_block(current_slug):
    others = [x for x in PRODUCTS if x["slug"] != current_slug]
    if not others:
        return ""
    cards = "\n".join(catalog_card(x, href_prefix="/") for x in others)
    return f'''  <section class="related">
    <h2 class="related-title">З цим часто купують</h2>
    <div class="related-row">
{cards}
    </div>
  </section>'''


def gallery_html(p):
    """Галерея: головне фото + фото в оточенні (AI Photo). Якщо одне фото — без каруселі."""
    imgs = []
    if p.get("photo"):
        imgs.append(p["photo"])
    for a in (p.get("aiPhotos") or []):
        if a and a not in imgs:
            imgs.append(a)
    if not imgs:
        imgs = [p.get("photoWhite") or ""]

    badges = badges_html(p.get("badges"))
    main_src = "/" + esc(imgs[0])

    if len(imgs) > 1:
        nav = ('<button class="gallery-nav prev" type="button" onclick="galleryNav(-1)" aria-label="Попереднє">‹</button>'
               '<button class="gallery-nav next" type="button" onclick="galleryNav(1)" aria-label="Наступне">›</button>')
        thumbs = "".join(
            f'<button class="gallery-thumb{" active" if i == 0 else ""}" type="button" onclick="gallerySet({i})">'
            f'<img src="/{esc(im)}" alt="" loading="lazy"></button>'
            for i, im in enumerate(imgs))
        thumbs = f'<div class="gallery-thumbs">{thumbs}</div>'
    else:
        nav, thumbs = "", ""

    return (f'<div class="product-gallery" id="productGallery" data-idx="0">\n'
            f'        <div class="gallery-main">\n'
            f'          {badges}\n'
            f'          <img src="{main_src}" alt="{esc(p["name"])}" class="product-photo" id="galleryMainImg">\n'
            f'          {nav}\n'
            f'        </div>\n'
            f'        {thumbs}\n'
            f'      </div>')


def build_product_page(p, footer):
    name = esc(p["name"])
    subtitle = esc(" · ".join(x for x in [p.get("wineType"), p.get("year")] if x))
    desc = esc(p.get("description") or "")
    meta = (p.get("description") or p["name"])[:160]

    # price
    price_block = price_html(p, cls="product-price")

    # stock
    in_stock = p["inStock"]
    stock_class = "in" if in_stock else "out"
    stock_label = esc(p.get("stockLabel") or ("Є в наявності" if in_stock else "Немає"))

    # buy
    if in_stock:
        buy_block = (f'<div class="product-buy">'
                     f'<div class="qty-ctrl"><button class="qty-btn" onclick="pqty(-1)">−</button>'
                     f'<input class="qty-input" id="pQty" type="number" value="1" min="1" max="99">'
                     f'<button class="qty-btn" onclick="pqty(1)">+</button></div>'
                     f'<button class="add-cart-btn" onclick="addToCart(\'{p["slug"]}\', document.getElementById(\'pQty\').value)">Додати в кошик</button>'
                     f'</div>')
    else:
        buy_block = '<button class="add-cart-btn out" disabled>Немає в наявності</button>'

    # specs (з Notion)
    specs = "".join([
        spec_row("Сорт винограду", p.get("grape")),
        spec_row("Колір", p.get("color")),
        spec_row("Вміст спирту", p.get("alcohol")),
        spec_row("Місткість", p.get("volume")),
        spec_row("Температура подачі", p.get("serving")),
        spec_row("Походження винограду", p.get("origin")),
    ])

    # ароматичний профіль (окремий акцентний блок)
    tasting = ""
    if p.get("aroma"):
        tasting = (f'<div class="product-aroma">'
                   f'<span class="product-aroma-label">Ароматичний профіль</span>'
                   f'<p class="product-aroma-text">{esc(p["aroma"])}</p>'
                   f'</div>')

    out = TEMPLATE
    repl = {
        "{{TITLE}}": f"{name} — Lehlych Winery",
        "{{META_DESC}}": esc(meta),
        "{{PHOTO}}": "/" + esc(p["photo"]),
        "{{PHOTO_ROOT}}": esc(p["photo"]),
        "{{NAME}}": name,
        "{{SUBTITLE}}": subtitle,
        "{{GALLERY}}": gallery_html(p),
        "{{BADGES}}": badges_html(p.get("badges")),
        "{{PRICE_BLOCK}}": price_block,
        "{{STOCK_CLASS}}": stock_class,
        "{{STOCK_LABEL}}": stock_label,
        "{{BUY_BLOCK}}": buy_block,
        "{{SPECS}}": specs,
        "{{DESCRIPTION}}": desc,
        "{{TASTING}}": tasting,
        "{{RELATED}}": related_block(p["slug"]),
        "{{FOOTER}}": footer,
    }
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


def main():
    index = INDEX.read_text()

    # ── каталог ──
    cards = "\n".join(catalog_card(p) for p in PRODUCTS)
    index = re.sub(
        r"<!-- CATALOG:START -->.*?<!-- CATALOG:END -->",
        f"<!-- CATALOG:START -->\n{cards}\n      <!-- CATALOG:END -->",
        index, flags=re.S,
    )
    INDEX.write_text(index)
    print(f"→ Каталог: {len(PRODUCTS)} карток вписано в index.html")

    # ── footer для сторінок товарів (виправляємо шляхи) ──
    m = re.search(r"<!-- FOOTER:START -->(.*?)<!-- FOOTER:END -->", index, flags=re.S)
    footer = m.group(1).strip() if m else ""
    footer = footer.replace('src="logo/', 'src="../logo/')

    # ── сторінки товарів ──
    for p in PRODUCTS:
        page = build_product_page(p, footer)
        outdir = ROOT / p["slug"]
        outdir.mkdir(exist_ok=True)
        (outdir / "index.html").write_text(page)
        print(f"   ✓ /{p['slug']}/")

    # ── статичні сторінки (checkout, thank-you) з тим же футером ──
    for tpl_name, outdir in [("checkout.html", "checkout"), ("thankyou.html", "thank-you")]:
        tpl_path = ROOT / "templates" / tpl_name
        if not tpl_path.exists():
            continue
        page = tpl_path.read_text().replace("{{FOOTER}}", footer)
        d = ROOT / outdir
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(page)
        print(f"   ✓ /{outdir}/")

    # ── products.js (дані для кошика) ──
    data = [{
        "slug": p["slug"], "name": p["name"],
        "price": p["salePrice"] if (p.get("onSale") and p.get("salePrice")) else p["price"],
        "photo": "/" + p["photo"], "inStock": p["inStock"],
        "liqpayId": p.get("liqpayId"),
        "type": p.get("wineType"),
    } for p in PRODUCTS]
    (ROOT / "products.js").write_text("window.PRODUCTS = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")
    print(f"→ products.js: {len(data)} товарів")
    print("\n✅ Збірку завершено")


if __name__ == "__main__":
    main()
