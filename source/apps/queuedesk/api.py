import os
import sys
import sqlite3
import random
import datetime as dt
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel

router = APIRouter()

APP_ID = "queuedesk"

_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def _hub():
    return sys.modules.get("backend.apphub")


def _esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).date().isoformat()


def _conn():
    if not os.path.exists(_DB_PATH):
        return None
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _private_page():
    notfound = sys.modules.get("backend.notfound")
    return notfound.render_404() if notfound else _not_found()


def _not_found():
    return Response("Not found", status_code=404)


def _owner_for_slug(c, slug):
    row = c.execute("SELECT public_user_id FROM public_slugs WHERE slug=?", (slug,)).fetchone()
    return row["public_user_id"] if row else None


def _get_settings(c, uid):
    rows = c.execute("SELECT key, value FROM settings WHERE public_user_id=?", (uid,)).fetchall()
    out = {"mode": "schedule", "business_name": "", "public_lang": "en", "public_page_enabled": "0"}
    out.update({r["key"]: r["value"] for r in rows})
    if out["public_lang"] not in ("en", "bg"):
        out["public_lang"] = "en"
    return out


def _gated(c):
    hub = _hub()
    return hub and not hub.is_app_public(APP_ID)


# ── Schedule-mode slot computation (mirrors backend.py) ──────────────────────

def _slots_for_date(c, uid, date_str):
    try:
        weekday = dt.date.fromisoformat(date_str).weekday()
    except ValueError:
        return []
    closed = c.execute(
        "SELECT 1 FROM date_overrides WHERE public_user_id=? AND date=?", (uid, date_str)
    ).fetchone()
    if closed:
        return []
    rules = c.execute(
        "SELECT * FROM schedule_rules WHERE public_user_id=? AND weekday=? ORDER BY start_time",
        (uid, weekday),
    ).fetchall()
    booked = {
        r["start_time"]
        for r in c.execute(
            "SELECT start_time FROM bookings WHERE public_user_id=? AND date=? AND status='booked'",
            (uid, date_str),
        ).fetchall()
    }
    now_iso = _now()
    is_today = date_str == _today()
    now_hm = now_iso[11:16]
    slots = []
    for rule in rules:
        h, m = map(int, rule["start_time"].split(":"))
        eh, em = map(int, rule["end_time"].split(":"))
        cur_min = h * 60 + m
        end_min = eh * 60 + em
        step = rule["slot_minutes"]
        while cur_min + step <= end_min:
            start = f"{cur_min // 60:02d}:{cur_min % 60:02d}"
            end_c = cur_min + step
            end = f"{end_c // 60:02d}:{end_c % 60:02d}"
            if not (is_today and start <= now_hm):
                slots.append({"start_time": start, "end_time": end, "booked": start in booked})
            cur_min += step
    slots.sort(key=lambda s: s["start_time"])
    return slots


def _avg_service_seconds(c, uid):
    rows = c.execute(
        "SELECT called_at, served_at FROM queue_tickets "
        "WHERE public_user_id=? AND status='served' AND called_at IS NOT NULL AND served_at IS NOT NULL "
        "ORDER BY served_at DESC LIMIT 20",
        (uid,),
    ).fetchall()
    if not rows:
        return 600.0
    total = 0.0
    for r in rows:
        a = datetime.fromisoformat(r["called_at"])
        b = datetime.fromisoformat(r["served_at"])
        total += (b - a).total_seconds()
    return max(total / len(rows), 30.0)


# ── JSON API ──────────────────────────────────────────────────────────────────

@router.get("/{slug}/info")
async def info(slug: str):
    c = _conn()
    if not c or _gated(c):
        return JSONResponse({"error": "not_found"}, status_code=404)
    uid = _owner_for_slug(c, slug)
    if not uid:
        return JSONResponse({"error": "not_found"}, status_code=404)
    s = _get_settings(c, uid)
    return JSONResponse({"mode": s["mode"], "business_name": s["business_name"], "lang": s["public_lang"]})


