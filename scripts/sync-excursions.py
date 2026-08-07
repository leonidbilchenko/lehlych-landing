#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
#  LEHLYCH WINERY — синхронізація слотів екскурсій з Notion
#  База «Екскурсії» → excursions.json
#
#  Запуск:  python3 scripts/sync-excursions.py
#  Токен:   env NOTION_TOKEN  АБО .secrets/notion-token.txt
# ─────────────────────────────────────────────────────────────
import os, sys, json, time, urllib.request, urllib.error, pathlib
from datetime import datetime, timedelta, timezone

DATABASE_ID = "3b4dec54c7e68198bc5ce95e129c738a"   # база «Екскурсії»
NOTION_VERSION = "2022-06-28"
KYIV = timezone(timedelta(hours=3))

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRET_FILE = ROOT / ".secrets" / "notion-token.txt"
OUT_FILE = ROOT / "excursions.json"

MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня",
          "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"]
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"]


def get_token():
    tok = os.environ.get("NOTION_TOKEN")
    if tok:
        return tok.strip()
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text().strip()
    sys.exit("❌ Токен не знайдено (env NOTION_TOKEN або .secrets/notion-token.txt)")


def api(path, token, method="GET", body=None):
    url = f"https://api.notion.com/v1{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Notion-Version", NOTION_VERSION)
    req.add_header("Content-Type", "application/json")
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            sys.exit(f"❌ Notion API {e.code}: {e.read().decode()[:400]}")
        except Exception as e:
            print(f"   ⚠️ мережа, спроба {attempt}/3: {e}")
            if attempt < 3:
                time.sleep(3 * attempt)
    sys.exit("❌ Не вдалось звʼязатися з Notion")


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
    if t == "date":
        return (p["date"] or {}).get("start")
    if t == "rollup":
        r = p["rollup"]
        return r.get("number") if r.get("type") == "number" else None
    return None


def human_date(iso):
    """2026-08-21 → «пт, 21 серпня»"""
    d = datetime.strptime(iso[:10], "%Y-%m-%d")
    return f"{WEEKDAYS[d.weekday()]}, {d.day} {MONTHS[d.month - 1]}"


def main():
    token = get_token()
    print("→ Читаю слоти екскурсій з Notion…")

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

    today = datetime.now(KYIV).date()
    slots = []
    for r in results:
        pr = r["properties"]
        date_iso = field(pr, "Дата")
        status = field(pr, "Статус")
        kind = field(pr, "Тип") or "Публічна"

        if not date_iso or status != "Відкрито":
            continue
        if kind == "Індивідуальна":
            continue                       # внутрішній облік — на сайті не показуємо
        if datetime.strptime(date_iso[:10], "%Y-%m-%d").date() < today:
            continue                       # минулі не показуємо

        capacity = field(pr, "Місткість") or 20
        taken = field(pr, "Зайнято місць") or 0
        free = max(0, capacity - taken)

        slots.append({
            "id": r["id"],
            "date": date_iso[:10],
            "dateHuman": human_date(date_iso),
            "time": (field(pr, "Час") or "").strip(),
            "kind": kind,
            "capacity": capacity,
            "minimum": field(pr, "Мінімум") or 10,
            "price": field(pr, "Ціна за особу") or 1200,
            "taken": taken,
            "free": 0 if kind == "Корпоративна" else free,
            "bookable": kind == "Публічна" and free > 0,
            "note": field(pr, "Нотатка") or "",
        })
        mark = "🔒" if kind == "Корпоративна" else f"{free} вільних"
        print(f"   ✓ {date_iso[:10]} {slots[-1]['time']:>5}  {kind:<13} {mark}")

    slots.sort(key=lambda s: (s["date"], s["time"]))
    OUT_FILE.write_text(json.dumps(slots, ensure_ascii=False, indent=2))
    print(f"\n✅ Збережено {len(slots)} слотів → {OUT_FILE.name}")


if __name__ == "__main__":
    main()
