#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
#  LEHLYCH WINERY — синхронізація асортименту з Notion
#  Читає базу Notion → пише products.json + завантажує фото
#
#  Запуск:  python3 scripts/sync-notion.py
#  Токен:   береться з .secrets/notion-token.txt  АБО env NOTION_TOKEN
# ─────────────────────────────────────────────────────────────
import os, sys, json, urllib.request, urllib.error, pathlib, re

DATABASE_ID = "379dec54c7e68022a9eee2b687a05d99"
NOTION_VERSION = "2022-06-28"

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRET_FILE = ROOT / ".secrets" / "notion-token.txt"
PHOTO_DIR = ROOT / "images" / "products"
OUT_FILE = ROOT / "products.json"


def get_token():
    tok = os.environ.get("NOTION_TOKEN")
    if tok:
        return tok.strip()
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text().strip()
    sys.exit("❌ Токен не знайдено (ні в env NOTION_TOKEN, ні в .secrets/notion-token.txt)")


def api(path, token, method="GET", body=None):
    url = f"https://api.notion.com/v1{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Notion-Version", NOTION_VERSION)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"❌ Notion API {e.code}: {e.read().decode()}")


# ── helpers для читання полів Notion ──
def p_txt(arr):
    return "".join(t.get("plain_text", "") for t in arr)


def field(props, name):
    p = props.get(name)
    if not p:
        return None
    t = p["type"]
    if t == "title":
        return p_txt(p["title"])
    if t == "rich_text":
        return p_txt(p["rich_text"])
    if t == "number":
        return p["number"]
    if t == "select":
        return (p["select"] or {}).get("name")
    if t == "multi_select":
        return [x["name"] for x in p["multi_select"]]
    if t == "checkbox":
        return p["checkbox"]
    if t == "files":
        out = []
        for f in p["files"]:
            if f["type"] == "file":
                out.append(f["file"]["url"])
            elif f["type"] == "external":
                out.append(f["external"]["url"])
        return out
    return None


def slugify(name):
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[\s_]+", "-", s)
    return s


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url) as r:
            dest.write_bytes(r.read())
        return True
    except Exception as e:
        print(f"   ⚠️ не вдалось завантажити фото: {e}")
        return False


def main():
    token = get_token()
    print("→ Читаю базу Notion…")

    results, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        data = api(f"/databases/{DATABASE_ID}/query", token, "POST", body)
        results.extend(data["results"])
        if not data.get("has_more"):
            break
        cursor = data["next_cursor"]

    products = []
    for r in results:
        pr = r["properties"]
        name = field(pr, "Name")
        site_status = field(pr, "Site Status")
        if site_status != "Published":
            continue  # показуємо лише опубліковані

        slug = field(pr, "Slug") or slugify(name)
        rrp = field(pr, "RRP")
        sale_price = field(pr, "Акційна ціна")
        on_sale = field(pr, "Акція")
        stock = field(pr, "Статус на сайті")
        badges = field(pr, "Bage") or []

        photos_white = field(pr, "Photo_white") or []
        photos_transp = field(pr, "Photo_transparrent") or []

        # завантажуємо фото локально (посилання Notion протухають)
        local = {"white": None, "transparent": None}
        if photos_white:
            ext = photos_white[0].split("?")[0].split(".")[-1][:4] or "png"
            dest = PHOTO_DIR / slug / f"white.{ext}"
            if download(photos_white[0], dest):
                local["white"] = str(dest.relative_to(ROOT))
        if photos_transp:
            ext = photos_transp[0].split("?")[0].split(".")[-1][:4] or "png"
            dest = PHOTO_DIR / slug / f"transparent.{ext}"
            if download(photos_transp[0], dest):
                local["transparent"] = str(dest.relative_to(ROOT))

        products.append({
            "name": name,
            "slug": slug,
            "order": field(pr, "Порядок"),
            "type": field(pr, "Тип"),
            # ── контент з Notion ──
            "wineType": field(pr, "Тип вина"),
            "year": field(pr, "Рік врожаю"),
            "grape": field(pr, "Сорт винограду"),
            "color": field(pr, "Колір"),
            "alcohol": field(pr, "Вміст спирту"),
            "volume": field(pr, "Місткість"),
            "serving": field(pr, "Температура подачі"),
            "origin": field(pr, "Походження винограду"),
            "aroma": field(pr, "Ароматичний профіль"),
            "description": field(pr, "Опис"),
            "price": rrp,
            "salePrice": sale_price if on_sale else None,
            "onSale": bool(on_sale) and sale_price is not None,
            "inStock": stock == "Є в наявності",
            "stockLabel": stock,
            "badges": badges,
            "sku": field(pr, "sku-art"),
            "barcode": field(pr, "Barcode"),
            "photo": local["transparent"] or local["white"],
            "photoWhite": local["white"],
            "photoTransparent": local["transparent"],
        })
        print(f"   ✓ {name}  ({rrp} грн, {stock})")

    # Сортуємо за колонкою "Порядок" (порожні — в кінець)
    products.sort(key=lambda p: p["order"] if p["order"] is not None else 9999)

    OUT_FILE.write_text(json.dumps(products, ensure_ascii=False, indent=2))
    print(f"\n✅ Збережено {len(products)} товарів → {OUT_FILE.name}")


if __name__ == "__main__":
    main()