@router.get("/{slug}/availability")
async def availability(slug: str, date: str):
    c = _conn()
    if not c or _gated(c):
        return JSONResponse({"error": "not_found"}, status_code=404)
    uid = _owner_for_slug(c, slug)
    if not uid:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse(_slots_for_date(c, uid, date))


class BookBody(BaseModel):
    date: str
    start_time: str
    client_name: str
    client_phone: str = ""
    client_email: str = ""
    message: str = ""


@router.post("/{slug}/book")
async def book(slug: str, body: BookBody):
    c = _conn()
    if not c or _gated(c):
        return JSONResponse({"error": "not_found"}, status_code=404)
    uid = _owner_for_slug(c, slug)
    if not uid:
        return JSONResponse({"error": "not_found"}, status_code=404)
    if not body.client_name.strip():
        return JSONResponse({"error": "name_required"}, status_code=400)
    slots = _slots_for_date(c, uid, body.date)
    match = next((sl for sl in slots if sl["start_time"] == body.start_time), None)
    if not match:
        return JSONResponse({"error": "invalid_slot"}, status_code=400)
    if match["booked"]:
        return JSONResponse({"error": "slot_taken"}, status_code=409)
    try:
        c.execute(
            "INSERT INTO bookings (public_user_id, date, start_time, end_time, client_name, "
            "client_phone, client_email, message, status, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,'booked',?)",
            (uid, body.date, body.start_time, match["end_time"], body.client_name.strip(),
             body.client_phone.strip(), body.client_email.strip(), body.message.strip(), _now()),
        )
        c.commit()
    except sqlite3.IntegrityError:
        return JSONResponse({"error": "slot_taken"}, status_code=409)
    return JSONResponse({"ok": True, "date": body.date, "start_time": body.start_time, "end_time": match["end_time"]})


@router.get("/{slug}/queue")
async def queue_status(slug: str):
    c = _conn()
    if not c or _gated(c):
        return JSONResponse({"error": "not_found"}, status_code=404)
    uid = _owner_for_slug(c, slug)
    if not uid:
        return JSONResponse({"error": "not_found"}, status_code=404)
    today = _today()
    state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
    same_day = state and state["date"] == today
    current_number = state["current_number"] if same_day else 0
    limit_remaining = state["limit_remaining"] if same_day else None
    accepting = limit_remaining is None or limit_remaining > 0
    waiting = c.execute(
        "SELECT COUNT(*) n FROM queue_tickets WHERE public_user_id=? AND date=? AND status IN ('waiting','called')",
        (uid, today),
    ).fetchone()["n"]
    return JSONResponse({
        "date": today, "current_number": current_number, "waiting": waiting, "accepting": accepting,
    })


class TicketBody(BaseModel):
    client_name: str
    client_phone: str = ""
    client_email: str = ""
    message: str = ""


@router.post("/{slug}/ticket")
async def pull_ticket(slug: str, body: TicketBody):
    c = _conn()
    if not c or _gated(c):
        return JSONResponse({"error": "not_found"}, status_code=404)
    uid = _owner_for_slug(c, slug)
    if not uid:
        return JSONResponse({"error": "not_found"}, status_code=404)
    if not body.client_name.strip():
        return JSONResponse({"error": "name_required"}, status_code=400)
    today = _today()

    state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
    limited = bool(state and state["date"] == today and state["limit_remaining"] is not None)
    if limited:
        cur = c.execute(
            "UPDATE queue_state SET limit_remaining = limit_remaining - 1 "
            "WHERE public_user_id=? AND date=? AND limit_remaining > 0",
            (uid, today),
        )
        c.commit()
        if cur.rowcount == 0:
            return JSONResponse({"error": "queue_full"}, status_code=409)

    for _attempt in range(5):
        row = c.execute(
            "SELECT COALESCE(MAX(number), 0) n FROM queue_tickets WHERE public_user_id=? AND date=?",
            (uid, today),
        ).fetchone()
        number = row["n"] + 1
        code = "".join(random.choices("0123456789", k=6))
        try:
            cur = c.execute(
                "INSERT INTO queue_tickets (public_user_id, date, number, client_name, client_phone, "
                "client_email, message, status, created_at, verify_code) VALUES (?,?,?,?,?,?,?,'waiting',?,?)",
                (uid, today, number, body.client_name.strip(), body.client_phone.strip(),
                 body.client_email.strip(), body.message.strip(), _now(), code),
            )
            c.commit()
            tid = cur.lastrowid
            break
        except sqlite3.IntegrityError:
            continue
    else:
        if limited:
            c.execute(
                "UPDATE queue_state SET limit_remaining = limit_remaining + 1 WHERE public_user_id=? AND date=?",
                (uid, today),
            )
            c.commit()
        return JSONResponse({"error": "try_again"}, status_code=409)

    state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
    current_number = state["current_number"] if state and state["date"] == today else 0
    ahead = c.execute(
        "SELECT COUNT(*) n FROM queue_tickets WHERE public_user_id=? AND date=? AND status IN ('waiting','called') AND number<?",
        (uid, today, number),
    ).fetchone()["n"]
    avg_s = _avg_service_seconds(c, uid)
    est_seconds = ahead * avg_s
    return JSONResponse({
        "id": tid, "number": number, "current_number": current_number,
        "position_ahead": ahead, "estimated_seconds": est_seconds, "verify_code": code,
    })


