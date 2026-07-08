import sqlite3
import json
import httpx
import os
from datetime import datetime

_i18n = {
    'en': {
        'total_amount': 'Total amount',
        'prev_balance': 'Previous balance',
        'amount_due':   'Amount due',
        'balance':      'Current balance',
        'date':         'Date',
        'note':         'Note',
        'amount':       'Amount',
        'charge_note':  'Monthly charge',
    },
    'bg': {
        'total_amount': 'Обща сума',
        'prev_balance': 'Предишен баланс',
        'amount_due':   'Дължима сума',
        'balance':      'Текущ баланс',
        'date':         'Дата',
        'note':         'Бележка',
        'amount':       'Сума',
        'charge_note':  'Месечно начисление',
    },
}


# Fixed list — symbol-only display, never real FX conversion. Kept in sync
# manually with frontend/settings.js's own copy (no shared module across surfaces).
_CURRENCY_SYMBOLS = {
    "EUR": "€", "USD": "$", "GBP": "£", "CHF": "CHF", "JPY": "¥", "CNY": "¥",
    "TRY": "₺", "UAH": "₴", "PLN": "zł", "RON": "lei", "CZK": "Kč", "HUF": "Ft",
    "CAD": "$", "AUD": "$", "SEK": "kr", "NOK": "kr", "DKK": "kr", "RUB": "₽", "INR": "₹",
}

def _get_core_settings(db_path):
    try:
        core_db = os.path.join(os.path.dirname(db_path), "..", "..", "..", "data.db")
        conn = sqlite3.connect(core_db)
        row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
        conn.close()
        if row:
            return json.loads(row[0])
    except Exception:
        pass
    return {}

def _get_date_format(db_path):
    return _get_core_settings(db_path).get("date_format", "DD/MM/YYYY")

def _currency_symbol(db_path, config):
    code = config.get("currency") or _get_core_settings(db_path).get("currency", "EUR")
    return _CURRENCY_SYMBOLS.get(code, code)

def _fmt_date(iso_str, date_format):
    d = iso_str[:10]
    y, m, day = d[:4], d[5:7], d[8:10]
    if date_format == "MM/DD/YYYY":
        return f"{m}/{day}/{y}"
    elif date_format == "YYYY-MM-DD":
        return d
    return f"{day}/{m}/{y}"

