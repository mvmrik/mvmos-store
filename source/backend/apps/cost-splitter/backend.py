import os
import sqlite3
import json as _json
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/apps/cost-splitter")

_DB_PATH      = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "cost-splitter", "data.db")
_CORE_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data.db")

_DATE_DEFAULTS = {"date_format": "DD/MM/YYYY"}

def _get_date_format():
    try:
        conn = sqlite3.connect(_CORE_DB_PATH)
        row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
        conn.close()
        if row:
            s = _json.loads(row[0])
            return s.get("date_format", "DD/MM/YYYY")
    except Exception:
        pass
    return "DD/MM/YYYY"

def _fmt_date(iso_str, date_format):
    d = iso_str[:10]  # YYYY-MM-DD
    y, m, day = d[:4], d[5:7], d[8:10]
    if date_format == "MM/DD/YYYY":
        return f"{m}/{day}/{y}"
    elif date_format == "YYYY-MM-DD":
        return d
    return f"{day}/{m}/{y}"  # DD/MM/YYYY default

_i18n = {
    "en": {"total_amount": "Total amount", "prev_balance": "Previous balance", "amount_due": "Amount due",
           "balance": "Current balance", "date": "Date", "note": "Note", "amount": "Amount"},
    "bg": {"total_amount": "Обща сума", "prev_balance": "Предишен баланс", "amount_due": "Дължима сума",
           "balance": "Текущ баланс", "date": "Дата", "note": "Бележка", "amount": "Сума"},
}


def _get_config():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT key, value FROM cfg").fetchall()
    conn.close()
    result = {}
    for r in rows:
        v = r["value"]
        try:
            v = _json.loads(v)
        except Exception:
            pass
        result[r["key"]] = v
    return result


class TestEmailRequest(BaseModel):
    member_id: int