@router.get("/{slug}/ticket/{tid}")
async def ticket_status(slug: str, tid: int):
    c = _conn()
    if not c or _gated(c):
        return JSONResponse({"error": "not_found"}, status_code=404)
    uid = _owner_for_slug(c, slug)
    if not uid:
        return JSONResponse({"error": "not_found"}, status_code=404)
    today = _today()
    t = c.execute(
        "SELECT * FROM queue_tickets WHERE id=? AND public_user_id=?", (tid, uid)
    ).fetchone()
    if not t:
        return JSONResponse({"error": "not_found"}, status_code=404)
    state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
    current_number = state["current_number"] if state and state["date"] == today else 0
    ahead = c.execute(
        "SELECT COUNT(*) n FROM queue_tickets WHERE public_user_id=? AND date=? AND status IN ('waiting','called') AND number<?",
        (uid, t["date"], t["number"]),
    ).fetchone()["n"] if t["status"] in ("waiting", "called") else 0
    avg_s = _avg_service_seconds(c, uid)
    active = t["status"] in ("waiting", "called") and t["date"] == today
    return JSONResponse({
        "number": t["number"], "status": t["status"], "current_number": current_number,
        "position_ahead": ahead, "estimated_seconds": ahead * avg_s,
        "verify_code": t["verify_code"], "active": active,
    })


class CancelTicketBody(BaseModel):
    verify_code: str = ""


@router.post("/{slug}/ticket/{tid}/cancel")
async def cancel_own_ticket(slug: str, tid: int, body: CancelTicketBody):
    c = _conn()
    if not c or _gated(c):
        return JSONResponse({"error": "not_found"}, status_code=404)
    uid = _owner_for_slug(c, slug)
    if not uid:
        return JSONResponse({"error": "not_found"}, status_code=404)
    t = c.execute(
        "SELECT * FROM queue_tickets WHERE id=? AND public_user_id=?", (tid, uid)
    ).fetchone()
    if not t or t["verify_code"] != body.verify_code:
        return JSONResponse({"error": "not_found"}, status_code=404)
    if t["status"] not in ("waiting", "called"):
        return JSONResponse({"error": "not_cancellable"}, status_code=409)
    today = _today()
    c.execute("UPDATE queue_tickets SET status='cancelled' WHERE id=?", (tid,))
    if t["date"] == today:
        c.execute(
            "UPDATE queue_state SET limit_remaining = limit_remaining + 1 "
            "WHERE public_user_id=? AND date=? AND limit_remaining IS NOT NULL",
            (uid, today),
        )
    c.commit()
    return JSONResponse({"ok": True})


# ── Public HTML page ──────────────────────────────────────────────────────────