def run(now: datetime, db_path: str, config: dict):
    day    = int(config.get('sched_day')    or 1)
    hour   = int(config.get('sched_hour')   or 9)
    minute = int(config.get('sched_minute') or 0)

    if now.day != day or now.hour != hour or now.minute != minute:
        return

    api_key   = config.get('mail_api_key', '').strip()
    mail_from = config.get('mail_from', '').strip()
    if not api_key or not mail_from:
        return

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        members = conn.execute('SELECT * FROM members').fetchall()
        if not members:
            conn.close()
            return

        # ensure mail_log table exists
        conn.execute('''CREATE TABLE IF NOT EXISTS mail_log
            (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER,
             sent_at TEXT, status TEXT, error TEXT DEFAULT '')''')

        total_cost   = float(config.get('total_cost') or 0)
        symbol       = _currency_symbol(db_path, config)
        subject      = config.get('mail_subject', 'Monthly cost summary')
        body_tpl     = config.get('mail_body', 'Hi {name}, your share of {share} has been charged. Previous balance: {old_balance}, current balance: {new_balance}.')
        provider     = config.get('mail_provider', 'mailjet')
        api_secret   = config.get('mail_api_secret', '').strip()
        lang         = config.get('mail_language', 'en')
        t            = _i18n.get(lang, _i18n['en'])
        date_format  = _get_date_format(db_path)
        show_total   = config.get('show_total',   True)
        show_prev    = config.get('show_prev',    True)
        show_share   = config.get('show_share',   True)
        show_balance = config.get('show_balance', True)
        show_history = config.get('show_history', True)

        # calculate shares — custom members excluded from auto split
        custom_total = sum(float(m['custom_share']) for m in members if m['custom_share'] is not None)
        auto_members = [m for m in members if m['custom_share'] is None]
        remaining    = max(0.0, total_cost - custom_total)
        auto_share   = remaining / len(auto_members) if auto_members else 0.0

        def share_for(m):
            return float(m['custom_share']) if m['custom_share'] is not None else auto_share

        def fmt(amount):
            return f"{abs(amount):.2f} {symbol}"

        def fmt_signed(amount):
            return ('-' if amount < 0 else '') + fmt(amount)

        for member in members:
            per_member = share_for(member)

            balance = conn.execute(
                'SELECT COALESCE(SUM(amount),0) as bal FROM transactions WHERE member_id=?',
                (member['id'],)
            ).fetchone()['bal']

            old_balance  = float(balance)
            new_balance  = old_balance - per_member

            body_text = body_tpl \
                .replace('{name}',        member['name']) \
                .replace('{share}',       fmt(per_member)) \
                .replace('{charged}',     fmt(per_member)) \
                .replace('{old_balance}', fmt_signed(old_balance)) \
                .replace('{new_balance}', fmt_signed(new_balance))

            txs = conn.execute(
                'SELECT * FROM transactions WHERE member_id=? ORDER BY created_at DESC LIMIT 20',
                (member['id'],)
            ).fetchall()

            tx_rows = ''.join(
                f"<tr>"
                f"<td style='padding:4px 8px;color:#aaa;font-size:12px'>{_fmt_date(tx['created_at'], date_format)}</td>"
                f"<td style='padding:4px 8px'>{tx['note'] or ''}</td>"
                f"<td style='padding:4px 8px;text-align:right;color:{'#a6e3a1' if tx['amount']>=0 else '#f38ba8'}'>"
                f"{fmt_signed(tx['amount'])}</td>"
                f"</tr>"
                for tx in txs
            )

            bal_color  = '#a6e3a1' if new_balance >= 0 else '#f38ba8'
            prev_color = '#a6e3a1' if old_balance >= 0 else '#f38ba8'

            summary_rows = ''
            if show_total:
                summary_rows += f"<tr><td style='padding:8px;background:#313244;border-radius:4px'>{t['total_amount']}</td><td style='padding:8px;background:#313244;text-align:right'>{fmt(total_cost)}</td></tr>"
            if show_prev:
                summary_rows += f"<tr><td style='padding:8px'>{t['prev_balance']}</td><td style='padding:8px;text-align:right;color:{prev_color}'>{fmt_signed(old_balance)}</td></tr>"
            if show_share:
                summary_rows += f"<tr><td style='padding:8px;background:#313244'>{t['amount_due']}</td><td style='padding:8px;background:#313244;text-align:right'>{fmt(per_member)}</td></tr>"
            if show_balance:
                summary_rows += f"<tr><td style='padding:8px;font-weight:bold'>{t['balance']}</td><td style='padding:8px;text-align:right;color:{bal_color};font-weight:bold'>{fmt_signed(new_balance)}</td></tr>"

            html = f"""
<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#1e1e2e;color:#cdd6f4;padding:24px;border-radius:8px">
  <h2 style="margin:0 0 20px;color:#cdd6f4">{subject}</h2>
  <p style="margin:0 0 20px;color:#cdd6f4">{body_text}</p>
  {f'<table style="width:100%;border-collapse:collapse;margin-bottom:16px">{summary_rows}</table>' if summary_rows else ''}
  {f'''<table style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th style="text-align:left;padding:4px 8px;font-size:12px;color:#aaa">{t['date']}</th>
      <th style="text-align:left;padding:4px 8px;font-size:12px;color:#aaa">{t['note']}</th>
      <th style="text-align:right;padding:4px 8px;font-size:12px;color:#aaa">{t['amount']}</th>
    </tr></thead>
    <tbody>{tx_rows}</tbody>
  </table>''' if tx_rows and show_history else ''}
</div>"""

            # send email and log result
            status = 'failed'
            error  = ''
            if member['email']:
                try:
                    if provider == 'brevo':
                        res = httpx.post(
                            'https://api.brevo.com/v3/smtp/email',
                            headers={'api-key': api_key, 'Content-Type': 'application/json'},
                            json={
                                'sender': {'email': mail_from},
                                'to': [{'email': member['email'], 'name': member['name']}],
                                'subject': subject,
                                'htmlContent': html,
                            },
                            timeout=10,
                        )
                    else:
                        res = httpx.post(
                            'https://api.mailjet.com/v3.1/send',
                            auth=(api_key, api_secret),
                            json={'Messages': [{
                                'From': {'Email': mail_from},
                                'To': [{'Email': member['email'], 'Name': member['name']}],
                                'Subject': subject,
                                'HTMLPart': html,
                            }]},
                            timeout=10,
                        )
                    if res.status_code in (200, 201):
                        status = 'success'
                    else:
                        error = f"HTTP {res.status_code}: {res.text[:200]}"
                except Exception as e:
                    error = str(e)[:200]

                conn.execute(
                    'INSERT INTO mail_log (member_id, sent_at, status, error) VALUES (?,?,?,?)',
                    (member['id'], now.isoformat(), status, error)
                )

            # charge monthly share
            charge_note = config.get('charge_note', '').strip() or None
            conn.execute(
                'INSERT INTO transactions (member_id, amount, note, created_at) VALUES (?,?,?,?)',
                (member['id'], -per_member, charge_note, now.isoformat())
            )

        conn.commit()
        conn.close()
    except Exception:
        pass