@router.post("/test-email")
async def test_email(body: TestEmailRequest):
    import httpx

    config = _get_config()
    api_key   = str(config.get("mail_api_key", "") or "").strip()
    mail_from = str(config.get("mail_from", "") or "").strip()
    if not api_key or not mail_from:
        raise HTTPException(status_code=400, detail="Mail not configured")

    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    member = conn.execute("SELECT * FROM members WHERE id=?", (body.member_id,)).fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Member not found")
    if not member["email"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Member has no email")

    members      = conn.execute("SELECT * FROM members").fetchall()
    total_cost   = float(config.get("total_cost") or 0)
    prefix       = str(config.get("currency_prefix", "") or "")
    suffix       = str(config.get("currency_suffix", "€") or "€")
    subject      = str(config.get("mail_subject", "Monthly cost summary") or "Monthly cost summary")
    body_tpl     = str(config.get("mail_body", "Hi {name}, your share of {share} has been charged.") or "")
    provider     = str(config.get("mail_provider", "mailjet") or "mailjet")
    api_secret   = str(config.get("mail_api_secret", "") or "").strip()
    lang         = str(config.get("mail_language", "en") or "en")
    t            = _i18n.get(lang, _i18n["en"])
    date_format  = _get_date_format()
    show_total   = config.get("show_total",   True)
    show_prev    = config.get("show_prev",    True)
    show_share   = config.get("show_share",   True)
    show_balance = config.get("show_balance", True)
    show_history = config.get("show_history", True)

    custom_total = sum(float(m["custom_share"]) for m in members if m["custom_share"] is not None)
    auto_members = [m for m in members if m["custom_share"] is None]
    remaining    = max(0.0, total_cost - custom_total)
    auto_share   = remaining / len(auto_members) if auto_members else 0.0
    per_member   = float(member["custom_share"]) if member["custom_share"] is not None else auto_share

    balance = conn.execute(
        "SELECT COALESCE(SUM(amount),0) as bal FROM transactions WHERE member_id=?",
        (member["id"],)
    ).fetchone()["bal"]
    txs = conn.execute(
        "SELECT * FROM transactions WHERE member_id=? ORDER BY created_at DESC LIMIT 20",
        (member["id"],)
    ).fetchall()
    conn.close()

    old_balance = float(balance)
    balance     = old_balance - per_member

    def fmt(a):
        return f"{prefix}{abs(float(a)):.2f}{suffix}"
    def fmt_signed(a):
        a = float(a)
        return ("-" if a < 0 else "") + fmt(a)

    body_text = body_tpl \
        .replace("{name}",        member["name"]) \
        .replace("{share}",       fmt(per_member)) \
        .replace("{charged}",     fmt(per_member)) \
        .replace("{old_balance}", fmt_signed(old_balance)) \
        .replace("{new_balance}", fmt_signed(balance))

    bal_color  = "#a6e3a1" if float(balance) >= 0 else "#f38ba8"
    prev_color = "#a6e3a1" if float(old_balance) >= 0 else "#f38ba8"

    summary_rows = ""
    if show_total:
        summary_rows += f"<tr><td style='padding:8px;background:#313244;border-radius:4px'>{t['total_amount']}</td><td style='padding:8px;background:#313244;text-align:right'>{fmt(total_cost)}</td></tr>"
    if show_prev:
        summary_rows += f"<tr><td style='padding:8px'>{t['prev_balance']}</td><td style='padding:8px;text-align:right;color:{prev_color}'>{fmt_signed(old_balance)}</td></tr>"
    if show_share:
        summary_rows += f"<tr><td style='padding:8px;background:#313244'>{t['amount_due']}</td><td style='padding:8px;background:#313244;text-align:right'>{fmt(per_member)}</td></tr>"
    if show_balance:
        summary_rows += f"<tr><td style='padding:8px;font-weight:bold'>{t['balance']}</td><td style='padding:8px;text-align:right;color:{bal_color};font-weight:bold'>{fmt_signed(balance)}</td></tr>"

    tx_rows = "".join(
        f"<tr><td style='padding:4px 8px;color:#aaa;font-size:12px'>{_fmt_date(tx['created_at'], date_format)}</td>"
        f"<td style='padding:4px 8px'>{tx['note'] or ''}</td>"
        f"<td style='padding:4px 8px;text-align:right;color:{'#a6e3a1' if float(tx['amount'])>=0 else '#f38ba8'}'>{fmt_signed(tx['amount'])}</td></tr>"
        for tx in txs
    )
    tx_table = f"""<table style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th style="text-align:left;padding:4px 8px;font-size:12px;color:#aaa">{t['date']}</th>
      <th style="text-align:left;padding:4px 8px;font-size:12px;color:#aaa">{t['note']}</th>
      <th style="text-align:right;padding:4px 8px;font-size:12px;color:#aaa">{t['amount']}</th>
    </tr></thead><tbody>{tx_rows}</tbody></table>""" if tx_rows and show_history else ""

    html = f"""<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#1e1e2e;color:#cdd6f4;padding:24px;border-radius:8px">
  <h2 style="margin:0 0 20px;color:#cdd6f4">{subject}</h2>
  <p style="margin:0 0 20px;color:#cdd6f4">{body_text}</p>
  {f'<table style="width:100%;border-collapse:collapse;margin-bottom:16px">{summary_rows}</table>' if summary_rows else ''}
  {tx_table}</div>"""

    try:
        if provider == "brevo":
            res = httpx.post("https://api.brevo.com/v3/smtp/email",
                headers={"api-key": api_key, "Content-Type": "application/json"},
                json={"sender": {"email": mail_from},
                      "to": [{"email": member["email"], "name": member["name"]}],
                      "subject": f"[TEST] {subject}", "htmlContent": html}, timeout=10)
        else:
            res = httpx.post("https://api.mailjet.com/v3.1/send",
                auth=(api_key, api_secret),
                json={"Messages": [{"From": {"Email": mail_from},
                                    "To": [{"Email": member["email"], "Name": member["name"]}],
                                    "Subject": f"[TEST] {subject}", "HTMLPart": html}]}, timeout=10)
        if res.status_code in (200, 201):
            return JSONResponse({"ok": True})
        raise HTTPException(status_code=502, detail=f"Mail error: {res.text[:300]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