_STRINGS = {
    "en": {
        "book_title": "Book an appointment",
        "queue_title": "Take a number",
        "pick_date": "Pick a date",
        "no_slots": "No free slots for this day.",
        "your_name": "Your name",
        "phone": "Phone",
        "email": "Email (optional)",
        "message": "Message (optional)",
        "confirm": "Confirm",
        "booked_ok": "Booked! We'll see you on",
        "at": "at",
        "slot_taken": "Sorry, that slot was just taken — pick another.",
        "name_required": "Please enter your name.",
        "current_serving": "Now serving",
        "get_number": "Get a number",
        "your_number": "Your number",
        "people_ahead": "people ahead of you",
        "est_wait": "Estimated wait",
        "min": "min",
        "waiting_now": "waiting",
        "back": "← Back",
        "footer": "Powered by mvmOS QueueDesk",
        "queue_full": "Sorry, no more numbers are being given out right now.",
        "not_accepting": "Not taking new numbers right now.",
        "verify_code_label": "Verification code",
        "cancel_ticket": "Cancel my number",
        "confirm_cancel_ticket": "Cancel your number? You can get a new one afterwards.",
        "cancel_failed": "Could not cancel — please try again.",
    },
    "bg": {
        "book_title": "Запази час",
        "queue_title": "Изтегли номер",
        "pick_date": "Избери дата",
        "no_slots": "Няма свободни часове за този ден.",
        "your_name": "Име",
        "phone": "Телефон",
        "email": "Имейл (незадължително)",
        "message": "Съобщение (незадължително)",
        "confirm": "Потвърди",
        "booked_ok": "Запазено! Очакваме те на",
        "at": "в",
        "slot_taken": "За съжаление часът вече е зает — избери друг.",
        "name_required": "Моля, въведи име.",
        "current_serving": "Текущ номер",
        "get_number": "Изтегли номер",
        "your_number": "Твоят номер",
        "people_ahead": "души преди теб",
        "est_wait": "Очаквано чакане",
        "min": "мин",
        "waiting_now": "чакащи",
        "back": "← Назад",
        "footer": "Powered by mvmOS QueueDesk",
        "queue_full": "За съжаление в момента не се раздават нови номера.",
        "not_accepting": "В момента не се приемат нови номера.",
        "verify_code_label": "Код за проверка",
        "cancel_ticket": "Откажи номера ми",
        "confirm_cancel_ticket": "Да се откаже ли номерът ти? След това можеш да изтеглиш нов.",
        "cancel_failed": "Неуспешен отказ — опитай отново.",
    },
}


async def _public_page(slug: str, direct: bool):
    c = _conn()
    if not c or _gated(c):
        return _private_page()
    uid = _owner_for_slug(c, slug)
    if not uid:
        return _not_found()
    s = _get_settings(c, uid)
    if direct and str(s.get("public_page_enabled", "0")).lower() not in ("1", "true"):
        return _private_page()
    lang = s["public_lang"]
    t = _STRINGS.get(lang, _STRINGS["en"])
    business = _esc(s["business_name"]) or "QueueDesk"
    mode = s["mode"]

    html = f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{business}</title>
<style>
  *,*::before,*::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f7f8fa; color: #1a1a2e; min-height: 100vh; padding: 32px 16px 60px;
  }}
  .card {{
    background: #fff; border: 1px solid #e2e4ea; border-radius: 10px;
    max-width: 480px; margin: 0 auto; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.06);
  }}
  .card-header {{ padding: 22px 28px 18px; border-bottom: 1px solid #e2e4ea; }}
  .brand {{ font-size: .74rem; color: #aaa; margin-bottom: 5px; letter-spacing: .05em; text-transform: uppercase; }}
  h1 {{ font-size: 1.25rem; font-weight: 700; }}
  .card-body {{ padding: 22px 28px 28px; }}
  label {{ display: block; font-size: .78rem; color: #666; margin: 12px 0 4px; }}
  label:first-child {{ margin-top: 0; }}
  input, textarea, select {{
    width: 100%; padding: 9px 11px; border: 1px solid #d8dae0; border-radius: 6px;
    font-size: .9rem; font-family: inherit; outline: none; background: #fff; color: #1a1a2e;
  }}
  input:focus, textarea:focus, select:focus {{ border-color: #2563eb; }}
  textarea {{ resize: vertical; min-height: 60px; }}
  button {{
    background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 10px 18px;
    font-size: .88rem; cursor: pointer; font-family: inherit; font-weight: 600;
  }}
  button:hover {{ background: #1d4ed8; }}
  button:disabled {{ background: #b7c3d6; cursor: default; }}
  button.ghost {{ background: transparent; color: #2563eb; padding: 6px 4px; font-weight: 500; }}
  button.ghost:hover {{ background: transparent; text-decoration: underline; }}
  .slots {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }}
  .slot {{
    border: 1px solid #d8dae0; border-radius: 6px; padding: 7px 12px; font-size: .85rem;
    cursor: pointer; background: #fff;
  }}
  .slot:hover {{ border-color: #2563eb; color: #2563eb; }}
  .slot.booked {{ background: #f0f1f5; color: #b3b6c0; cursor: default; text-decoration: line-through; }}
  .slot.booked:hover {{ border-color: #d8dae0; color: #b3b6c0; }}
  .hint {{ font-size: .8rem; color: #999; margin-top: 10px; }}
  .msg-ok {{ background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; border-radius: 8px; padding: 14px; font-size: .88rem; }}
  .msg-err {{ background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 8px; padding: 10px 14px; font-size: .82rem; margin-top: 10px; }}
  .queue-board {{ text-align: center; padding: 10px 0 4px; }}
  .queue-num {{ font-size: 3.2rem; font-weight: 800; color: #2563eb; line-height: 1; }}
  .queue-sub {{ font-size: .82rem; color: #888; margin-top: 6px; }}
  .my-ticket {{ text-align: center; padding: 18px 0 4px; }}
  .my-ticket .num {{ font-size: 2.6rem; font-weight: 800; color: #16a34a; line-height: 1; }}
  .footer {{ padding: 12px 28px; border-top: 1px solid #e2e4ea; font-size: .72rem; color: #bbb; text-align: right; }}
  @media (max-width: 480px) {{ .card-header, .card-body, .footer {{ padding-left: 16px; padding-right: 16px; }} }}
</style>
</head>
<body>
<div class="card">
  <div class="card-header">
    <div class="brand">QueueDesk</div>
    <h1>{business}</h1>
  </div>
  <div class="card-body" id="app">Loading…</div>
  <div class="footer">{_esc(t["footer"])}</div>
</div>
<script>
const SLUG = {slug!r};
const MODE = {mode!r};
const T = {t!r};

function esc(s) {{ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }}
async function api(method, path, body) {{
  const opts = {{ method, headers: {{}} }};
  if (body !== undefined) {{ opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }}
  const r = await fetch(`/pub/queuedesk/${{SLUG}}${{path}}`, opts);
  const data = await r.json().catch(() => ({{}}));
  return {{ ok: r.ok, status: r.status, data }};
}}

const app = document.getElementById('app');
let _myTicketId = null;
let _pollTimer = null;

if (MODE === 'schedule') renderSchedule(); else renderQueue();

// ── Schedule mode ────────────────────────────────────────────────────────
function renderSchedule() {{
  const today = new Date().toISOString().slice(0,10);
  app.innerHTML = `
    <label>${{esc(T.pick_date)}}</label>
    <input type="date" id="qd-date" value="${{today}}" min="${{today}}">
    <div id="qd-slots" class="slots"></div>
    <div id="qd-form"></div>
  `;
  const dateEl = document.getElementById('qd-date');
  dateEl.addEventListener('change', loadSlots);
  loadSlots();

  async function loadSlots() {{
    const wrap = document.getElementById('qd-slots');
    document.getElementById('qd-form').innerHTML = '';
    wrap.innerHTML = '…';
    const {{ data }} = await api('GET', `/availability?date=${{dateEl.value}}`);
    if (!Array.isArray(data) || data.length === 0) {{
      wrap.innerHTML = `<div class="hint">${{esc(T.no_slots)}}</div>`;
      return;
    }}
    wrap.innerHTML = '';
    data.forEach(sl => {{
      const b = document.createElement('div');
      b.className = 'slot' + (sl.booked ? ' booked' : '');
      b.textContent = sl.start_time;
      if (!sl.booked) b.onclick = () => showForm(dateEl.value, sl.start_time);
      wrap.appendChild(b);
    }});
  }}

  function showForm(date, startTime) {{
    document.getElementById('qd-form').innerHTML = `
      <label>${{esc(T.your_name)}}</label>
      <input id="qd-name">
      <label>${{esc(T.phone)}}</label>
      <input id="qd-phone">
      <label>${{esc(T.email)}}</label>
      <input id="qd-email" type="email">
      <label>${{esc(T.message)}}</label>
      <textarea id="qd-msg"></textarea>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center">
        <button id="qd-submit">${{esc(T.confirm)}} — ${{esc(date)}} ${{esc(T.at)}} ${{esc(startTime)}}</button>
      </div>
      <div id="qd-err"></div>
    `;
    document.getElementById('qd-submit').onclick = async () => {{
      const name = document.getElementById('qd-name').value.trim();
      const errEl = document.getElementById('qd-err');
      errEl.innerHTML = '';
      if (!name) {{ errEl.innerHTML = `<div class="msg-err">${{esc(T.name_required)}}</div>`; return; }}
      const btn = document.getElementById('qd-submit');
      btn.disabled = true;
      const {{ ok, status, data }} = await api('POST', '/book', {{
        date, start_time: startTime,
        client_name: name,
        client_phone: document.getElementById('qd-phone').value.trim(),
        client_email: document.getElementById('qd-email').value.trim(),
        message: document.getElementById('qd-msg').value.trim(),
      }});
      if (!ok) {{
        btn.disabled = false;
        if (status === 409) {{ errEl.innerHTML = `<div class="msg-err">${{esc(T.slot_taken)}}</div>`; loadSlots(); }}
        else errEl.innerHTML = `<div class="msg-err">${{esc(data.error || 'error')}}</div>`;
        return;
      }}
      app.innerHTML = `<div class="msg-ok">${{esc(T.booked_ok)}} ${{esc(data.date)}} ${{esc(T.at)}} ${{esc(data.start_time)}}.</div>`;
    }};
  }}
}}

// ── Queue mode ───────────────────────────────────────────────────────────
function renderQueue() {{
  app.innerHTML = `
    <div class="queue-board">
      <div class="queue-num" id="qd-current">—</div>
      <div class="queue-sub">${{esc(T.current_serving)}} · <span id="qd-waiting">0</span> ${{esc(T.waiting_now)}}</div>
    </div>
    <div id="qd-action" style="text-align:center;margin-top:16px"></div>
    <div id="qd-form"></div>
    <div id="qd-mine"></div>
  `;
  refreshQueue();
  _pollTimer = setInterval(refreshQueue, 5000);
  checkSavedTicket();

  function storageKey() {{ return 'qd_ticket_' + SLUG; }}
  function saveTicket(id, code) {{
    try {{ localStorage.setItem(storageKey(), JSON.stringify({{ id, code }})); }} catch (e) {{}}
  }}
  function clearSavedTicket() {{
    try {{ localStorage.removeItem(storageKey()); }} catch (e) {{}}
  }}
  function loadSavedTicket() {{
    try {{
      const raw = localStorage.getItem(storageKey());
      return raw ? JSON.parse(raw) : null;
    }} catch (e) {{ return null; }}
  }}

  function showGetButton() {{
    document.getElementById('qd-mine').innerHTML = '';
    document.getElementById('qd-action').innerHTML = `<button id="qd-get">${{esc(T.get_number)}}</button>`;
    document.getElementById('qd-get').onclick = showTicketForm;
  }}

  async function checkSavedTicket() {{
    const saved = loadSavedTicket();
    if (!saved) {{ showGetButton(); return; }}
    const r = await api('GET', `/ticket/${{saved.id}}`);
    if (!r.ok || !r.data.active) {{
      clearSavedTicket();
      showGetButton();
      return;
    }}
    _myTicketId = saved.id;
    document.getElementById('qd-action').innerHTML = '';
    renderMine(r.data);
  }}

  function showTicketForm() {{
    document.getElementById('qd-action').innerHTML = '';
    document.getElementById('qd-form').innerHTML = `
      <label>${{esc(T.your_name)}}</label>
      <input id="qd-name">
      <label>${{esc(T.phone)}}</label>
      <input id="qd-phone">
      <label>${{esc(T.email)}}</label>
      <input id="qd-email" type="email">
      <label>${{esc(T.message)}}</label>
      <textarea id="qd-msg"></textarea>
      <div style="margin-top:14px"><button id="qd-submit">${{esc(T.confirm)}}</button></div>
      <div id="qd-err"></div>
    `;
    document.getElementById('qd-submit').onclick = async () => {{
      const name = document.getElementById('qd-name').value.trim();
      const errEl = document.getElementById('qd-err');
      errEl.innerHTML = '';
      if (!name) {{ errEl.innerHTML = `<div class="msg-err">${{esc(T.name_required)}}</div>`; return; }}
      const btn = document.getElementById('qd-submit');
      btn.disabled = true;
      const {{ ok, data }} = await api('POST', '/ticket', {{
        client_name: name,
        client_phone: document.getElementById('qd-phone').value.trim(),
        client_email: document.getElementById('qd-email').value.trim(),
        message: document.getElementById('qd-msg').value.trim(),
      }});
      if (!ok) {{
        btn.disabled = false;
        if (data.error === 'queue_full') errEl.innerHTML = `<div class="msg-err">${{esc(T.queue_full)}}</div>`;
        else errEl.innerHTML = `<div class="msg-err">${{esc(data.error || 'error')}}</div>`;
        return;
      }}
      _myTicketId = data.id;
      saveTicket(data.id, data.verify_code);
      document.getElementById('qd-form').innerHTML = '';
      renderMine(data);
    }};
  }}

  function renderMine(d) {{
    const mins = Math.round((d.estimated_seconds || 0) / 60);
    document.getElementById('qd-mine').innerHTML = `
      <div class="my-ticket">
        <div class="hint">${{esc(T.your_number)}}</div>
        <div class="num">${{d.number}}</div>
        <div class="queue-sub">${{d.position_ahead}} ${{esc(T.people_ahead)}}</div>
        <div class="queue-sub">${{esc(T.est_wait)}}: ~${{mins}} ${{esc(T.min)}}</div>
        <div class="queue-sub">${{esc(T.verify_code_label)}}: <b>${{esc(d.verify_code || '')}}</b></div>
        <div style="margin-top:10px"><button id="qd-cancel-mine">${{esc(T.cancel_ticket)}}</button></div>
      </div>
    `;
    document.getElementById('qd-cancel-mine').onclick = async () => {{
      if (!window.confirm(T.confirm_cancel_ticket)) return;
      const r = await api('POST', `/ticket/${{_myTicketId}}/cancel`, {{ verify_code: d.verify_code || '' }});
      if (!r.ok) {{
        document.getElementById('qd-mine').insertAdjacentHTML('beforeend', `<div class="msg-err">${{esc(T.cancel_failed)}}</div>`);
        return;
      }}
      clearSavedTicket();
      _myTicketId = null;
      showGetButton();
    }};
  }}

  async function refreshQueue() {{
    const {{ data }} = await api('GET', '/queue');
    if (data.current_number !== undefined) {{
      document.getElementById('qd-current').textContent = data.current_number || '—';
      document.getElementById('qd-waiting').textContent = data.waiting || 0;
      const getBtn = document.getElementById('qd-get');
      if (getBtn) {{
        const accepting = data.accepting !== false;
        getBtn.disabled = !accepting;
        getBtn.textContent = accepting ? T.get_number : T.not_accepting;
      }}
    }}
    if (_myTicketId) {{
      const r = await api('GET', `/ticket/${{_myTicketId}}`);
      if (!r.ok || !r.data.active) {{
        clearSavedTicket();
        _myTicketId = null;
        showGetButton();
      }} else {{
        renderMine(r.data);
      }}
    }}
  }}
}}
</script>
</body>
</html>"""
    return HTMLResponse(html)


@router.get("/{slug}/embed", response_class=HTMLResponse)
async def embed_page(slug: str):
    return await _public_page(slug, direct=False)


@router.get("/{slug}", response_class=HTMLResponse)
async def public_page(slug: str):
    return await _public_page(slug, direct=True)
