"""
mvmOS mvmWarehouse — catalogue, stock, price lists, orders, invoices and
payments for a company run by one or more Apps Hub profiles.

Mounted at /pub/mvmwarehouse by public_loader.py. The desktop window and the
public page are the same widget and both identify with the Apps Hub token
(X-Pub-Token), so there is no separate desktop router.

A company is the unit everything belongs to. Its creator is the owner; the
owner (or anyone with the settings permission) adds other profiles from their
Apps Hub favourites and decides, area by area, what each one may see or
change. The areas and their levels (0 none, 1 view, 2 edit) are in AREAS, the
ready-made roles in PRESETS; "costs" is separate because purchase prices and
stock value are the one thing a salesperson usually must not see even while
working with the same products.

Every data route is written once as a service function and registered twice
by _mount(): at /c/<company id>/... for people (token + membership) and at
/api/v1/... for other systems (an API key created in Settings, which carries
its own permissions and always belongs to exactly one company). app_api.py
builds the same context for other mvmOS apps, so the three doors lead into
the same rules — none of them can do what the others would refuse.

Stock is a ledger: every change is a row in movements and the stock table is
its running total, updated in the same transaction. Documents (receipt,
write-off, transfer, inventory count, customer return) are drafts until
posted; shipping a confirmed order issues its goods. Confirmed orders reserve
what they hold, so "available" is on hand minus reserved. The average cost of
a product moves only with receipts, weighted by what is on hand.

Prices on products, price lists, orders and invoices are without VAT; each
line carries its own VAT rate and documents total per line, then per document.
"""

import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter()

APP_ID = "mvmwarehouse"

_DIR        = os.path.dirname(__file__)                     # apps/mvmwarehouse
_DB_PATH    = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
# Product photos are the shop's own pictures, meant to be seen by anyone, so
# they sit in public/ and are served as plain static files; one folder per
# company so deleting a company takes its photos along.
_UPLOADS_DIR = os.path.join(_PUBLIC_DIR, "product-uploads")
_UPLOADS_URL = "/apps/mvmwarehouse/product-uploads"
MAX_IMAGES = 10
MAX_IMAGE_BYTES = 8 * 1024 * 1024
_IMAGE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp|gif)$")

AREAS = ("catalog", "pricelists", "partners", "stock", "orders",
         "invoices", "payments", "reports", "settings")

FULL = {**{a: 2 for a in AREAS}, "costs": 1}

PRESETS = {
    "admin":       FULL,
    "manager":     {**{a: 2 for a in AREAS}, "settings": 0, "costs": 1},
    "sales":       {"catalog": 1, "pricelists": 1, "partners": 2, "stock": 1, "orders": 2,
                    "invoices": 2, "payments": 2, "reports": 0, "settings": 0, "costs": 0},
    "storekeeper": {"catalog": 2, "pricelists": 0, "partners": 1, "stock": 2, "orders": 1,
                    "invoices": 0, "payments": 0, "reports": 0, "settings": 0, "costs": 1},
    "accountant":  {"catalog": 1, "pricelists": 1, "partners": 2, "stock": 1, "orders": 1,
                    "invoices": 2, "payments": 2, "reports": 1, "settings": 0, "costs": 1},
    "viewer":      {**{a: 1 for a in AREAS}, "settings": 0, "costs": 0},
}
ROLES = set(PRESETS) | {"custom"}

# Same list Apps Hub accepts for a profile's own currency.
CURRENCIES = {"EUR", "USD", "GBP", "CHF", "JPY", "CNY", "TRY", "UAH", "PLN", "RON",
              "CZK", "HUF", "CAD", "AUD", "SEK", "NOK", "DKK", "RUB", "INR", "BGN"}

DOC_KINDS     = ("receipt", "writeoff", "transfer", "inventory", "return")
ORDER_STATES  = ("draft", "confirmed", "shipped", "cancelled")
PAY_METHODS   = ("cash", "bank", "card", "cod", "other")
PARTNER_KINDS = ("customer", "supplier", "both")

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_EPS = 1e-9


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS companies (
                id             TEXT PRIMARY KEY,
                owner_id       TEXT NOT NULL,
                name           TEXT NOT NULL,
                legal_name     TEXT NOT NULL DEFAULT '',
                vat_number     TEXT NOT NULL DEFAULT '',
                reg_number     TEXT NOT NULL DEFAULT '',
                manager_name   TEXT NOT NULL DEFAULT '',
                address        TEXT NOT NULL DEFAULT '',
                city           TEXT NOT NULL DEFAULT '',
                country        TEXT NOT NULL DEFAULT '',
                email          TEXT NOT NULL DEFAULT '',
                phone          TEXT NOT NULL DEFAULT '',
                bank_name      TEXT NOT NULL DEFAULT '',
                iban           TEXT NOT NULL DEFAULT '',
                bic            TEXT NOT NULL DEFAULT '',
                currency       TEXT NOT NULL DEFAULT 'EUR',
                vat_registered INTEGER NOT NULL DEFAULT 1,
                default_vat    REAL NOT NULL DEFAULT 20,
                payment_terms  INTEGER NOT NULL DEFAULT 14,
                allow_negative INTEGER NOT NULL DEFAULT 0,
                invoice_prefix TEXT NOT NULL DEFAULT '',
                invoice_digits INTEGER NOT NULL DEFAULT 10,
                order_prefix   TEXT NOT NULL DEFAULT 'SO-',
                invoice_note   TEXT NOT NULL DEFAULT '',
                created_at     TEXT NOT NULL,
                updated_at     TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS members (
                company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                user_id    TEXT NOT NULL,
                role       TEXT NOT NULL,
                perms      TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                PRIMARY KEY (company_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

            CREATE TABLE IF NOT EXISTS counters (
                company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                kind       TEXT NOT NULL,
                next       INTEGER NOT NULL,
                PRIMARY KEY (company_id, kind)
            );

            CREATE TABLE IF NOT EXISTS warehouses (
                id         TEXT PRIMARY KEY,
                company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                address    TEXT NOT NULL DEFAULT '',
                is_default INTEGER NOT NULL DEFAULT 0,
                archived   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id);

            CREATE TABLE IF NOT EXISTS categories (
                id         TEXT PRIMARY KEY,
                company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                parent_id  TEXT,
                name       TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_categories_company ON categories(company_id);

            CREATE TABLE IF NOT EXISTS products (
                id          TEXT PRIMARY KEY,
                company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                sku         TEXT NOT NULL DEFAULT '',
                barcode     TEXT NOT NULL DEFAULT '',
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                category_id TEXT,
                unit        TEXT NOT NULL DEFAULT '',
                is_service  INTEGER NOT NULL DEFAULT 0,
                vat_rate    REAL NOT NULL DEFAULT 20,
                price       REAL NOT NULL DEFAULT 0,
                cost_price  REAL NOT NULL DEFAULT 0,
                min_stock   REAL NOT NULL DEFAULT 0,
                active      INTEGER NOT NULL DEFAULT 1,
                online      INTEGER NOT NULL DEFAULT 0,
                web_description TEXT NOT NULL DEFAULT '',
                images      TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id, name);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(company_id, sku) WHERE sku != '';

            CREATE TABLE IF NOT EXISTS stock (
                company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                product_id   TEXT NOT NULL,
                warehouse_id TEXT NOT NULL,
                qty          REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (product_id, warehouse_id)
            );
            CREATE INDEX IF NOT EXISTS idx_stock_company ON stock(company_id);

            CREATE TABLE IF NOT EXISTS movements (
                id           TEXT PRIMARY KEY,
                company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                product_id   TEXT NOT NULL,
                warehouse_id TEXT NOT NULL,
                qty          REAL NOT NULL,
                unit_cost    REAL NOT NULL DEFAULT 0,
                kind         TEXT NOT NULL,
                ref_type     TEXT NOT NULL DEFAULT '',
                ref_id       TEXT NOT NULL DEFAULT '',
                ref_number   TEXT NOT NULL DEFAULT '',
                actor        TEXT NOT NULL DEFAULT '',
                created_at   TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_movements_company ON movements(company_id, created_at);

            CREATE TABLE IF NOT EXISTS stock_docs (
                id              TEXT PRIMARY KEY,
                company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                kind            TEXT NOT NULL,
                number          TEXT NOT NULL,
                status          TEXT NOT NULL DEFAULT 'draft',
                warehouse_id    TEXT NOT NULL,
                to_warehouse_id TEXT,
                partner_id      TEXT,
                doc_date        TEXT NOT NULL,
                reference       TEXT NOT NULL DEFAULT '',
                note            TEXT NOT NULL DEFAULT '',
                created_by      TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                posted_at       TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_stock_docs_company ON stock_docs(company_id, doc_date);

            CREATE TABLE IF NOT EXISTS stock_doc_lines (
                id         TEXT PRIMARY KEY,
                doc_id     TEXT NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
                position   INTEGER NOT NULL,
                product_id TEXT NOT NULL,
                qty        REAL NOT NULL,
                unit_cost  REAL NOT NULL DEFAULT 0,
                delta      REAL
            );
            CREATE INDEX IF NOT EXISTS idx_stock_doc_lines_doc ON stock_doc_lines(doc_id, position);

            CREATE TABLE IF NOT EXISTS price_lists (
                id         TEXT PRIMARY KEY,
                company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                discount   REAL NOT NULL DEFAULT 0,
                active     INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_price_lists_company ON price_lists(company_id);

            CREATE TABLE IF NOT EXISTS price_list_items (
                price_list_id TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
                product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                price         REAL NOT NULL,
                PRIMARY KEY (price_list_id, product_id)
            );

            CREATE TABLE IF NOT EXISTS partners (
                id            TEXT PRIMARY KEY,
                company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                kind          TEXT NOT NULL DEFAULT 'customer',
                name          TEXT NOT NULL,
                vat_number    TEXT NOT NULL DEFAULT '',
                reg_number    TEXT NOT NULL DEFAULT '',
                manager_name  TEXT NOT NULL DEFAULT '',
                email         TEXT NOT NULL DEFAULT '',
                phone         TEXT NOT NULL DEFAULT '',
                address       TEXT NOT NULL DEFAULT '',
                city          TEXT NOT NULL DEFAULT '',
                country       TEXT NOT NULL DEFAULT '',
                price_list_id TEXT,
                payment_terms INTEGER,
                notes         TEXT NOT NULL DEFAULT '',
                active        INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_partners_company ON partners(company_id, name);

            CREATE TABLE IF NOT EXISTS orders (
                id              TEXT PRIMARY KEY,
                company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                number          TEXT NOT NULL,
                status          TEXT NOT NULL DEFAULT 'draft',
                partner_id      TEXT,
                warehouse_id    TEXT NOT NULL,
                price_list_id   TEXT,
                order_date      TEXT NOT NULL,
                ship_to         TEXT NOT NULL DEFAULT '',
                currency        TEXT NOT NULL,
                subtotal        REAL NOT NULL DEFAULT 0,
                vat_total       REAL NOT NULL DEFAULT 0,
                total           REAL NOT NULL DEFAULT 0,
                note            TEXT NOT NULL DEFAULT '',
                source          TEXT NOT NULL DEFAULT 'manual',
                external_ref    TEXT NOT NULL DEFAULT '',
                idempotency_key TEXT,
                invoice_id      TEXT,
                created_by      TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                confirmed_at    TEXT,
                shipped_at      TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id, order_date);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem ON orders(company_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL;

            CREATE TABLE IF NOT EXISTS order_lines (
                id         TEXT PRIMARY KEY,
                order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                position   INTEGER NOT NULL,
                product_id TEXT,
                name       TEXT NOT NULL,
                sku        TEXT NOT NULL DEFAULT '',
                unit       TEXT NOT NULL DEFAULT '',
                qty        REAL NOT NULL,
                unit_price REAL NOT NULL,
                discount   REAL NOT NULL DEFAULT 0,
                vat_rate   REAL NOT NULL DEFAULT 0,
                net        REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id, position);

            CREATE TABLE IF NOT EXISTS invoices (
                id             TEXT PRIMARY KEY,
                company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                kind           TEXT NOT NULL DEFAULT 'invoice',
                number         TEXT NOT NULL,
                status         TEXT NOT NULL DEFAULT 'issued',
                order_id       TEXT,
                related_id     TEXT,
                partner_id     TEXT,
                supplier_json  TEXT NOT NULL DEFAULT '{}',
                recipient_json TEXT NOT NULL DEFAULT '{}',
                issue_date     TEXT NOT NULL,
                tax_date       TEXT NOT NULL,
                due_date       TEXT NOT NULL,
                currency       TEXT NOT NULL,
                subtotal       REAL NOT NULL DEFAULT 0,
                vat_total      REAL NOT NULL DEFAULT 0,
                total          REAL NOT NULL DEFAULT 0,
                payment_method TEXT NOT NULL DEFAULT 'bank',
                note           TEXT NOT NULL DEFAULT '',
                created_by     TEXT NOT NULL DEFAULT '',
                created_at     TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id, issue_date);

            CREATE TABLE IF NOT EXISTS invoice_lines (
                id         TEXT PRIMARY KEY,
                invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                position   INTEGER NOT NULL,
                product_id TEXT,
                name       TEXT NOT NULL,
                sku        TEXT NOT NULL DEFAULT '',
                unit       TEXT NOT NULL DEFAULT '',
                qty        REAL NOT NULL,
                unit_price REAL NOT NULL,
                discount   REAL NOT NULL DEFAULT 0,
                vat_rate   REAL NOT NULL DEFAULT 0,
                net        REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id, position);

            CREATE TABLE IF NOT EXISTS payments (
                id              TEXT PRIMARY KEY,
                company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                partner_id      TEXT,
                invoice_id      TEXT,
                order_id        TEXT,
                amount          REAL NOT NULL,
                method          TEXT NOT NULL DEFAULT 'bank',
                pay_date        TEXT NOT NULL,
                reference       TEXT NOT NULL DEFAULT '',
                note            TEXT NOT NULL DEFAULT '',
                idempotency_key TEXT,
                created_by      TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id, pay_date);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idem ON payments(company_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL;

            CREATE TABLE IF NOT EXISTS api_keys (
                id           TEXT PRIMARY KEY,
                company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                name         TEXT NOT NULL,
                key_hash     TEXT NOT NULL UNIQUE,
                prefix       TEXT NOT NULL,
                perms        TEXT NOT NULL DEFAULT '{}',
                created_by   TEXT NOT NULL DEFAULT '',
                created_at   TEXT NOT NULL,
                last_used_at TEXT
            );
        """)
        # Columns added after the first build of this file.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
        for col, ddl in (("online", "INTEGER NOT NULL DEFAULT 0"),
                         ("web_description", "TEXT NOT NULL DEFAULT ''"),
                         ("images", "TEXT NOT NULL DEFAULT '[]'")):
            if col not in cols:
                conn.execute(f"ALTER TABLE products ADD COLUMN {col} {ddl}")
        conn.commit()


_init_db()


# ── Small helpers ────────────────────────────────────────────────

class Err(Exception):
    """A refusal with an HTTP status and an error code the widget translates
    (wh_err_<code>); extra fields travel with it, e.g. which product ran out."""

    def __init__(self, status: int, code: str, **extra):
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _today() -> str:
    return date.today().isoformat()


def _id() -> str:
    return uuid.uuid4().hex


def _r(x, places: str = "0.01") -> float:
    """Commercial rounding (half up) — round() would take 2.675 to 2.67."""
    return float(Decimal(str(x or 0)).quantize(Decimal(places), rounding=ROUND_HALF_UP))


def _rq(x) -> float:
    return _r(x, "0.0001")


def _s(body: dict, key: str, maxlen: int = 200, default: str = "") -> str:
    v = body.get(key, default)
    if v is None:
        return ""
    return str(v).strip()[:maxlen]


def _num(v, field: str, default=None, minimum=None, maximum=None):
    if v is None or v == "":
        if default is None:
            raise Err(400, "invalid_number", field=field)
        return default
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise Err(400, "invalid_number", field=field)
    if n != n or n in (float("inf"), float("-inf")):
        raise Err(400, "invalid_number", field=field)
    if minimum is not None and n < minimum:
        raise Err(400, "invalid_number", field=field)
    if maximum is not None and n > maximum:
        raise Err(400, "invalid_number", field=field)
    return n


def _date(v, field: str, default: Optional[str] = None) -> str:
    if not v:
        if default is None:
            raise Err(400, "invalid_date", field=field)
        return default
    v = str(v)[:10]
    if not _DATE_RE.match(v):
        raise Err(400, "invalid_date", field=field)
    try:
        date.fromisoformat(v)
    except ValueError:
        raise Err(400, "invalid_date", field=field)
    return v


def _bool(v) -> int:
    return 1 if v in (True, 1, "1", "true", "on") else 0


def _limit(q: dict, default: int = 200, maximum: int = 1000):
    try:
        limit = max(1, min(maximum, int(q.get("limit") or default)))
    except ValueError:
        limit = default
    try:
        offset = max(0, int(q.get("offset") or 0))
    except ValueError:
        offset = 0
    return limit, offset


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _norm_perms(p) -> dict:
    if isinstance(p, str):
        try:
            p = json.loads(p)
        except ValueError:
            p = {}
    if not isinstance(p, dict):
        p = {}
    out = {}
    for a in AREAS:
        try:
            out[a] = max(0, min(2, int(p.get(a, 0))))
        except (TypeError, ValueError):
            out[a] = 0
    out["costs"] = 1 if p.get("costs") in (1, True, "1") else 0
    return out


class Ctx:
    """Who is acting on which company and with what rights. `actor` is an
    Apps Hub id for a person, "api:<key id>" for an API key, "app:<id>" for
    another mvmOS app acting for a person."""

    def __init__(self, company: dict, perms: dict, actor: str, role: str, via: str):
        self.company = company
        self.cid = company["id"]
        self.perms = perms
        self.actor = actor
        self.role = role
        self.via = via

    def can(self, area: str, level: int = 1) -> bool:
        return self.perms.get(area, 0) >= level

    def need(self, area: str, level: int = 1):
        if not self.can(area, level):
            raise Err(403, "forbidden", area=area)


def _user(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _member_ctx(user_id: str, cid: str) -> Ctx:
    with _db() as conn:
        row = conn.execute(
            "SELECT c.*, m.role AS m_role, m.perms AS m_perms FROM companies c "
            "JOIN members m ON m.company_id=c.id AND m.user_id=? WHERE c.id=?",
            (user_id, cid),
        ).fetchone()
    if not row:
        raise Err(404, "not_found")
    company = dict(row)
    role = company.pop("m_role")
    perms = company.pop("m_perms")
    perms = dict(FULL) if role == "owner" else _norm_perms(perms)
    return Ctx(company, perms, user_id, role, "user")


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _key_ctx(request: Request) -> Ctx:
    auth = request.headers.get("authorization") or ""
    key = auth[7:].strip() if auth.lower().startswith("bearer ") else (request.headers.get("x-api-key") or "").strip()
    if not key or len(key) > 200:
        raise Err(401, "unauthorized")
    with _db() as conn:
        row = conn.execute("SELECT * FROM api_keys WHERE key_hash=?", (_hash_key(key),)).fetchone()
        if not row:
            raise Err(401, "unauthorized")
        company = conn.execute("SELECT * FROM companies WHERE id=?", (row["company_id"],)).fetchone()
        if not company:
            raise Err(401, "unauthorized")
        # A write per request would serialise every read behind the database
        # lock; once a minute is plenty to tell a live key from a forgotten one.
        now = _now()
        if not row["last_used_at"] or row["last_used_at"][:16] != now[:16]:
            conn.execute("UPDATE api_keys SET last_used_at=? WHERE id=?", (now, row["id"]))
            conn.commit()
    perms = _norm_perms(row["perms"])
    perms["settings"] = 0          # a key never manages the company it belongs to
    return Ctx(dict(company), perms, "api:" + row["id"], "api", "api")


def _company_public(c: dict) -> dict:
    keys = ("id", "name", "legal_name", "vat_number", "reg_number", "manager_name", "address",
            "city", "country", "email", "phone", "bank_name", "iban", "bic", "currency",
            "vat_registered", "default_vat", "payment_terms", "allow_negative",
            "invoice_prefix", "invoice_digits", "order_prefix", "invoice_note")
    return {k: c.get(k) for k in keys}


def _next_number(conn, cid: str, kind: str) -> int:
    """Take the next number of a sequence. Runs inside the caller's write
    transaction, so two documents can never get the same number."""
    row = conn.execute("SELECT next FROM counters WHERE company_id=? AND kind=?", (cid, kind)).fetchone()
    n = row["next"] if row else 1
    conn.execute(
        "INSERT INTO counters(company_id,kind,next) VALUES(?,?,?) "
        "ON CONFLICT(company_id,kind) DO UPDATE SET next=excluded.next",
        (cid, kind, n + 1),
    )
    return n


def _format_invoice_number(company: dict, n: int) -> str:
    digits = max(1, min(12, int(company.get("invoice_digits") or 10)))
    return (company.get("invoice_prefix") or "") + str(n).zfill(digits)


_DOC_PREFIX = {"receipt": "REC-", "writeoff": "WO-", "transfer": "TR-", "inventory": "INV-", "return": "RET-"}


# ── Endpoint registry ────────────────────────────────────────────
#
# Service functions take (ctx, q, body, **path params) and return a dict. The
# decorator only records them; _mount() at the bottom of this file adds each
# one under /c/{cid} for people and, unless api=False, under /api/v1 for keys.

_ENDPOINTS = []


def endpoint(method: str, path: str, api: bool = True):
    def deco(fn):
        _ENDPOINTS.append((method, path, fn, api))
        return fn
    return deco


def _error(e: Err) -> JSONResponse:
    return JSONResponse({"error": e.code, **e.extra}, status_code=e.status)


async def _body(request: Request) -> dict:
    if request.method in ("GET", "DELETE", "HEAD"):
        return {}
    if (request.headers.get("content-type") or "").startswith("multipart/form-data"):
        if int(request.headers.get("content-length") or 0) > MAX_IMAGE_BYTES + 64 * 1024:
            raise Err(413, "too_large")
        form = await request.form()
        f = form.get("file")
        return {"_file": await f.read() if hasattr(f, "read") else None}
    raw = await request.body()
    if not raw:
        return {}
    if len(raw) > 2 * 1024 * 1024:
        raise Err(413, "too_large")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise Err(400, "bad_json")
    if not isinstance(data, dict):
        raise Err(400, "bad_json")
    return data


# ── Public page ──────────────────────────────────────────────────

@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("mvmWarehouse", "📦")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


# ── Companies (people only) ──────────────────────────────────────

def _companies_for(user_id: str) -> list:
    with _db() as conn:
        rows = conn.execute(
            "SELECT c.id, c.name, c.currency, c.owner_id, m.role, m.perms FROM companies c "
            "JOIN members m ON m.company_id=c.id WHERE m.user_id=? ORDER BY c.name COLLATE NOCASE",
            (user_id,),
        ).fetchall()
    out = []
    for r in rows:
        perms = dict(FULL) if r["role"] == "owner" else _norm_perms(r["perms"])
        out.append({"id": r["id"], "name": r["name"], "currency": r["currency"],
                    "role": r["role"], "perms": perms})
    return out


@router.get("/companies")
async def list_companies(request: Request):
    me = _user(request.headers.get("x-pub-token"))
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return {"companies": _companies_for(me["id"]), "me": me["id"]}


def _create_company(user_id: str, body: dict) -> dict:
    name = _s(body, "name")
    if not name:
        raise Err(400, "name_required")
    currency = _s(body, "currency", 3).upper() or "EUR"
    if currency not in CURRENCIES:
        currency = "EUR"
    now = _now()
    cid = _id()
    with _db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM companies WHERE owner_id=?", (user_id,)).fetchone()[0]
        if count >= 50:
            raise Err(400, "too_many")
        conn.execute(
            "INSERT INTO companies(id,owner_id,name,legal_name,currency,vat_registered,default_vat,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (cid, user_id, name, name, currency, _bool(body.get("vat_registered", True)),
             _num(body.get("default_vat"), "default_vat", 20, 0, 100), now, now),
        )
        conn.execute(
            "INSERT INTO members(company_id,user_id,role,perms,created_at) VALUES(?,?,'owner','{}',?)",
            (cid, user_id, now),
        )
        conn.execute(
            "INSERT INTO warehouses(id,company_id,name,is_default,created_at) VALUES(?,?,?,1,?)",
            (_id(), cid, _s(body, "warehouse_name") or "Main", now),
        )
        conn.commit()
    return {"id": cid}


@router.post("/companies")
async def create_company(request: Request):
    me = _user(request.headers.get("x-pub-token"))
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        return _create_company(me["id"], await _body(request))
    except Err as e:
        return _error(e)


@router.delete("/c/{cid}")
async def delete_company(cid: str, request: Request):
    """Owner only, and only with the company's name typed back (?confirm=)
    — everything it holds goes with it."""
    me = _user(request.headers.get("x-pub-token"))
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        ctx = _member_ctx(me["id"], cid)
        if ctx.role != "owner":
            raise Err(403, "forbidden")
        if request.query_params.get("confirm", "").strip() != ctx.company["name"]:
            raise Err(400, "confirm_mismatch")
        with _db() as conn:
            # Tables without a foreign key to companies (lines, list items)
            # hang off rows that do and cascade with them.
            conn.execute("DELETE FROM companies WHERE id=?", (cid,))
            conn.commit()
        shutil.rmtree(os.path.join(_UPLOADS_DIR, cid), ignore_errors=True)
        return {"ok": True}
    except Err as e:
        return _error(e)


# ── Company info & settings ──────────────────────────────────────

@endpoint("GET", "/info")
def company_info(ctx: Ctx, q, body):
    """Everything the widget or an integration needs before anything else:
    the company, the caller's rights, warehouses, price lists, categories."""
    with _db() as conn:
        whs = conn.execute(
            "SELECT id,name,address,is_default,archived FROM warehouses WHERE company_id=? "
            "ORDER BY is_default DESC, name COLLATE NOCASE", (ctx.cid,)).fetchall()
        pls = conn.execute(
            "SELECT id,name,discount,active FROM price_lists WHERE company_id=? ORDER BY name COLLATE NOCASE",
            (ctx.cid,)).fetchall()
        cats = conn.execute(
            "SELECT id,parent_id,name FROM categories WHERE company_id=? ORDER BY name COLLATE NOCASE",
            (ctx.cid,)).fetchall()
        inv_next = conn.execute(
            "SELECT next FROM counters WHERE company_id=? AND kind='invoice'", (ctx.cid,)).fetchone()
    return {
        "company": _company_public(ctx.company),
        "invoice_next": inv_next["next"] if inv_next else 1,
        "role": ctx.role,
        "perms": ctx.perms,
        "via": ctx.via,
        "warehouses": [dict(r) for r in whs],
        "price_lists": [dict(r) for r in pls],
        "categories": [dict(r) for r in cats],
    }


_COMPANY_TEXT = {"name": 200, "legal_name": 200, "vat_number": 40, "reg_number": 40,
                 "manager_name": 120, "address": 300, "city": 100, "country": 100,
                 "email": 200, "phone": 60, "bank_name": 120, "iban": 50, "bic": 20,
                 "invoice_prefix": 10, "order_prefix": 10, "invoice_note": 1000}


@endpoint("PUT", "/settings", api=False)
def update_settings(ctx: Ctx, q, body):
    ctx.need("settings", 2)
    sets, args = [], []
    for key, maxlen in _COMPANY_TEXT.items():
        if key in body:
            v = _s(body, key, maxlen)
            if key == "name" and not v:
                raise Err(400, "name_required")
            sets.append(f"{key}=?")
            args.append(v)
    if "currency" in body:
        cur = _s(body, "currency", 3).upper()
        if cur not in CURRENCIES:
            raise Err(400, "invalid_currency")
        sets.append("currency=?")
        args.append(cur)
    for key in ("vat_registered", "allow_negative"):
        if key in body:
            sets.append(f"{key}=?")
            args.append(_bool(body[key]))
    if "default_vat" in body:
        sets.append("default_vat=?")
        args.append(_num(body["default_vat"], "default_vat", None, 0, 100))
    if "payment_terms" in body:
        sets.append("payment_terms=?")
        args.append(int(_num(body["payment_terms"], "payment_terms", None, 0, 365)))
    if "invoice_digits" in body:
        sets.append("invoice_digits=?")
        args.append(int(_num(body["invoice_digits"], "invoice_digits", None, 1, 12)))
    with _db() as conn:
        if sets:
            sets.append("updated_at=?")
            args.append(_now())
            conn.execute(f"UPDATE companies SET {', '.join(sets)} WHERE id=?", (*args, ctx.cid))
        if "invoice_next" in body:
            # Lets a company continue the numbering it already had elsewhere;
            # going back below a number already issued is refused.
            n = int(_num(body["invoice_next"], "invoice_next", None, 1, 10 ** 12))
            used = conn.execute(
                "SELECT COUNT(*) FROM invoices WHERE company_id=? AND kind IN ('invoice','credit_note')",
                (ctx.cid,)).fetchone()[0]
            cur = conn.execute("SELECT next FROM counters WHERE company_id=? AND kind='invoice'",
                               (ctx.cid,)).fetchone()
            if used and cur and n < cur["next"]:
                raise Err(400, "invoice_number_backwards")
            conn.execute(
                "INSERT INTO counters(company_id,kind,next) VALUES(?,'invoice',?) "
                "ON CONFLICT(company_id,kind) DO UPDATE SET next=excluded.next", (ctx.cid, n))
        conn.commit()
    return {"ok": True}


# ── Members (people only) ────────────────────────────────────────

def _profiles(ids) -> dict:
    hub = _hub()
    ids = [i for i in set(ids) if i and ":" not in str(i)]
    if not hub or not ids:
        return {}
    return {p["id"]: p for p in hub.get_users_by_ids(ids)}


def _brief(p: Optional[dict]) -> dict:
    p = p or {}
    return {"username": p.get("username"), "display_name": p.get("display_name"),
            "avatar_color": p.get("avatar_color"), "avatar_svg": p.get("avatar_svg")}


@endpoint("GET", "/members", api=False)
def list_members(ctx: Ctx, q, body):
    ctx.need("settings", 1)
    with _db() as conn:
        rows = conn.execute(
            "SELECT user_id, role, perms, created_at FROM members WHERE company_id=? "
            "ORDER BY role='owner' DESC, created_at", (ctx.cid,)).fetchall()
    profiles = _profiles(r["user_id"] for r in rows)
    return {"members": [{
        "user_id": r["user_id"], "role": r["role"],
        "perms": dict(FULL) if r["role"] == "owner" else _norm_perms(r["perms"]),
        **_brief(profiles.get(r["user_id"])),
    } for r in rows], "presets": PRESETS}


@endpoint("GET", "/candidates", api=False)
def member_candidates(ctx: Ctx, q, body):
    """Favourites of the person asking who are not in the company yet —
    the same rule Shopping List and Budget use for sharing."""
    ctx.need("settings", 2)
    hub = _hub()
    favs = hub.get_favourites(ctx.actor) if hub else []
    with _db() as conn:
        ids = {r["user_id"] for r in conn.execute("SELECT user_id FROM members WHERE company_id=?", (ctx.cid,))}
    return {"candidates": [{"user_id": f["id"], **_brief(f)} for f in favs if f["id"] not in ids]}


def _role_perms(body: dict):
    role = _s(body, "role", 20) or "viewer"
    if role not in ROLES:
        raise Err(400, "invalid_role")
    perms = _norm_perms(body.get("perms")) if role == "custom" else dict(PRESETS[role])
    return role, perms


@endpoint("POST", "/members", api=False)
def add_member(ctx: Ctx, q, body):
    ctx.need("settings", 2)
    uid = _s(body, "user_id", 64)
    hub = _hub()
    favs = {f["id"] for f in (hub.get_favourites(ctx.actor) if hub else [])}
    if uid not in favs:
        raise Err(400, "not_favourite")
    role, perms = _role_perms(body)
    with _db() as conn:
        if conn.execute("SELECT 1 FROM members WHERE company_id=? AND user_id=?", (ctx.cid, uid)).fetchone():
            raise Err(400, "already_member")
        conn.execute("INSERT INTO members(company_id,user_id,role,perms,created_at) VALUES(?,?,?,?,?)",
                     (ctx.cid, uid, role, json.dumps(perms), _now()))
        conn.commit()
    _notify_added(ctx, uid)
    return {"ok": True}


@endpoint("PUT", "/members/{uid}", api=False)
def update_member(ctx: Ctx, q, body, uid):
    ctx.need("settings", 2)
    role, perms = _role_perms(body)
    with _db() as conn:
        row = conn.execute("SELECT role FROM members WHERE company_id=? AND user_id=?", (ctx.cid, uid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        if row["role"] == "owner":
            raise Err(400, "owner_fixed")
        if uid == ctx.actor and not perms.get("settings", 0) >= 2:
            # Nobody locks themselves out of the screen they are standing in;
            # someone else with settings rights (or the owner) can.
            raise Err(400, "cannot_demote_self")
        conn.execute("UPDATE members SET role=?, perms=? WHERE company_id=? AND user_id=?",
                     (role, json.dumps(perms), ctx.cid, uid))
        conn.commit()
    return {"ok": True}


@endpoint("DELETE", "/members/{uid}", api=False)
def remove_member(ctx: Ctx, q, body, uid):
    if uid != ctx.actor:
        ctx.need("settings", 2)
    with _db() as conn:
        row = conn.execute("SELECT role FROM members WHERE company_id=? AND user_id=?", (ctx.cid, uid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        if row["role"] == "owner":
            raise Err(400, "owner_fixed")
        conn.execute("DELETE FROM members WHERE company_id=? AND user_id=?", (ctx.cid, uid))
        conn.commit()
    return {"ok": True}


def _notify_added(ctx: Ctx, to_id: str):
    hub = _hub()
    notif = sys.modules.get("backend.notifications")
    if not hub or not notif:
        return
    users = hub.get_users_by_ids([to_id, ctx.actor])
    by_id = {u["id"]: u for u in users}
    to = by_id.get(to_id)
    if not to or not to.get("username"):
        return
    sender = (by_id.get(ctx.actor) or {}).get("display_name") or "?"
    try:
        notif.notify(
            APP_ID, to=to["username"], ref=ctx.cid,
            title_key="wh_notif_added", vars={"name": sender, "company": ctx.company["name"]},
            title=f'{sender} added you to "{ctx.company["name"]}" in mvmWarehouse',
        )
    except Exception:
        pass


# ── API keys (people only) ───────────────────────────────────────

@endpoint("GET", "/apikeys", api=False)
def list_keys(ctx: Ctx, q, body):
    ctx.need("settings", 2)
    with _db() as conn:
        rows = conn.execute(
            "SELECT id,name,prefix,perms,created_by,created_at,last_used_at FROM api_keys "
            "WHERE company_id=? ORDER BY created_at", (ctx.cid,)).fetchall()
    return {"keys": [{**dict(r), "perms": _norm_perms(r["perms"])} for r in rows]}


@endpoint("POST", "/apikeys", api=False)
def create_key(ctx: Ctx, q, body):
    ctx.need("settings", 2)
    name = _s(body, "name", 100)
    if not name:
        raise Err(400, "name_required")
    perms = _norm_perms(body.get("perms"))
    perms["settings"] = 0
    key = "whk_" + secrets.token_urlsafe(32)
    kid = _id()
    with _db() as conn:
        if conn.execute("SELECT COUNT(*) FROM api_keys WHERE company_id=?", (ctx.cid,)).fetchone()[0] >= 50:
            raise Err(400, "too_many")
        conn.execute(
            "INSERT INTO api_keys(id,company_id,name,key_hash,prefix,perms,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (kid, ctx.cid, name, _hash_key(key), key[:10], json.dumps(perms), ctx.actor, _now()))
        conn.commit()
    # The only time the key itself exists outside the caller's hands.
    return {"id": kid, "key": key}


@endpoint("DELETE", "/apikeys/{kid}", api=False)
def delete_key(ctx: Ctx, q, body, kid):
    ctx.need("settings", 2)
    with _db() as conn:
        cur = conn.execute("DELETE FROM api_keys WHERE id=? AND company_id=?", (kid, ctx.cid))
        conn.commit()
    if not cur.rowcount:
        raise Err(404, "not_found")
    return {"ok": True}


# ── Warehouses ───────────────────────────────────────────────────

@endpoint("POST", "/warehouses", api=False)
def create_warehouse(ctx: Ctx, q, body):
    ctx.need("settings", 2)
    name = _s(body, "name")
    if not name:
        raise Err(400, "name_required")
    wid = _id()
    with _db() as conn:
        conn.execute("INSERT INTO warehouses(id,company_id,name,address,created_at) VALUES(?,?,?,?,?)",
                     (wid, ctx.cid, name, _s(body, "address", 300), _now()))
        conn.commit()
    return {"id": wid}


@endpoint("PUT", "/warehouses/{wid}", api=False)
def update_warehouse(ctx: Ctx, q, body, wid):
    ctx.need("settings", 2)
    with _db() as conn:
        row = conn.execute("SELECT * FROM warehouses WHERE id=? AND company_id=?", (wid, ctx.cid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        name = _s(body, "name") if "name" in body else row["name"]
        if not name:
            raise Err(400, "name_required")
        address = _s(body, "address", 300) if "address" in body else row["address"]
        archived = _bool(body["archived"]) if "archived" in body else row["archived"]
        is_default = _bool(body["is_default"]) if "is_default" in body else row["is_default"]
        if row["is_default"] and (not is_default or archived):
            # Another warehouse becomes the default by being made one,
            # never by this one stepping down.
            raise Err(400, "default_warehouse")
        if is_default and not row["is_default"]:
            archived = 0
            conn.execute("UPDATE warehouses SET is_default=0 WHERE company_id=?", (ctx.cid,))
        conn.execute("UPDATE warehouses SET name=?, address=?, archived=?, is_default=? WHERE id=?",
                     (name, address, archived, is_default, wid))
        conn.commit()
    return {"ok": True}


@endpoint("DELETE", "/warehouses/{wid}", api=False)
def delete_warehouse(ctx: Ctx, q, body, wid):
    """Only a warehouse nothing ever happened in can go; any other is
    archived instead, so its history keeps pointing somewhere."""
    ctx.need("settings", 2)
    with _db() as conn:
        row = conn.execute("SELECT * FROM warehouses WHERE id=? AND company_id=?", (wid, ctx.cid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        if row["is_default"]:
            raise Err(400, "default_warehouse")
        used = conn.execute("SELECT 1 FROM movements WHERE warehouse_id=? LIMIT 1", (wid,)).fetchone() or \
            conn.execute("SELECT 1 FROM orders WHERE warehouse_id=? LIMIT 1", (wid,)).fetchone() or \
            conn.execute("SELECT 1 FROM stock_docs WHERE warehouse_id=? OR to_warehouse_id=? LIMIT 1", (wid, wid)).fetchone()
        if used:
            conn.execute("UPDATE warehouses SET archived=1 WHERE id=?", (wid,))
            conn.commit()
            return {"ok": True, "archived": True}
        conn.execute("DELETE FROM warehouses WHERE id=?", (wid,))
        conn.commit()
    return {"ok": True}


def _warehouse(conn, ctx: Ctx, wid: Optional[str], allow_archived: bool = False) -> dict:
    if not wid:
        row = conn.execute("SELECT * FROM warehouses WHERE company_id=? AND is_default=1", (ctx.cid,)).fetchone()
    else:
        row = conn.execute("SELECT * FROM warehouses WHERE id=? AND company_id=?", (wid, ctx.cid)).fetchone()
    if not row or (row["archived"] and not allow_archived):
        raise Err(400, "invalid_warehouse")
    return dict(row)


# ── Categories ───────────────────────────────────────────────────

@endpoint("GET", "/categories")
def list_categories(ctx: Ctx, q, body):
    with _db() as conn:
        rows = conn.execute(
            "SELECT c.id, c.parent_id, c.name, "
            "(SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) AS product_count "
            "FROM categories c WHERE c.company_id=? ORDER BY c.name COLLATE NOCASE", (ctx.cid,)).fetchall()
    return {"categories": [dict(r) for r in rows]}


def _check_parent(conn, ctx, cat_id, parent_id):
    if not parent_id:
        return None
    seen = set()
    cur = parent_id
    while cur:
        if cur == cat_id or cur in seen:
            raise Err(400, "invalid_parent")
        seen.add(cur)
        row = conn.execute("SELECT parent_id FROM categories WHERE id=? AND company_id=?", (cur, ctx.cid)).fetchone()
        if not row:
            raise Err(400, "invalid_parent")
        cur = row["parent_id"]
    return parent_id


@endpoint("POST", "/categories")
def create_category(ctx: Ctx, q, body):
    ctx.need("catalog", 2)
    name = _s(body, "name", 120)
    if not name:
        raise Err(400, "name_required")
    cid = _id()
    with _db() as conn:
        parent = _check_parent(conn, ctx, cid, _s(body, "parent_id", 64) or None)
        conn.execute("INSERT INTO categories(id,company_id,parent_id,name,created_at) VALUES(?,?,?,?,?)",
                     (cid, ctx.cid, parent, name, _now()))
        conn.commit()
    return {"id": cid}


@endpoint("PUT", "/categories/{cat_id}")
def update_category(ctx: Ctx, q, body, cat_id):
    ctx.need("catalog", 2)
    name = _s(body, "name", 120)
    if not name:
        raise Err(400, "name_required")
    with _db() as conn:
        if not conn.execute("SELECT 1 FROM categories WHERE id=? AND company_id=?", (cat_id, ctx.cid)).fetchone():
            raise Err(404, "not_found")
        parent = _check_parent(conn, ctx, cat_id, _s(body, "parent_id", 64) or None)
        conn.execute("UPDATE categories SET name=?, parent_id=? WHERE id=?", (name, parent, cat_id))
        conn.commit()
    return {"ok": True}


@endpoint("DELETE", "/categories/{cat_id}")
def delete_category(ctx: Ctx, q, body, cat_id):
    ctx.need("catalog", 2)
    with _db() as conn:
        row = conn.execute("SELECT parent_id FROM categories WHERE id=? AND company_id=?", (cat_id, ctx.cid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        # Children and products move up one level rather than disappear.
        conn.execute("UPDATE categories SET parent_id=? WHERE parent_id=? AND company_id=?",
                     (row["parent_id"], cat_id, ctx.cid))
        conn.execute("UPDATE products SET category_id=? WHERE category_id=? AND company_id=?",
                     (row["parent_id"], cat_id, ctx.cid))
        conn.execute("DELETE FROM categories WHERE id=?", (cat_id,))
        conn.commit()
    return {"ok": True}


# ── Products ─────────────────────────────────────────────────────

def _price_list(conn, ctx: Ctx, lid: Optional[str]) -> Optional[dict]:
    if not lid:
        return None
    row = conn.execute("SELECT * FROM price_lists WHERE id=? AND company_id=?", (lid, ctx.cid)).fetchone()
    if not row:
        raise Err(400, "invalid_price_list")
    return dict(row)


def _list_price(conn, product: dict, pl: Optional[dict]) -> float:
    """A product's price without VAT on a price list: the list's own price
    for it if it has one, otherwise the base price less the list's discount."""
    if not pl:
        return _r(product["price"])
    row = conn.execute("SELECT price FROM price_list_items WHERE price_list_id=? AND product_id=?",
                       (pl["id"], product["id"])).fetchone()
    if row:
        return _r(row["price"])
    return _r(product["price"] * (1 - (pl["discount"] or 0) / 100))


def _reserved(conn, cid: str, wid: Optional[str] = None) -> dict:
    sql = ("SELECT l.product_id, SUM(l.qty) AS q FROM order_lines l JOIN orders o ON o.id=l.order_id "
           "WHERE o.company_id=? AND o.status='confirmed' AND l.product_id IS NOT NULL")
    args = [cid]
    if wid:
        sql += " AND o.warehouse_id=?"
        args.append(wid)
    sql += " GROUP BY l.product_id"
    return {r["product_id"]: r["q"] or 0 for r in conn.execute(sql, args)}


def _reserved_by_wh(conn, cid: str) -> dict:
    rows = conn.execute(
        "SELECT l.product_id, o.warehouse_id, SUM(l.qty) AS q FROM order_lines l JOIN orders o ON o.id=l.order_id "
        "WHERE o.company_id=? AND o.status='confirmed' AND l.product_id IS NOT NULL "
        "GROUP BY l.product_id, o.warehouse_id", (cid,))
    return {(r["product_id"], r["warehouse_id"]): r["q"] or 0 for r in rows}


def _on_hand(conn, cid: str, wid: Optional[str] = None) -> dict:
    if wid:
        rows = conn.execute("SELECT product_id, qty AS q FROM stock WHERE company_id=? AND warehouse_id=?", (cid, wid))
    else:
        rows = conn.execute("SELECT product_id, SUM(qty) AS q FROM stock WHERE company_id=? GROUP BY product_id", (cid,))
    return {r["product_id"]: r["q"] or 0 for r in rows}


def _image_names(p: dict) -> list:
    try:
        names = json.loads(p.get("images") or "[]")
    except ValueError:
        return []
    return [n for n in names if isinstance(n, str) and _IMAGE_NAME_RE.match(n)]


def _product_out(ctx: Ctx, p: dict, on_hand=None, reserved=None, price=None) -> dict:
    d = {k: p[k] for k in ("id", "sku", "barcode", "name", "description", "category_id", "unit",
                           "is_service", "vat_rate", "price", "min_stock", "active", "online",
                           "web_description", "updated_at")}
    d["images"] = [f"{_UPLOADS_URL}/{p['company_id']}/{n}" for n in _image_names(p)]
    if ctx.can("costs"):
        d["cost_price"] = p["cost_price"]
    if price is not None:
        d["list_price"] = price
    if on_hand is not None and ctx.can("stock") and not p["is_service"]:
        d["on_hand"] = _rq(on_hand)
        d["reserved"] = _rq(reserved or 0)
        d["available"] = _rq(on_hand - (reserved or 0))
    return d


@endpoint("GET", "/products")
def list_products(ctx: Ctx, q, body):
    """Search the catalogue. With stock rights each product carries on hand,
    reserved and available (for one warehouse with warehouse_id, else all);
    with price_list_id, its price on that list as list_price."""
    if not (ctx.can("catalog") or ctx.can("stock") or ctx.can("orders") or ctx.can("pricelists")):
        raise Err(403, "forbidden", area="catalog")
    limit, offset = _limit(q, 500, 5000)
    where, args = ["company_id=?"], [ctx.cid]
    text = (q.get("q") or "").strip()
    if text:
        where.append("(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR barcode=?)")
        args += [_like(text), _like(text), text]
    if q.get("category_id"):
        where.append("category_id=?")
        args.append(q["category_id"])
    active = q.get("active", "1")
    if active in ("0", "1"):
        where.append("active=?")
        args.append(int(active))
    if q.get("online") in ("0", "1"):
        where.append("online=?")
        args.append(int(q["online"]))
    if q.get("services") in ("0", "1"):
        where.append("is_service=?")
        args.append(int(q["services"]))
    if q.get("updated_since"):
        where.append("updated_at>=?")
        args.append(str(q["updated_since"]))
    with _db() as conn:
        wid = q.get("warehouse_id") or None
        if wid:
            _warehouse(conn, ctx, wid, allow_archived=True)
        pl = _price_list(conn, ctx, q.get("price_list_id"))
        total = conn.execute(f"SELECT COUNT(*) FROM products WHERE {' AND '.join(where)}", args).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM products WHERE {' AND '.join(where)} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?",
            (*args, limit, offset)).fetchall()
        with_stock = ctx.can("stock")
        oh = _on_hand(conn, ctx.cid, wid) if with_stock else {}
        rs = _reserved(conn, ctx.cid, wid) if with_stock else {}
        out = []
        low_only = q.get("low") == "1"
        for r in rows:
            p = dict(r)
            if low_only and (p["is_service"] or not p["min_stock"] or oh.get(p["id"], 0) > p["min_stock"]):
                continue
            out.append(_product_out(
                ctx, p,
                oh.get(p["id"], 0) if with_stock else None,
                rs.get(p["id"], 0) if with_stock else None,
                _list_price(conn, p, pl) if pl else None))
    return {"items": out, "total": total}


def _get_product(conn, ctx: Ctx, pid: str) -> dict:
    row = conn.execute("SELECT * FROM products WHERE id=? AND company_id=?", (pid, ctx.cid)).fetchone()
    if not row:
        raise Err(404, "not_found")
    return dict(row)


@endpoint("GET", "/products/{pid}")
def get_product(ctx: Ctx, q, body, pid):
    if not (ctx.can("catalog") or ctx.can("stock") or ctx.can("orders")):
        raise Err(403, "forbidden", area="catalog")
    with _db() as conn:
        p = _get_product(conn, ctx, pid)
        out = _product_out(ctx, p)
        if ctx.can("stock"):
            rows = conn.execute(
                "SELECT w.id AS warehouse_id, w.name, w.archived, COALESCE(s.qty,0) AS qty FROM warehouses w "
                "LEFT JOIN stock s ON s.warehouse_id=w.id AND s.product_id=? WHERE w.company_id=? "
                "ORDER BY w.is_default DESC, w.name COLLATE NOCASE", (pid, ctx.cid)).fetchall()
            res = _reserved_by_wh(conn, ctx.cid)
            per = []
            for r in rows:
                if r["archived"] and not r["qty"]:
                    continue
                rq = res.get((pid, r["warehouse_id"]), 0)
                per.append({"warehouse_id": r["warehouse_id"], "name": r["name"], "on_hand": _rq(r["qty"]),
                            "reserved": _rq(rq), "available": _rq(r["qty"] - rq)})
            out["stock"] = per
            mv = conn.execute(
                "SELECT m.*, w.name AS warehouse_name FROM movements m LEFT JOIN warehouses w ON w.id=m.warehouse_id "
                "WHERE m.product_id=? AND m.company_id=? ORDER BY m.created_at DESC LIMIT 50", (pid, ctx.cid)).fetchall()
            out["movements"] = [_movement_out(ctx, dict(m)) for m in mv]
        if ctx.can("pricelists") or ctx.can("orders"):
            pls = conn.execute("SELECT * FROM price_lists WHERE company_id=? AND active=1 ORDER BY name COLLATE NOCASE",
                               (ctx.cid,)).fetchall()
            out["prices"] = [{"price_list_id": pl["id"], "name": pl["name"], "price": _list_price(conn, p, dict(pl))}
                             for pl in pls]
    return out


def _product_fields(conn, ctx: Ctx, body: dict, existing: Optional[dict]) -> dict:
    f = dict(existing or {})
    if existing is None or "name" in body:
        f["name"] = _s(body, "name")
        if not f["name"]:
            raise Err(400, "name_required")
    for key, maxlen in (("sku", 64), ("barcode", 64), ("unit", 20), ("description", 4000),
                        ("web_description", 20000)):
        if existing is None or key in body:
            f[key] = _s(body, key, maxlen)
    if existing is None or "category_id" in body:
        cat = _s(body, "category_id", 64) or None
        if cat and not conn.execute("SELECT 1 FROM categories WHERE id=? AND company_id=?", (cat, ctx.cid)).fetchone():
            raise Err(400, "invalid_category")
        f["category_id"] = cat
    if existing is None or "is_service" in body:
        f["is_service"] = _bool(body.get("is_service"))
    if existing is None or "active" in body:
        f["active"] = _bool(body.get("active", True))
    if existing is None or "online" in body:
        f["online"] = _bool(body.get("online"))
    if existing is not None and "images" in body:
        # Only a new order of the photos already there; adding goes through
        # the upload route and removing through its delete.
        names = [str(u).rsplit("/", 1)[-1] for u in (body.get("images") or [])]
        if sorted(names) != sorted(_image_names(existing)):
            raise Err(400, "invalid_items")
        f["images"] = json.dumps(names)
    default_vat = ctx.company["default_vat"] if ctx.company["vat_registered"] else 0
    if existing is None or "vat_rate" in body:
        f["vat_rate"] = _num(body.get("vat_rate"), "vat_rate", default_vat, 0, 100)
    if existing is None or "price" in body:
        f["price"] = _r(_num(body.get("price"), "price", 0, 0))
    if existing is None or "min_stock" in body:
        f["min_stock"] = _rq(_num(body.get("min_stock"), "min_stock", 0, 0))
    if "cost_price" in body and ctx.can("costs"):
        f["cost_price"] = _rq(_num(body.get("cost_price"), "cost_price", 0, 0))
    elif existing is None:
        f["cost_price"] = 0
    if f["sku"]:
        dup = conn.execute("SELECT id FROM products WHERE company_id=? AND sku=? AND id!=?",
                           (ctx.cid, f["sku"], (existing or {}).get("id", ""))).fetchone()
        if dup:
            raise Err(409, "sku_taken")
    return f


@endpoint("POST", "/products")
def create_product(ctx: Ctx, q, body):
    ctx.need("catalog", 2)
    now = _now()
    pid = _id()
    with _db() as conn:
        if conn.execute("SELECT COUNT(*) FROM products WHERE company_id=?", (ctx.cid,)).fetchone()[0] >= 100000:
            raise Err(400, "too_many")
        f = _product_fields(conn, ctx, body, None)
        conn.execute(
            "INSERT INTO products(id,company_id,sku,barcode,name,description,category_id,unit,is_service,vat_rate,"
            "price,cost_price,min_stock,active,online,web_description,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, ctx.cid, f["sku"], f["barcode"], f["name"], f["description"], f["category_id"], f["unit"],
             f["is_service"], f["vat_rate"], f["price"], f["cost_price"], f["min_stock"], f["active"], f["online"],
             f["web_description"], now, now))
        conn.commit()
        return _product_out(ctx, _get_product(conn, ctx, pid))


@endpoint("PUT", "/products/{pid}")
def update_product(ctx: Ctx, q, body, pid):
    ctx.need("catalog", 2)
    with _db() as conn:
        p = _get_product(conn, ctx, pid)
        f = _product_fields(conn, ctx, body, p)
        if f["is_service"] and not p["is_service"]:
            has = conn.execute("SELECT 1 FROM stock WHERE product_id=? AND qty!=0", (pid,)).fetchone()
            if has:
                raise Err(400, "service_has_stock")
        conn.execute(
            "UPDATE products SET sku=?,barcode=?,name=?,description=?,category_id=?,unit=?,is_service=?,vat_rate=?,"
            "price=?,cost_price=?,min_stock=?,active=?,online=?,web_description=?,images=?,updated_at=? WHERE id=?",
            (f["sku"], f["barcode"], f["name"], f["description"], f["category_id"], f["unit"], f["is_service"],
             f["vat_rate"], f["price"], f["cost_price"], f["min_stock"], f["active"], f["online"],
             f["web_description"], f["images"], _now(), pid))
        conn.commit()
        return _product_out(ctx, _get_product(conn, ctx, pid))


@endpoint("DELETE", "/products/{pid}")
def delete_product(ctx: Ctx, q, body, pid):
    """A product that appears in any document is deactivated instead of
    deleted; the documents keep their own copy of its name either way."""
    ctx.need("catalog", 2)
    with _db() as conn:
        _get_product(conn, ctx, pid)
        used = conn.execute("SELECT 1 FROM movements WHERE product_id=? LIMIT 1", (pid,)).fetchone() or \
            conn.execute("SELECT 1 FROM order_lines WHERE product_id=? LIMIT 1", (pid,)).fetchone() or \
            conn.execute("SELECT 1 FROM invoice_lines WHERE product_id=? LIMIT 1", (pid,)).fetchone() or \
            conn.execute("SELECT 1 FROM stock_doc_lines WHERE product_id=? LIMIT 1", (pid,)).fetchone()
        if used:
            conn.execute("UPDATE products SET active=0, online=0, updated_at=? WHERE id=?", (_now(), pid))
            conn.commit()
            return {"ok": True, "archived": True}
        names = _image_names(_get_product(conn, ctx, pid))
        conn.execute("DELETE FROM stock WHERE product_id=?", (pid,))
        conn.execute("DELETE FROM products WHERE id=?", (pid,))
        conn.commit()
    for n in names:
        _remove_image_file(ctx.cid, n)
    return {"ok": True}


# ── Product photos ───────────────────────────────────────────────

_IMAGE_MAGIC = ((b"\xff\xd8\xff", "jpg"), (b"\x89PNG\r\n\x1a\n", "png"), (b"GIF87a", "gif"), (b"GIF89a", "gif"))


def _image_ext(data: bytes) -> Optional[str]:
    """What the file really is, from its first bytes — never from its name or
    the browser's word for it, since these files are served to everyone."""
    for magic, ext in _IMAGE_MAGIC:
        if data.startswith(magic):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _remove_image_file(cid: str, name: str):
    if _IMAGE_NAME_RE.match(name):
        try:
            os.remove(os.path.join(_UPLOADS_DIR, cid, name))
        except OSError:
            pass


@endpoint("POST", "/products/{pid}/images")
def add_product_image(ctx: Ctx, q, body, pid):
    """Multipart upload, field "file": a JPEG, PNG, WebP or GIF photo of
    the product, up to 8 MB and 10 per product; added at the end."""
    ctx.need("catalog", 2)
    data = body.get("_file")
    if not isinstance(data, bytes) or not data:
        raise Err(400, "file_required")
    if len(data) > MAX_IMAGE_BYTES:
        raise Err(413, "too_large")
    ext = _image_ext(data)
    if not ext:
        raise Err(400, "not_image")
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        p = _get_product(conn, ctx, pid)
        names = _image_names(p)
        if len(names) >= MAX_IMAGES:
            raise Err(400, "too_many")
        name = f"{_id()}.{ext}"
        folder = os.path.join(_UPLOADS_DIR, ctx.cid)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, name), "wb") as fh:
            fh.write(data)
        conn.execute("UPDATE products SET images=?, updated_at=? WHERE id=?",
                     (json.dumps(names + [name]), _now(), pid))
        conn.commit()
        return _product_out(ctx, _get_product(conn, ctx, pid))


@endpoint("DELETE", "/products/{pid}/images/{name}")
def delete_product_image(ctx: Ctx, q, body, pid, name):
    ctx.need("catalog", 2)
    with _db() as conn:
        p = _get_product(conn, ctx, pid)
        names = _image_names(p)
        if name not in names:
            raise Err(404, "not_found")
        names.remove(name)
        conn.execute("UPDATE products SET images=?, updated_at=? WHERE id=?", (json.dumps(names), _now(), pid))
        conn.commit()
        out = _product_out(ctx, _get_product(conn, ctx, pid))
    _remove_image_file(ctx.cid, name)
    return out


# ── Price lists ──────────────────────────────────────────────────

@endpoint("GET", "/pricelists")
def list_pricelists(ctx: Ctx, q, body):
    if not (ctx.can("pricelists") or ctx.can("orders") or ctx.can("partners")):
        raise Err(403, "forbidden", area="pricelists")
    with _db() as conn:
        rows = conn.execute(
            "SELECT pl.*, (SELECT COUNT(*) FROM price_list_items i WHERE i.price_list_id=pl.id) AS item_count "
            "FROM price_lists pl WHERE pl.company_id=? ORDER BY pl.name COLLATE NOCASE", (ctx.cid,)).fetchall()
    return {"items": [dict(r) for r in rows]}


def _pricelist_fields(body: dict, existing: Optional[dict]) -> dict:
    f = dict(existing or {})
    if existing is None or "name" in body:
        f["name"] = _s(body, "name", 120)
        if not f["name"]:
            raise Err(400, "name_required")
    if existing is None or "discount" in body:
        f["discount"] = _num(body.get("discount"), "discount", 0, -1000, 100)
    if existing is None or "active" in body:
        f["active"] = _bool(body.get("active", True))
    return f


@endpoint("POST", "/pricelists")
def create_pricelist(ctx: Ctx, q, body):
    ctx.need("pricelists", 2)
    f = _pricelist_fields(body, None)
    lid = _id()
    with _db() as conn:
        conn.execute("INSERT INTO price_lists(id,company_id,name,discount,active,created_at) VALUES(?,?,?,?,?,?)",
                     (lid, ctx.cid, f["name"], f["discount"], f["active"], _now()))
        conn.commit()
    return {"id": lid}


@endpoint("PUT", "/pricelists/{lid}")
def update_pricelist(ctx: Ctx, q, body, lid):
    ctx.need("pricelists", 2)
    with _db() as conn:
        row = conn.execute("SELECT * FROM price_lists WHERE id=? AND company_id=?", (lid, ctx.cid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        f = _pricelist_fields(body, dict(row))
        conn.execute("UPDATE price_lists SET name=?, discount=?, active=? WHERE id=?",
                     (f["name"], f["discount"], f["active"], lid))
        conn.commit()
    return {"ok": True}


@endpoint("DELETE", "/pricelists/{lid}")
def delete_pricelist(ctx: Ctx, q, body, lid):
    ctx.need("pricelists", 2)
    with _db() as conn:
        if not conn.execute("SELECT 1 FROM price_lists WHERE id=? AND company_id=?", (lid, ctx.cid)).fetchone():
            raise Err(404, "not_found")
        conn.execute("UPDATE partners SET price_list_id=NULL WHERE price_list_id=? AND company_id=?", (lid, ctx.cid))
        conn.execute("DELETE FROM price_lists WHERE id=?", (lid,))
        conn.commit()
    return {"ok": True}


@endpoint("GET", "/pricelists/{lid}/items")
def pricelist_items(ctx: Ctx, q, body, lid):
    """Every active product with its base price, this list's own price (null
    when the list's discount applies) and the resulting price."""
    ctx.need("pricelists", 1)
    with _db() as conn:
        pl = _price_list(conn, ctx, lid)
        own = {r["product_id"]: r["price"] for r in
               conn.execute("SELECT product_id, price FROM price_list_items WHERE price_list_id=?", (lid,))}
        rows = conn.execute("SELECT * FROM products WHERE company_id=? AND active=1 ORDER BY name COLLATE NOCASE",
                            (ctx.cid,)).fetchall()
        items = []
        for r in rows:
            p = dict(r)
            items.append({"product_id": p["id"], "sku": p["sku"], "name": p["name"], "unit": p["unit"],
                          "base_price": p["price"], "price": own.get(p["id"]),
                          "effective": _r(own[p["id"]]) if p["id"] in own else _r(p["price"] * (1 - pl["discount"] / 100))})
    return {"price_list": pl, "items": items}


@endpoint("PUT", "/pricelists/{lid}/items")
def set_pricelist_items(ctx: Ctx, q, body, lid):
    """items: [{product_id, price}] — a null price takes the product back to
    the list's discount."""
    ctx.need("pricelists", 2)
    items = body.get("items")
    if not isinstance(items, list) or len(items) > 100000:
        raise Err(400, "invalid_items")
    with _db() as conn:
        _price_list(conn, ctx, lid)
        valid = {r["id"] for r in conn.execute("SELECT id FROM products WHERE company_id=?", (ctx.cid,))}
        for it in items:
            if not isinstance(it, dict) or it.get("product_id") not in valid:
                raise Err(400, "invalid_items")
            if it.get("price") is None or it.get("price") == "":
                conn.execute("DELETE FROM price_list_items WHERE price_list_id=? AND product_id=?",
                             (lid, it["product_id"]))
            else:
                conn.execute(
                    "INSERT INTO price_list_items(price_list_id,product_id,price) VALUES(?,?,?) "
                    "ON CONFLICT(price_list_id,product_id) DO UPDATE SET price=excluded.price",
                    (lid, it["product_id"], _r(_num(it["price"], "price", None, 0))))
        conn.commit()
    return {"ok": True}


# ── Partners ─────────────────────────────────────────────────────

def _balances(conn, cid: str) -> dict:
    """What each partner owes: invoices less credit notes less payments."""
    out = {}
    for r in conn.execute(
            "SELECT partner_id, SUM(CASE WHEN kind='invoice' THEN total WHEN kind='credit_note' THEN -total ELSE 0 END) s "
            "FROM invoices WHERE company_id=? AND status='issued' AND partner_id IS NOT NULL GROUP BY partner_id", (cid,)):
        out[r["partner_id"]] = r["s"] or 0
    for r in conn.execute(
            "SELECT partner_id, SUM(amount) s FROM payments WHERE company_id=? AND partner_id IS NOT NULL GROUP BY partner_id",
            (cid,)):
        out[r["partner_id"]] = out.get(r["partner_id"], 0) - (r["s"] or 0)
    return {k: _r(v) for k, v in out.items()}


_PARTNER_TEXT = {"name": 200, "vat_number": 40, "reg_number": 40, "manager_name": 120, "email": 200,
                 "phone": 60, "address": 300, "city": 100, "country": 100, "notes": 2000}


@endpoint("GET", "/partners")
def list_partners(ctx: Ctx, q, body):
    if not (ctx.can("partners") or ctx.can("orders") or ctx.can("invoices") or ctx.can("stock")):
        raise Err(403, "forbidden", area="partners")
    limit, offset = _limit(q, 500, 5000)
    where, args = ["company_id=?"], [ctx.cid]
    text = (q.get("q") or "").strip()
    if text:
        where.append("(name LIKE ? ESCAPE '\\' OR vat_number LIKE ? ESCAPE '\\' OR reg_number LIKE ? ESCAPE '\\' "
                     "OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')")
        args += [_like(text)] * 5
    kind = q.get("kind")
    if kind == "customer":
        where.append("kind IN ('customer','both')")
    elif kind == "supplier":
        where.append("kind IN ('supplier','both')")
    if q.get("active", "1") in ("0", "1"):
        where.append("active=?")
        args.append(int(q.get("active", "1")))
    with _db() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM partners WHERE {' AND '.join(where)}", args).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM partners WHERE {' AND '.join(where)} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?",
            (*args, limit, offset)).fetchall()
        bal = _balances(conn, ctx.cid) if (ctx.can("invoices") or ctx.can("payments")) else None
    items = []
    for r in rows:
        d = dict(r)
        if bal is not None:
            d["balance"] = bal.get(d["id"], 0)
        items.append(d)
    return {"items": items, "total": total}


def _get_partner(conn, ctx: Ctx, pid: Optional[str]) -> Optional[dict]:
    if not pid:
        return None
    row = conn.execute("SELECT * FROM partners WHERE id=? AND company_id=?", (pid, ctx.cid)).fetchone()
    if not row:
        raise Err(400, "invalid_partner")
    return dict(row)


@endpoint("GET", "/partners/{pid}")
def get_partner(ctx: Ctx, q, body, pid):
    if not (ctx.can("partners") or ctx.can("orders") or ctx.can("invoices")):
        raise Err(403, "forbidden", area="partners")
    with _db() as conn:
        row = conn.execute("SELECT * FROM partners WHERE id=? AND company_id=?", (pid, ctx.cid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        d = dict(row)
        if ctx.can("invoices") or ctx.can("payments"):
            d["balance"] = _balances(conn, ctx.cid).get(pid, 0)
    return d


def _partner_fields(conn, ctx: Ctx, body: dict, existing: Optional[dict]) -> dict:
    f = dict(existing or {})
    for key, maxlen in _PARTNER_TEXT.items():
        if existing is None or key in body:
            f[key] = _s(body, key, maxlen)
    if not f["name"]:
        raise Err(400, "name_required")
    if existing is None or "kind" in body:
        f["kind"] = body.get("kind") if body.get("kind") in PARTNER_KINDS else "customer"
    if existing is None or "price_list_id" in body:
        f["price_list_id"] = _s(body, "price_list_id", 64) or None
        if f["price_list_id"]:
            _price_list(conn, ctx, f["price_list_id"])
    if existing is None or "payment_terms" in body:
        v = body.get("payment_terms")
        f["payment_terms"] = None if v in (None, "") else int(_num(v, "payment_terms", None, 0, 365))
    if existing is None or "active" in body:
        f["active"] = _bool(body.get("active", True))
    return f


def _insert_partner(conn, ctx: Ctx, f: dict) -> str:
    pid = _id()
    now = _now()
    conn.execute(
        "INSERT INTO partners(id,company_id,kind,name,vat_number,reg_number,manager_name,email,phone,address,city,"
        "country,price_list_id,payment_terms,notes,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (pid, ctx.cid, f["kind"], f["name"], f["vat_number"], f["reg_number"], f["manager_name"], f["email"],
         f["phone"], f["address"], f["city"], f["country"], f["price_list_id"], f["payment_terms"], f["notes"],
         f["active"], now, now))
    return pid


@endpoint("POST", "/partners")
def create_partner(ctx: Ctx, q, body):
    ctx.need("partners", 2)
    with _db() as conn:
        f = _partner_fields(conn, ctx, body, None)
        pid = _insert_partner(conn, ctx, f)
        conn.commit()
    return {"id": pid}


@endpoint("PUT", "/partners/{pid}")
def update_partner(ctx: Ctx, q, body, pid):
    ctx.need("partners", 2)
    with _db() as conn:
        row = conn.execute("SELECT * FROM partners WHERE id=? AND company_id=?", (pid, ctx.cid)).fetchone()
        if not row:
            raise Err(404, "not_found")
        f = _partner_fields(conn, ctx, body, dict(row))
        conn.execute(
            "UPDATE partners SET kind=?,name=?,vat_number=?,reg_number=?,manager_name=?,email=?,phone=?,address=?,"
            "city=?,country=?,price_list_id=?,payment_terms=?,notes=?,active=?,updated_at=? WHERE id=?",
            (f["kind"], f["name"], f["vat_number"], f["reg_number"], f["manager_name"], f["email"], f["phone"],
             f["address"], f["city"], f["country"], f["price_list_id"], f["payment_terms"], f["notes"], f["active"],
             _now(), pid))
        conn.commit()
    return {"ok": True}


@endpoint("DELETE", "/partners/{pid}")
def delete_partner(ctx: Ctx, q, body, pid):
    ctx.need("partners", 2)
    with _db() as conn:
        if not conn.execute("SELECT 1 FROM partners WHERE id=? AND company_id=?", (pid, ctx.cid)).fetchone():
            raise Err(404, "not_found")
        used = conn.execute("SELECT 1 FROM orders WHERE partner_id=? LIMIT 1", (pid,)).fetchone() or \
            conn.execute("SELECT 1 FROM invoices WHERE partner_id=? LIMIT 1", (pid,)).fetchone() or \
            conn.execute("SELECT 1 FROM payments WHERE partner_id=? LIMIT 1", (pid,)).fetchone() or \
            conn.execute("SELECT 1 FROM stock_docs WHERE partner_id=? LIMIT 1", (pid,)).fetchone()
        if used:
            conn.execute("UPDATE partners SET active=0, updated_at=? WHERE id=?", (_now(), pid))
            conn.commit()
            return {"ok": True, "archived": True}
        conn.execute("DELETE FROM partners WHERE id=?", (pid,))
        conn.commit()
    return {"ok": True}


# ── Stock ────────────────────────────────────────────────────────

def _movement_out(ctx: Ctx, m: dict) -> dict:
    d = {k: m.get(k) for k in ("id", "product_id", "warehouse_id", "warehouse_name", "qty", "kind",
                               "ref_type", "ref_id", "ref_number", "created_at")}
    if ctx.can("costs"):
        d["unit_cost"] = m.get("unit_cost")
    return d


def _move(conn, ctx: Ctx, product: dict, wid: str, qty: float, unit_cost: float,
          kind: str, ref_type: str, ref_id: str, ref_number: str, force: bool = False):
    """One stock change, ledger row and running total together. Refuses to go
    below zero unless the company allows negative stock (or force, which an
    inventory count and a cancellation use: they restore a truth)."""
    qty = _rq(qty)
    if abs(qty) < _EPS:
        return
    row = conn.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (product["id"], wid)).fetchone()
    cur = row["qty"] if row else 0
    new = _rq(cur + qty)
    if qty < 0 and new < -_EPS and not ctx.company["allow_negative"] and not force:
        raise Err(409, "insufficient_stock", product_id=product["id"], product=product["name"],
                  available=_rq(cur), needed=_rq(-qty))
    conn.execute(
        "INSERT INTO stock(company_id,product_id,warehouse_id,qty) VALUES(?,?,?,?) "
        "ON CONFLICT(product_id,warehouse_id) DO UPDATE SET qty=excluded.qty",
        (ctx.cid, product["id"], wid, new))
    conn.execute(
        "INSERT INTO movements(id,company_id,product_id,warehouse_id,qty,unit_cost,kind,ref_type,ref_id,ref_number,actor,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (_id(), ctx.cid, product["id"], wid, qty, _rq(unit_cost), kind, ref_type, ref_id, ref_number, ctx.actor, _now()))


def _receive_cost(conn, product: dict, qty: float, unit_cost: float):
    """Weighted average cost after receiving qty at unit_cost."""
    total = conn.execute("SELECT COALESCE(SUM(qty),0) FROM stock WHERE product_id=?", (product["id"],)).fetchone()[0]
    base = max(total, 0)
    if base + qty <= _EPS:
        return
    new_cost = _rq((base * (product["cost_price"] or 0) + qty * unit_cost) / (base + qty))
    conn.execute("UPDATE products SET cost_price=? WHERE id=?", (new_cost, product["id"]))
    product["cost_price"] = new_cost


@endpoint("GET", "/stock")
def stock_levels(ctx: Ctx, q, body):
    """Plain stock rows for integrations: per product and warehouse, only
    where something is on hand or reserved."""
    ctx.need("stock", 1)
    with _db() as conn:
        sql = ("SELECT s.product_id, p.sku, s.warehouse_id, s.qty FROM stock s JOIN products p ON p.id=s.product_id "
               "WHERE s.company_id=?")
        args = [ctx.cid]
        if q.get("warehouse_id"):
            sql += " AND s.warehouse_id=?"
            args.append(q["warehouse_id"])
        if q.get("product_id"):
            sql += " AND s.product_id=?"
            args.append(q["product_id"])
        rows = conn.execute(sql, args).fetchall()
        res = _reserved_by_wh(conn, ctx.cid)
        items = []
        for r in rows:
            rq = res.get((r["product_id"], r["warehouse_id"]), 0)
            if not r["qty"] and not rq:
                continue
            items.append({"product_id": r["product_id"], "sku": r["sku"], "warehouse_id": r["warehouse_id"],
                          "on_hand": _rq(r["qty"]), "reserved": _rq(rq), "available": _rq(r["qty"] - rq)})
    return {"items": items}


@endpoint("GET", "/movements")
def list_movements(ctx: Ctx, q, body):
    ctx.need("stock", 1)
    limit, offset = _limit(q, 200, 2000)
    where, args = ["m.company_id=?"], [ctx.cid]
    for key in ("product_id", "warehouse_id", "kind"):
        if q.get(key):
            where.append(f"m.{key}=?")
            args.append(q[key])
    if q.get("from"):
        where.append("m.created_at>=?")
        args.append(_date(q["from"], "from"))
    if q.get("to"):
        where.append("m.created_at<?")
        args.append((date.fromisoformat(_date(q["to"], "to")) + timedelta(days=1)).isoformat())
    with _db() as conn:
        rows = conn.execute(
            f"SELECT m.*, w.name AS warehouse_name, p.name AS product_name, p.sku, p.unit FROM movements m "
            f"LEFT JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN products p ON p.id=m.product_id "
            f"WHERE {' AND '.join(where)} ORDER BY m.created_at DESC LIMIT ? OFFSET ?",
            (*args, limit, offset)).fetchall()
    return {"items": [{**_movement_out(ctx, dict(r)), "product_name": r["product_name"], "sku": r["sku"],
                       "unit": r["unit"]} for r in rows]}


def _doc_out(conn, ctx: Ctx, d: dict, with_lines: bool) -> dict:
    out = dict(d)
    if d.get("partner_id"):
        p = conn.execute("SELECT name FROM partners WHERE id=?", (d["partner_id"],)).fetchone()
        out["partner_name"] = p["name"] if p else ""
    if with_lines:
        rows = conn.execute(
            "SELECT l.*, p.name, p.sku, p.unit FROM stock_doc_lines l LEFT JOIN products p ON p.id=l.product_id "
            "WHERE l.doc_id=? ORDER BY l.position", (d["id"],)).fetchall()
        lines = []
        for r in rows:
            ln = {k: r[k] for k in ("id", "product_id", "name", "sku", "unit", "qty", "delta")}
            if ctx.can("costs"):
                ln["unit_cost"] = r["unit_cost"]
            lines.append(ln)
        out["lines"] = lines
    return out


@endpoint("GET", "/stockdocs")
def list_stockdocs(ctx: Ctx, q, body):
    ctx.need("stock", 1)
    limit, offset = _limit(q, 200, 2000)
    where, args = ["company_id=?"], [ctx.cid]
    if q.get("kind") in DOC_KINDS:
        where.append("kind=?")
        args.append(q["kind"])
    if q.get("status") in ("draft", "posted", "cancelled"):
        where.append("status=?")
        args.append(q["status"])
    with _db() as conn:
        rows = conn.execute(
            f"SELECT *, (SELECT COUNT(*) FROM stock_doc_lines l WHERE l.doc_id=stock_docs.id) AS line_count "
            f"FROM stock_docs WHERE {' AND '.join(where)} ORDER BY doc_date DESC, created_at DESC LIMIT ? OFFSET ?",
            (*args, limit, offset)).fetchall()
        return {"items": [_doc_out(conn, ctx, dict(r), False) for r in rows]}


def _get_doc(conn, ctx: Ctx, did: str) -> dict:
    row = conn.execute("SELECT * FROM stock_docs WHERE id=? AND company_id=?", (did, ctx.cid)).fetchone()
    if not row:
        raise Err(404, "not_found")
    return dict(row)


@endpoint("GET", "/stockdocs/{did}")
def get_stockdoc(ctx: Ctx, q, body, did):
    ctx.need("stock", 1)
    with _db() as conn:
        return _doc_out(conn, ctx, _get_doc(conn, ctx, did), True)


def _doc_fields(conn, ctx: Ctx, body: dict, existing: Optional[dict]):
    kind = existing["kind"] if existing else body.get("kind")
    if kind not in DOC_KINDS:
        raise Err(400, "invalid_kind")
    ex = existing or {}
    wid = _warehouse(conn, ctx, _s(body, "warehouse_id", 64) or ex.get("warehouse_id"))["id"]
    to_wid = None
    if kind == "transfer":
        to_wid = _warehouse(conn, ctx, _s(body, "to_warehouse_id", 64) or ex.get("to_warehouse_id") or "-")["id"]
        if to_wid == wid:
            raise Err(400, "same_warehouse")
    partner = _get_partner(conn, ctx, _s(body, "partner_id", 64) or None) if kind in ("receipt", "return") else None
    lines = body.get("lines")
    if not isinstance(lines, list) or not lines or len(lines) > 2000:
        raise Err(400, "lines_required")
    clean = []
    for ln in lines:
        if not isinstance(ln, dict):
            raise Err(400, "invalid_items")
        p = _get_product(conn, ctx, str(ln.get("product_id") or ""))
        if p["is_service"]:
            raise Err(400, "service_no_stock", product=p["name"])
        minimum = 0 if kind == "inventory" else _EPS
        qty = _rq(_num(ln.get("qty"), "qty", None, minimum))
        cost = p["cost_price"]
        if kind in ("receipt", "return") and ctx.can("costs") and ln.get("unit_cost") not in (None, ""):
            cost = _rq(_num(ln.get("unit_cost"), "unit_cost", None, 0))
        clean.append({"product_id": p["id"], "qty": qty, "unit_cost": cost})
    return {
        "kind": kind, "warehouse_id": wid, "to_warehouse_id": to_wid,
        "partner_id": partner["id"] if partner else None,
        "doc_date": _date(body.get("doc_date") or ex.get("doc_date"), "doc_date", _today()),
        "reference": _s(body, "reference", 100),
        "note": _s(body, "note", 2000),
        "lines": clean,
    }


def _write_doc_lines(conn, did: str, lines: list):
    conn.execute("DELETE FROM stock_doc_lines WHERE doc_id=?", (did,))
    for i, ln in enumerate(lines):
        conn.execute("INSERT INTO stock_doc_lines(id,doc_id,position,product_id,qty,unit_cost) VALUES(?,?,?,?,?,?)",
                     (_id(), did, i, ln["product_id"], ln["qty"], ln["unit_cost"]))


def _post_doc(conn, ctx: Ctx, doc: dict):
    lines = conn.execute("SELECT * FROM stock_doc_lines WHERE doc_id=? ORDER BY position", (doc["id"],)).fetchall()
    for ln in lines:
        p = _get_product(conn, ctx, ln["product_id"])
        kind, wid, num = doc["kind"], doc["warehouse_id"], doc["number"]
        if kind in ("receipt", "return"):
            _receive_cost(conn, p, ln["qty"], ln["unit_cost"])
            _move(conn, ctx, p, wid, ln["qty"], ln["unit_cost"], kind, "stockdoc", doc["id"], num)
        elif kind == "writeoff":
            _move(conn, ctx, p, wid, -ln["qty"], p["cost_price"], kind, "stockdoc", doc["id"], num)
        elif kind == "transfer":
            _move(conn, ctx, p, wid, -ln["qty"], p["cost_price"], "transfer_out", "stockdoc", doc["id"], num)
            _move(conn, ctx, p, doc["to_warehouse_id"], ln["qty"], p["cost_price"], "transfer_in", "stockdoc",
                  doc["id"], num)
        elif kind == "inventory":
            row = conn.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (p["id"], wid)).fetchone()
            delta = _rq(ln["qty"] - (row["qty"] if row else 0))
            conn.execute("UPDATE stock_doc_lines SET delta=? WHERE id=?", (delta, ln["id"]))
            _move(conn, ctx, p, wid, delta, p["cost_price"], "inventory", "stockdoc", doc["id"], num, force=True)
    conn.execute("UPDATE stock_docs SET status='posted', posted_at=? WHERE id=?", (_now(), doc["id"]))


@endpoint("POST", "/stockdocs")
def create_stockdoc(ctx: Ctx, q, body):
    """A stock document; with "post": true it is applied at once."""
    ctx.need("stock", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        f = _doc_fields(conn, ctx, body, None)
        did = _id()
        number = _DOC_PREFIX[f["kind"]] + str(_next_number(conn, ctx.cid, "doc_" + f["kind"])).zfill(6)
        conn.execute(
            "INSERT INTO stock_docs(id,company_id,kind,number,status,warehouse_id,to_warehouse_id,partner_id,doc_date,"
            "reference,note,created_by,created_at) VALUES(?,?,?,?,'draft',?,?,?,?,?,?,?,?)",
            (did, ctx.cid, f["kind"], number, f["warehouse_id"], f["to_warehouse_id"], f["partner_id"], f["doc_date"],
             f["reference"], f["note"], ctx.actor, _now()))
        _write_doc_lines(conn, did, f["lines"])
        if body.get("post"):
            _post_doc(conn, ctx, _get_doc(conn, ctx, did))
        conn.commit()
        return _doc_out(conn, ctx, _get_doc(conn, ctx, did), True)


@endpoint("PUT", "/stockdocs/{did}")
def update_stockdoc(ctx: Ctx, q, body, did):
    ctx.need("stock", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        doc = _get_doc(conn, ctx, did)
        if doc["status"] != "draft":
            raise Err(409, "not_draft")
        f = _doc_fields(conn, ctx, body, doc)
        conn.execute(
            "UPDATE stock_docs SET warehouse_id=?, to_warehouse_id=?, partner_id=?, doc_date=?, reference=?, note=? WHERE id=?",
            (f["warehouse_id"], f["to_warehouse_id"], f["partner_id"], f["doc_date"], f["reference"], f["note"], did))
        _write_doc_lines(conn, did, f["lines"])
        if body.get("post"):
            _post_doc(conn, ctx, _get_doc(conn, ctx, did))
        conn.commit()
        return _doc_out(conn, ctx, _get_doc(conn, ctx, did), True)


@endpoint("POST", "/stockdocs/{did}/post")
def post_stockdoc(ctx: Ctx, q, body, did):
    ctx.need("stock", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        doc = _get_doc(conn, ctx, did)
        if doc["status"] != "draft":
            raise Err(409, "not_draft")
        _post_doc(conn, ctx, doc)
        conn.commit()
        return _doc_out(conn, ctx, _get_doc(conn, ctx, did), True)


@endpoint("POST", "/stockdocs/{did}/cancel")
def cancel_stockdoc(ctx: Ctx, q, body, did):
    """Undo a posted document with opposite movements; the document itself
    stays, marked cancelled, so the ledger shows both."""
    ctx.need("stock", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        doc = _get_doc(conn, ctx, did)
        if doc["status"] == "draft":
            conn.execute("UPDATE stock_docs SET status='cancelled' WHERE id=?", (did,))
            conn.commit()
            return _doc_out(conn, ctx, _get_doc(conn, ctx, did), True)
        if doc["status"] != "posted":
            raise Err(409, "already_cancelled")
        num = doc["number"]
        for ln in conn.execute("SELECT * FROM stock_doc_lines WHERE doc_id=? ORDER BY position", (did,)).fetchall():
            p = _get_product(conn, ctx, ln["product_id"])
            k, wid = doc["kind"], doc["warehouse_id"]
            if k in ("receipt", "return"):
                _move(conn, ctx, p, wid, -ln["qty"], ln["unit_cost"], "cancel", "stockdoc", did, num)
            elif k == "writeoff":
                _move(conn, ctx, p, wid, ln["qty"], p["cost_price"], "cancel", "stockdoc", did, num)
            elif k == "transfer":
                _move(conn, ctx, p, doc["to_warehouse_id"], -ln["qty"], p["cost_price"], "cancel", "stockdoc", did, num)
                _move(conn, ctx, p, wid, ln["qty"], p["cost_price"], "cancel", "stockdoc", did, num)
            elif k == "inventory" and ln["delta"]:
                _move(conn, ctx, p, wid, -ln["delta"], p["cost_price"], "cancel", "stockdoc", did, num, force=True)
        conn.execute("UPDATE stock_docs SET status='cancelled' WHERE id=?", (did,))
        conn.commit()
        return _doc_out(conn, ctx, _get_doc(conn, ctx, did), True)


@endpoint("DELETE", "/stockdocs/{did}")
def delete_stockdoc(ctx: Ctx, q, body, did):
    ctx.need("stock", 2)
    with _db() as conn:
        doc = _get_doc(conn, ctx, did)
        if doc["status"] == "posted":
            raise Err(409, "not_draft")
        conn.execute("DELETE FROM stock_docs WHERE id=?", (did,))
        conn.commit()
    return {"ok": True}


# ── Document lines (orders and invoices) ─────────────────────────

def _lines_in(conn, ctx: Ctx, raw, pl: Optional[dict]) -> list:
    """Order or invoice lines from a request. A line names a product (price
    and VAT default to the product's on the price list) or is free text with
    its own name and price, e.g. delivery."""
    if not isinstance(raw, list) or not raw or len(raw) > 1000:
        raise Err(400, "lines_required")
    vat_default = ctx.company["default_vat"] if ctx.company["vat_registered"] else 0
    out = []
    for ln in raw:
        if not isinstance(ln, dict):
            raise Err(400, "invalid_items")
        qty = _rq(_num(ln.get("qty"), "qty", 1, _EPS))
        pid = str(ln.get("product_id") or "") or None
        if pid:
            p = _get_product(conn, ctx, pid)
            price = _num(ln.get("unit_price"), "unit_price", _list_price(conn, p, pl), 0)
            name = _s(ln, "name", 300) or p["name"]
            vat = _num(ln.get("vat_rate"), "vat_rate", p["vat_rate"] if ctx.company["vat_registered"] else 0, 0, 100)
            sku, unit = p["sku"], _s(ln, "unit", 20) or p["unit"]
        else:
            name = _s(ln, "name", 300)
            if not name:
                raise Err(400, "name_required")
            price = _num(ln.get("unit_price"), "unit_price", None, 0)
            vat = _num(ln.get("vat_rate"), "vat_rate", vat_default, 0, 100)
            sku, unit = _s(ln, "sku", 64), _s(ln, "unit", 20)
        if not ctx.company["vat_registered"]:
            vat = 0
        discount = _num(ln.get("discount"), "discount", 0, 0, 100)
        price = _rq(price)
        net = _r(qty * price * (1 - discount / 100))
        out.append({"product_id": pid, "name": name, "sku": sku, "unit": unit, "qty": qty,
                    "unit_price": price, "discount": discount, "vat_rate": vat, "net": net})
    return out


def _totals(lines: list):
    """Net per line, VAT per rate on the rate's net, then the sum — the way
    an invoice's VAT is usually shown and checked."""
    subtotal = _r(sum(ln["net"] for ln in lines))
    by_rate = {}
    for ln in lines:
        by_rate[ln["vat_rate"]] = by_rate.get(ln["vat_rate"], 0) + ln["net"]
    vat = _r(sum(_r(net * rate / 100) for rate, net in by_rate.items()))
    return subtotal, vat, _r(subtotal + vat)


def _write_lines(conn, table: str, fk: str, parent_id: str, lines: list):
    conn.execute(f"DELETE FROM {table} WHERE {fk}=?", (parent_id,))
    for i, ln in enumerate(lines):
        conn.execute(
            f"INSERT INTO {table}(id,{fk},position,product_id,name,sku,unit,qty,unit_price,discount,vat_rate,net) "
            f"VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (_id(), parent_id, i, ln["product_id"], ln["name"], ln["sku"], ln["unit"], ln["qty"],
             ln["unit_price"], ln["discount"], ln["vat_rate"], ln["net"]))


def _read_lines(conn, table: str, fk: str, parent_id: str) -> list:
    rows = conn.execute(f"SELECT * FROM {table} WHERE {fk}=? ORDER BY position", (parent_id,)).fetchall()
    return [{k: r[k] for k in ("id", "product_id", "name", "sku", "unit", "qty", "unit_price", "discount",
                               "vat_rate", "net")} for r in rows]


# ── Orders ───────────────────────────────────────────────────────

def _get_order(conn, ctx: Ctx, oid: str) -> dict:
    row = conn.execute("SELECT * FROM orders WHERE id=? AND company_id=?", (oid, ctx.cid)).fetchone()
    if not row:
        raise Err(404, "not_found")
    return dict(row)


def _order_out(conn, ctx: Ctx, o: dict, full: bool) -> dict:
    d = dict(o)
    d.pop("idempotency_key", None)
    if o.get("partner_id"):
        p = conn.execute("SELECT name FROM partners WHERE id=?", (o["partner_id"],)).fetchone()
        d["partner_name"] = p["name"] if p else ""
    d["paid"] = _r(conn.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE order_id=?",
                                (o["id"],)).fetchone()[0])
    if o.get("invoice_id"):
        inv = conn.execute("SELECT number FROM invoices WHERE id=?", (o["invoice_id"],)).fetchone()
        d["invoice_number"] = inv["number"] if inv else ""
    if full:
        d["lines"] = _read_lines(conn, "order_lines", "order_id", o["id"])
        if ctx.can("payments"):
            d["payments"] = [dict(r) for r in conn.execute(
                "SELECT id, amount, method, pay_date, reference FROM payments WHERE order_id=? ORDER BY pay_date",
                (o["id"],))]
    return d


@endpoint("GET", "/orders")
def list_orders(ctx: Ctx, q, body):
    ctx.need("orders", 1)
    limit, offset = _limit(q, 200, 2000)
    where, args = ["o.company_id=?"], [ctx.cid]
    if q.get("status") in ORDER_STATES:
        where.append("o.status=?")
        args.append(q["status"])
    elif q.get("status") == "open":
        where.append("o.status IN ('draft','confirmed')")
    if q.get("partner_id"):
        where.append("o.partner_id=?")
        args.append(q["partner_id"])
    if q.get("source"):
        where.append("o.source=?")
        args.append(str(q["source"]))
    if q.get("external_ref"):
        where.append("o.external_ref=?")
        args.append(str(q["external_ref"]))
    text = (q.get("q") or "").strip()
    if text:
        where.append("(o.number LIKE ? ESCAPE '\\' OR o.external_ref LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')")
        args += [_like(text)] * 3
    with _db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM orders o LEFT JOIN partners p ON p.id=o.partner_id WHERE {' AND '.join(where)}",
            args).fetchone()[0]
        rows = conn.execute(
            f"SELECT o.* FROM orders o LEFT JOIN partners p ON p.id=o.partner_id WHERE {' AND '.join(where)} "
            f"ORDER BY o.order_date DESC, o.created_at DESC LIMIT ? OFFSET ?", (*args, limit, offset)).fetchall()
        return {"items": [_order_out(conn, ctx, dict(r), False) for r in rows], "total": total}


@endpoint("GET", "/orders/{oid}")
def get_order(ctx: Ctx, q, body, oid):
    ctx.need("orders", 1)
    with _db() as conn:
        return _order_out(conn, ctx, _get_order(conn, ctx, oid), True)


def _customer_partner(conn, ctx: Ctx, cust) -> Optional[str]:
    """A customer given inline (an online shop's checkout): matched to an
    existing partner by e-mail, otherwise created as a new customer."""
    if not isinstance(cust, dict):
        return None
    name = _s(cust, "name")
    if not name:
        raise Err(400, "name_required")
    email = _s(cust, "email", 200)
    if email:
        row = conn.execute("SELECT id FROM partners WHERE company_id=? AND email=? COLLATE NOCASE AND active=1",
                           (ctx.cid, email)).fetchone()
        if row:
            return row["id"]
    f = {k: _s(cust, k, m) for k, m in _PARTNER_TEXT.items()}
    f.update({"kind": "customer", "price_list_id": None, "payment_terms": None, "active": 1})
    return _insert_partner(conn, ctx, f)


def _available(conn, cid: str, pid: str, wid: str, exclude_order: Optional[str] = None) -> float:
    row = conn.execute("SELECT qty FROM stock WHERE product_id=? AND warehouse_id=?", (pid, wid)).fetchone()
    sql = ("SELECT COALESCE(SUM(l.qty),0) FROM order_lines l JOIN orders o ON o.id=l.order_id "
           "WHERE o.company_id=? AND o.status='confirmed' AND o.warehouse_id=? AND l.product_id=?")
    args = [cid, wid, pid]
    if exclude_order:
        sql += " AND o.id!=?"
        args.append(exclude_order)
    return (row["qty"] if row else 0) - conn.execute(sql, args).fetchone()[0]


def _check_availability(conn, ctx: Ctx, order: dict):
    if ctx.company["allow_negative"]:
        return
    need = {}
    for ln in conn.execute("SELECT product_id, qty FROM order_lines WHERE order_id=? AND product_id IS NOT NULL",
                           (order["id"],)):
        need[ln["product_id"]] = need.get(ln["product_id"], 0) + ln["qty"]
    for pid, qty in need.items():
        p = _get_product(conn, ctx, pid)
        if p["is_service"]:
            continue
        avail = _available(conn, ctx.cid, pid, order["warehouse_id"], order["id"])
        if avail + _EPS < qty:
            raise Err(409, "insufficient_stock", product_id=pid, product=p["name"],
                      available=_rq(avail), needed=_rq(qty))


def _order_fields(conn, ctx: Ctx, body: dict, existing: Optional[dict]) -> dict:
    ex = existing or {}
    partner_id = _s(body, "partner_id", 64) if "partner_id" in body else ex.get("partner_id")
    if not partner_id and body.get("customer"):
        partner_id = _customer_partner(conn, ctx, body["customer"])
    partner = _get_partner(conn, ctx, partner_id or None)
    wid = _warehouse(conn, ctx, _s(body, "warehouse_id", 64) or ex.get("warehouse_id"))["id"]
    if "price_list_id" in body:
        pl_id = _s(body, "price_list_id", 64) or None
    elif existing:
        pl_id = ex.get("price_list_id")
    else:
        pl_id = partner["price_list_id"] if partner else None
    pl = _price_list(conn, ctx, pl_id)
    return {
        "partner_id": partner["id"] if partner else None,
        "warehouse_id": wid,
        "price_list_id": pl["id"] if pl else None,
        "order_date": _date(body.get("order_date") or ex.get("order_date"), "order_date", _today()),
        "ship_to": _s(body, "ship_to", 500) if "ship_to" in body else ex.get("ship_to", ""),
        "note": _s(body, "note", 2000) if "note" in body else ex.get("note", ""),
        "external_ref": _s(body, "external_ref", 100) if "external_ref" in body else ex.get("external_ref", ""),
        "lines": _lines_in(conn, ctx, body.get("lines"), pl) if (existing is None or "lines" in body) else None,
    }


def create_order_in(ctx: Ctx, body: dict, source: str) -> dict:
    ctx.need("orders", 2)
    idem = _s(body, "idempotency_key", 200) or None
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if idem:
            row = conn.execute("SELECT * FROM orders WHERE company_id=? AND idempotency_key=?", (ctx.cid, idem)).fetchone()
            if row:
                conn.rollback()
                return _order_out(conn, ctx, dict(row), True)
        f = _order_fields(conn, ctx, body, None)
        subtotal, vat, total = _totals(f["lines"])
        oid = _id()
        now = _now()
        number = (ctx.company["order_prefix"] or "") + str(_next_number(conn, ctx.cid, "order")).zfill(6)
        conn.execute(
            "INSERT INTO orders(id,company_id,number,status,partner_id,warehouse_id,price_list_id,order_date,ship_to,"
            "currency,subtotal,vat_total,total,note,source,external_ref,idempotency_key,created_by,created_at,updated_at) "
            "VALUES(?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (oid, ctx.cid, number, f["partner_id"], f["warehouse_id"], f["price_list_id"], f["order_date"], f["ship_to"],
             ctx.company["currency"], subtotal, vat, total, f["note"], source, f["external_ref"], idem, ctx.actor, now, now))
        _write_lines(conn, "order_lines", "order_id", oid, f["lines"])
        if body.get("status") == "confirmed":
            order = _get_order(conn, ctx, oid)
            _check_availability(conn, ctx, order)
            conn.execute("UPDATE orders SET status='confirmed', confirmed_at=? WHERE id=?", (now, oid))
        conn.commit()
        return _order_out(conn, ctx, _get_order(conn, ctx, oid), True)


@endpoint("POST", "/orders")
def create_order(ctx: Ctx, q, body):
    source = "manual"
    if ctx.via != "user":
        source = _s(body, "source", 30) or ctx.via
    return create_order_in(ctx, body, source)


@endpoint("PUT", "/orders/{oid}")
def update_order(ctx: Ctx, q, body, oid):
    ctx.need("orders", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        o = _get_order(conn, ctx, oid)
        if o["status"] != "draft":
            raise Err(409, "not_draft")
        f = _order_fields(conn, ctx, body, o)
        conn.execute(
            "UPDATE orders SET partner_id=?, warehouse_id=?, price_list_id=?, order_date=?, ship_to=?, note=?, "
            "external_ref=?, updated_at=? WHERE id=?",
            (f["partner_id"], f["warehouse_id"], f["price_list_id"], f["order_date"], f["ship_to"], f["note"],
             f["external_ref"], _now(), oid))
        if f["lines"] is not None:
            subtotal, vat, total = _totals(f["lines"])
            _write_lines(conn, "order_lines", "order_id", oid, f["lines"])
            conn.execute("UPDATE orders SET subtotal=?, vat_total=?, total=? WHERE id=?", (subtotal, vat, total, oid))
        conn.commit()
        return _order_out(conn, ctx, _get_order(conn, ctx, oid), True)


_TRANSITIONS = {
    "draft": {"confirmed", "cancelled"},
    "confirmed": {"draft", "shipped", "cancelled"},
    "cancelled": {"draft"},
    "shipped": set(),
}


def set_order_status_in(ctx: Ctx, oid: str, status: str) -> dict:
    ctx.need("orders", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        o = _get_order(conn, ctx, oid)
        if status == o["status"]:
            conn.rollback()
            return _order_out(conn, ctx, o, True)
        if status not in _TRANSITIONS.get(o["status"], set()):
            raise Err(409, "invalid_transition", status=o["status"])
        now = _now()
        if status == "confirmed":
            _check_availability(conn, ctx, o)
            conn.execute("UPDATE orders SET status='confirmed', confirmed_at=?, updated_at=? WHERE id=?", (now, now, oid))
        elif status == "shipped":
            # Shipping is where stock actually leaves, so it needs stock rights
            # as well as order rights: a salesperson confirms, the warehouse ships.
            ctx.need("stock", 2)
            for ln in conn.execute("SELECT * FROM order_lines WHERE order_id=? AND product_id IS NOT NULL ORDER BY position",
                                   (oid,)).fetchall():
                p = _get_product(conn, ctx, ln["product_id"])
                if p["is_service"]:
                    continue
                _move(conn, ctx, p, o["warehouse_id"], -ln["qty"], p["cost_price"], "sale", "order", oid, o["number"])
            conn.execute("UPDATE orders SET status='shipped', shipped_at=?, updated_at=? WHERE id=?", (now, now, oid))
        else:
            conn.execute("UPDATE orders SET status=?, updated_at=? WHERE id=?", (status, now, oid))
        conn.commit()
        return _order_out(conn, ctx, _get_order(conn, ctx, oid), True)


@endpoint("POST", "/orders/{oid}/status")
def set_order_status(ctx: Ctx, q, body, oid):
    status = body.get("status")
    if status not in ORDER_STATES:
        raise Err(400, "invalid_status")
    return set_order_status_in(ctx, oid, status)


@endpoint("DELETE", "/orders/{oid}")
def delete_order(ctx: Ctx, q, body, oid):
    ctx.need("orders", 2)
    with _db() as conn:
        o = _get_order(conn, ctx, oid)
        if o["status"] not in ("draft", "cancelled"):
            raise Err(409, "not_draft")
        if o["invoice_id"] or conn.execute("SELECT 1 FROM payments WHERE order_id=? LIMIT 1", (oid,)).fetchone():
            raise Err(409, "has_documents")
        conn.execute("DELETE FROM orders WHERE id=?", (oid,))
        conn.commit()
    return {"ok": True}


# ── Invoices ─────────────────────────────────────────────────────

def _party(src: dict) -> dict:
    return {k: src.get(k) or "" for k in ("name", "legal_name", "vat_number", "reg_number", "manager_name",
                                          "address", "city", "country", "email", "phone", "bank_name", "iban", "bic")}


def _pay_state(inv: dict, paid: float) -> str:
    if inv["status"] == "cancelled":
        return "cancelled"
    if inv["kind"] != "invoice":
        return inv["kind"]
    if paid >= inv["total"] - 0.005:
        return "paid"
    if inv["due_date"] < _today():
        return "overdue"
    return "partial" if paid > 0.005 else "unpaid"


def _get_invoice(conn, ctx: Ctx, iid: str) -> dict:
    row = conn.execute("SELECT * FROM invoices WHERE id=? AND company_id=?", (iid, ctx.cid)).fetchone()
    if not row:
        raise Err(404, "not_found")
    return dict(row)


def _invoice_out(conn, ctx: Ctx, inv: dict, full: bool) -> dict:
    d = dict(inv)
    d["supplier"] = json.loads(d.pop("supplier_json") or "{}")
    d["recipient"] = json.loads(d.pop("recipient_json") or "{}")
    paid = conn.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=?", (inv["id"],)).fetchone()[0]
    credited = conn.execute("SELECT 1 FROM invoices WHERE related_id=? AND status='issued'", (inv["id"],)).fetchone()
    d["paid"] = _r(paid)
    d["pay_state"] = "credited" if credited and inv["status"] == "issued" else _pay_state(inv, paid)
    if inv.get("order_id"):
        o = conn.execute("SELECT number FROM orders WHERE id=?", (inv["order_id"],)).fetchone()
        d["order_number"] = o["number"] if o else ""
    if inv.get("related_id"):
        r = conn.execute("SELECT number FROM invoices WHERE id=?", (inv["related_id"],)).fetchone()
        d["related_number"] = r["number"] if r else ""
    if full:
        d["lines"] = _read_lines(conn, "invoice_lines", "invoice_id", inv["id"])
        if ctx.can("payments"):
            d["payments"] = [dict(r) for r in conn.execute(
                "SELECT id, amount, method, pay_date, reference FROM payments WHERE invoice_id=? ORDER BY pay_date",
                (inv["id"],))]
        credits = conn.execute("SELECT id, number FROM invoices WHERE related_id=? AND status='issued'",
                               (inv["id"],)).fetchall()
        d["credit_notes"] = [dict(r) for r in credits]
    return d


@endpoint("GET", "/invoices")
def list_invoices(ctx: Ctx, q, body):
    ctx.need("invoices", 1)
    limit, offset = _limit(q, 200, 2000)
    where, args = ["i.company_id=?"], [ctx.cid]
    if q.get("kind") in ("invoice", "credit_note", "proforma"):
        where.append("i.kind=?")
        args.append(q["kind"])
    if q.get("partner_id"):
        where.append("i.partner_id=?")
        args.append(q["partner_id"])
    if q.get("from"):
        where.append("i.issue_date>=?")
        args.append(_date(q["from"], "from"))
    if q.get("to"):
        where.append("i.issue_date<=?")
        args.append(_date(q["to"], "to"))
    text = (q.get("q") or "").strip()
    if text:
        where.append("(i.number LIKE ? ESCAPE '\\' OR i.recipient_json LIKE ? ESCAPE '\\')")
        args += [_like(text)] * 2
    state = q.get("state")
    with _db() as conn:
        rows = conn.execute(
            f"SELECT i.* FROM invoices i WHERE {' AND '.join(where)} ORDER BY i.issue_date DESC, i.number DESC",
            args).fetchall()
        items = [_invoice_out(conn, ctx, dict(r), False) for r in rows]
    if state == "open":
        items = [i for i in items if i["pay_state"] in ("unpaid", "partial", "overdue")]
    elif state:
        items = [i for i in items if i["pay_state"] == state]
    return {"items": items[offset:offset + limit], "total": len(items)}


@endpoint("GET", "/invoices/{iid}")
def get_invoice(ctx: Ctx, q, body, iid):
    ctx.need("invoices", 1)
    with _db() as conn:
        return _invoice_out(conn, ctx, _get_invoice(conn, ctx, iid), True)


def _insert_invoice(conn, ctx: Ctx, kind: str, partner: Optional[dict], recipient: dict, lines: list,
                    body: dict, order_id=None, related_id=None) -> str:
    issue = _date(body.get("issue_date"), "issue_date", _today())
    terms = partner["payment_terms"] if partner and partner.get("payment_terms") is not None else ctx.company["payment_terms"]
    due_default = (date.fromisoformat(issue) + timedelta(days=terms or 0)).isoformat()
    method = body.get("payment_method") if body.get("payment_method") in PAY_METHODS else "bank"
    counter = "proforma" if kind == "proforma" else "invoice"
    n = _next_number(conn, ctx.cid, counter)
    number = ("PF-" + str(n).zfill(6)) if kind == "proforma" else _format_invoice_number(ctx.company, n)
    if kind != "proforma" and conn.execute(
            "SELECT 1 FROM invoices WHERE company_id=? AND number=? AND kind!='proforma'", (ctx.cid, number)).fetchone():
        raise Err(409, "number_taken", number=number)
    subtotal, vat, total = _totals(lines)
    supplier = _party(ctx.company)
    iid = _id()
    conn.execute(
        "INSERT INTO invoices(id,company_id,kind,number,status,order_id,related_id,partner_id,supplier_json,recipient_json,"
        "issue_date,tax_date,due_date,currency,subtotal,vat_total,total,payment_method,note,created_by,created_at) "
        "VALUES(?,?,?,?,'issued',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (iid, ctx.cid, kind, number, order_id, related_id, partner["id"] if partner else None,
         json.dumps(supplier, ensure_ascii=False), json.dumps(recipient, ensure_ascii=False),
         issue, _date(body.get("tax_date"), "tax_date", issue), _date(body.get("due_date"), "due_date", due_default),
         ctx.company["currency"], subtotal, vat, total, method,
         _s(body, "note", 2000) or (ctx.company["invoice_note"] or ""), ctx.actor, _now()))
    _write_lines(conn, "invoice_lines", "invoice_id", iid, lines)
    return iid


@endpoint("POST", "/invoices")
def create_invoice(ctx: Ctx, q, body):
    """From an order (order_id) or on its own (partner_id + lines). kind is
    invoice (default) or proforma; a credit note is made from its invoice."""
    ctx.need("invoices", 2)
    kind = body.get("kind") or "invoice"
    if kind not in ("invoice", "proforma"):
        raise Err(400, "invalid_kind")
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        order_id = _s(body, "order_id", 64) or None
        if order_id:
            o = _get_order(conn, ctx, order_id)
            if o["status"] == "cancelled":
                raise Err(409, "order_cancelled")
            if kind == "invoice" and o["invoice_id"]:
                existing = conn.execute("SELECT status FROM invoices WHERE id=?", (o["invoice_id"],)).fetchone()
                if existing and existing["status"] == "issued":
                    raise Err(409, "already_invoiced")
            partner = _get_partner(conn, ctx, o["partner_id"])
            lines = _read_lines(conn, "order_lines", "order_id", order_id)
        else:
            partner = _get_partner(conn, ctx, _s(body, "partner_id", 64) or None)
            lines = _lines_in(conn, ctx, body.get("lines"),
                              _price_list(conn, ctx, partner["price_list_id"]) if partner and partner["price_list_id"] else None)
        if not partner:
            raise Err(400, "partner_required")
        iid = _insert_invoice(conn, ctx, kind, partner, _party(partner), lines, body, order_id)
        if order_id and kind == "invoice":
            conn.execute("UPDATE orders SET invoice_id=?, updated_at=? WHERE id=?", (iid, _now(), order_id))
            # Money taken against the order before the invoice existed (a shop's
            # prepayment) now counts against the invoice.
            conn.execute("UPDATE payments SET invoice_id=? WHERE order_id=? AND invoice_id IS NULL", (iid, order_id))
        conn.commit()
        return _invoice_out(conn, ctx, _get_invoice(conn, ctx, iid), True)


@endpoint("POST", "/invoices/{iid}/cancel")
def cancel_invoice(ctx: Ctx, q, body, iid):
    """Marks the invoice cancelled; its number stays used. Payments on it are
    kept and move back to the partner's account."""
    ctx.need("invoices", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        inv = _get_invoice(conn, ctx, iid)
        if inv["status"] == "cancelled":
            raise Err(409, "already_cancelled")
        if conn.execute("SELECT 1 FROM invoices WHERE related_id=? AND status='issued'", (iid,)).fetchone():
            raise Err(409, "has_documents")
        conn.execute("UPDATE invoices SET status='cancelled' WHERE id=?", (iid,))
        conn.execute("UPDATE payments SET invoice_id=NULL WHERE invoice_id=?", (iid,))
        conn.execute("UPDATE orders SET invoice_id=NULL WHERE invoice_id=?", (iid,))
        conn.commit()
        return _invoice_out(conn, ctx, _get_invoice(conn, ctx, iid), True)


@endpoint("POST", "/invoices/{iid}/credit")
def credit_invoice(ctx: Ctx, q, body, iid):
    """A credit note for the whole invoice, numbered in the invoice sequence."""
    ctx.need("invoices", 2)
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        inv = _get_invoice(conn, ctx, iid)
        if inv["kind"] != "invoice" or inv["status"] != "issued":
            raise Err(409, "invalid_kind")
        if conn.execute("SELECT 1 FROM invoices WHERE related_id=? AND status='issued'", (iid,)).fetchone():
            raise Err(409, "already_credited")
        lines = _read_lines(conn, "invoice_lines", "invoice_id", iid)
        partner = _get_partner(conn, ctx, inv["partner_id"]) if inv["partner_id"] else None
        body = {**body, "payment_method": inv["payment_method"]}
        cid = _insert_invoice(conn, ctx, "credit_note", partner, json.loads(inv["recipient_json"] or "{}"),
                              lines, body, inv["order_id"], iid)
        conn.commit()
        return _invoice_out(conn, ctx, _get_invoice(conn, ctx, cid), True)


# ── Payments ─────────────────────────────────────────────────────

@endpoint("GET", "/payments")
def list_payments(ctx: Ctx, q, body):
    ctx.need("payments", 1)
    limit, offset = _limit(q, 500, 5000)
    where, args = ["pm.company_id=?"], [ctx.cid]
    for key in ("partner_id", "invoice_id", "order_id"):
        if q.get(key):
            where.append(f"pm.{key}=?")
            args.append(q[key])
    if q.get("from"):
        where.append("pm.pay_date>=?")
        args.append(_date(q["from"], "from"))
    if q.get("to"):
        where.append("pm.pay_date<=?")
        args.append(_date(q["to"], "to"))
    with _db() as conn:
        rows = conn.execute(
            f"SELECT pm.*, p.name AS partner_name, i.number AS invoice_number, o.number AS order_number "
            f"FROM payments pm LEFT JOIN partners p ON p.id=pm.partner_id LEFT JOIN invoices i ON i.id=pm.invoice_id "
            f"LEFT JOIN orders o ON o.id=pm.order_id WHERE {' AND '.join(where)} "
            f"ORDER BY pm.pay_date DESC, pm.created_at DESC LIMIT ? OFFSET ?", (*args, limit, offset)).fetchall()
        total = conn.execute(f"SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE {' AND '.join(where)}",
                             args).fetchone()[0]
    items = []
    for r in rows:
        d = dict(r)
        d.pop("idempotency_key", None)
        items.append(d)
    return {"items": items, "sum": _r(total)}


def add_payment_in(ctx: Ctx, body: dict) -> dict:
    ctx.need("payments", 2)
    amount = _r(_num(body.get("amount"), "amount", None))
    if abs(amount) < 0.005:
        raise Err(400, "invalid_number", field="amount")
    method = body.get("method") if body.get("method") in PAY_METHODS else "bank"
    idem = _s(body, "idempotency_key", 200) or None
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if idem:
            row = conn.execute("SELECT id FROM payments WHERE company_id=? AND idempotency_key=?", (ctx.cid, idem)).fetchone()
            if row:
                conn.rollback()
                return {"id": row["id"]}
        invoice_id = _s(body, "invoice_id", 64) or None
        order_id = _s(body, "order_id", 64) or None
        partner_id = _s(body, "partner_id", 64) or None
        if invoice_id:
            inv = _get_invoice(conn, ctx, invoice_id)
            if inv["status"] != "issued" or inv["kind"] != "invoice":
                raise Err(409, "invalid_kind")
            partner_id = partner_id or inv["partner_id"]
            order_id = order_id or inv["order_id"]
        if order_id:
            o = _get_order(conn, ctx, order_id)
            partner_id = partner_id or o["partner_id"]
            if not invoice_id and o["invoice_id"]:
                inv = conn.execute("SELECT status FROM invoices WHERE id=?", (o["invoice_id"],)).fetchone()
                if inv and inv["status"] == "issued":
                    invoice_id = o["invoice_id"]
        if partner_id:
            _get_partner(conn, ctx, partner_id)
        pid = _id()
        conn.execute(
            "INSERT INTO payments(id,company_id,partner_id,invoice_id,order_id,amount,method,pay_date,reference,note,"
            "idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, ctx.cid, partner_id, invoice_id, order_id, amount, method,
             _date(body.get("pay_date"), "pay_date", _today()), _s(body, "reference", 100), _s(body, "note", 1000),
             idem, ctx.actor, _now()))
        conn.commit()
    return {"id": pid}


@endpoint("POST", "/payments")
def add_payment(ctx: Ctx, q, body):
    return add_payment_in(ctx, body)


@endpoint("DELETE", "/payments/{pmid}")
def delete_payment(ctx: Ctx, q, body, pmid):
    ctx.need("payments", 2)
    with _db() as conn:
        cur = conn.execute("DELETE FROM payments WHERE id=? AND company_id=?", (pmid, ctx.cid))
        conn.commit()
    if not cur.rowcount:
        raise Err(404, "not_found")
    return {"ok": True}


# ── Dashboard & reports ──────────────────────────────────────────

def _receivables(conn, ctx: Ctx) -> dict:
    rows = conn.execute("SELECT * FROM invoices WHERE company_id=? AND kind='invoice' AND status='issued'",
                        (ctx.cid,)).fetchall()
    paid = {r["invoice_id"]: r["s"] for r in conn.execute(
        "SELECT invoice_id, SUM(amount) s FROM payments WHERE company_id=? AND invoice_id IS NOT NULL GROUP BY invoice_id",
        (ctx.cid,))}
    credited = {r["related_id"] for r in conn.execute(
        "SELECT related_id FROM invoices WHERE company_id=? AND kind='credit_note' AND status='issued'", (ctx.cid,))}
    open_total = overdue_total = 0
    open_count = overdue_count = 0
    today = _today()
    for r in rows:
        if r["id"] in credited:
            continue
        rest = r["total"] - (paid.get(r["id"]) or 0)
        if rest > 0.005:
            open_total += rest
            open_count += 1
            if r["due_date"] < today:
                overdue_total += rest
                overdue_count += 1
    return {"open": _r(open_total), "open_count": open_count, "overdue": _r(overdue_total),
            "overdue_count": overdue_count}


def _low_stock(conn, ctx: Ctx, limit: int = 50) -> list:
    rows = conn.execute(
        "SELECT p.id, p.name, p.sku, p.unit, p.min_stock, COALESCE(SUM(s.qty),0) AS on_hand FROM products p "
        "LEFT JOIN stock s ON s.product_id=p.id WHERE p.company_id=? AND p.active=1 AND p.is_service=0 AND p.min_stock>0 "
        "GROUP BY p.id HAVING on_hand <= p.min_stock ORDER BY (on_hand - p.min_stock) LIMIT ?", (ctx.cid, limit)).fetchall()
    return [dict(r) for r in rows]


def _sales(conn, ctx: Ctx, frm: str, to: str) -> dict:
    row = conn.execute(
        "SELECT SUM(CASE WHEN kind='invoice' THEN subtotal ELSE -subtotal END) net, "
        "SUM(CASE WHEN kind='invoice' THEN total ELSE -total END) gross, "
        "SUM(CASE WHEN kind='invoice' THEN 1 ELSE 0 END) cnt FROM invoices "
        "WHERE company_id=? AND status='issued' AND kind IN ('invoice','credit_note') AND issue_date BETWEEN ? AND ?",
        (ctx.cid, frm, to)).fetchone()
    return {"net": _r(row["net"] or 0), "gross": _r(row["gross"] or 0), "count": row["cnt"] or 0}


@endpoint("GET", "/dashboard")
def dashboard(ctx: Ctx, q, body):
    """Only the parts the caller may see; the widget draws what it gets."""
    out = {}
    today = date.today()
    month_start = today.replace(day=1).isoformat()
    with _db() as conn:
        if ctx.can("orders"):
            out["orders"] = {r["status"]: r["c"] for r in conn.execute(
                "SELECT status, COUNT(*) c FROM orders WHERE company_id=? AND status IN ('draft','confirmed') GROUP BY status",
                (ctx.cid,))}
            recent = conn.execute("SELECT * FROM orders WHERE company_id=? ORDER BY created_at DESC LIMIT 8",
                                  (ctx.cid,)).fetchall()
            out["recent_orders"] = [_order_out(conn, ctx, dict(r), False) for r in recent]
        if ctx.can("stock"):
            out["low_stock"] = _low_stock(conn, ctx, 10)
        if ctx.can("invoices"):
            out["receivables"] = _receivables(conn, ctx)
        if ctx.can("reports"):
            out["month_sales"] = _sales(conn, ctx, month_start, today.isoformat())
        if ctx.can("costs") and ctx.can("stock"):
            out["stock_value"] = _r(conn.execute(
                "SELECT COALESCE(SUM(s.qty * p.cost_price),0) FROM stock s JOIN products p ON p.id=s.product_id "
                "WHERE s.company_id=? AND s.qty>0", (ctx.cid,)).fetchone()[0])
    return out


@endpoint("GET", "/reports/summary")
def report_summary(ctx: Ctx, q, body):
    ctx.need("reports", 1)
    today = date.today()
    frm = _date(q.get("from"), "from", today.replace(day=1).isoformat())
    to = _date(q.get("to"), "to", today.isoformat())
    out = {"from": frm, "to": to}
    with _db() as conn:
        out["sales"] = _sales(conn, ctx, frm, to)
        # Twelve months back from the end of the period, one bar each.
        end = date.fromisoformat(to)
        start = (end.replace(day=1) - timedelta(days=335)).replace(day=1)
        rows = conn.execute(
            "SELECT substr(issue_date,1,7) m, SUM(CASE WHEN kind='invoice' THEN subtotal ELSE -subtotal END) net "
            "FROM invoices WHERE company_id=? AND status='issued' AND kind IN ('invoice','credit_note') "
            "AND issue_date BETWEEN ? AND ? GROUP BY m", (ctx.cid, start.isoformat(), to)).fetchall()
        by_month = {r["m"]: _r(r["net"] or 0) for r in rows}
        months = []
        cur = start
        while cur <= end:
            key = cur.strftime("%Y-%m")
            months.append({"month": key, "net": by_month.get(key, 0)})
            cur = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
        out["monthly"] = months
        rows = conn.execute(
            "SELECT l.product_id, l.name, l.unit, SUM(CASE WHEN i.kind='invoice' THEN l.qty ELSE -l.qty END) qty, "
            "SUM(CASE WHEN i.kind='invoice' THEN l.net ELSE -l.net END) net FROM invoice_lines l "
            "JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=? AND i.status='issued' "
            "AND i.kind IN ('invoice','credit_note') AND i.issue_date BETWEEN ? AND ? "
            "GROUP BY COALESCE(l.product_id, l.name) ORDER BY net DESC LIMIT 10", (ctx.cid, frm, to)).fetchall()
        out["top_products"] = [{**dict(r), "qty": _rq(r["qty"] or 0), "net": _r(r["net"] or 0)} for r in rows]
        rows = conn.execute(
            "SELECT i.partner_id, json_extract(i.recipient_json,'$.name') name, "
            "SUM(CASE WHEN i.kind='invoice' THEN i.subtotal ELSE -i.subtotal END) net FROM invoices i "
            "WHERE i.company_id=? AND i.status='issued' AND i.kind IN ('invoice','credit_note') "
            "AND i.issue_date BETWEEN ? AND ? GROUP BY COALESCE(i.partner_id, name) ORDER BY net DESC LIMIT 10",
            (ctx.cid, frm, to)).fetchall()
        out["top_customers"] = [{**dict(r), "net": _r(r["net"] or 0)} for r in rows]
        out["receivables"] = _receivables(conn, ctx)
        paid = conn.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE company_id=? AND pay_date BETWEEN ? AND ?",
                            (ctx.cid, frm, to)).fetchone()[0]
        out["payments_in"] = _r(paid)
        if ctx.can("costs"):
            cogs = conn.execute(
                "SELECT COALESCE(SUM(-qty * unit_cost),0) FROM movements WHERE company_id=? AND kind='sale' "
                "AND created_at>=? AND created_at<?",
                (ctx.cid, frm, (date.fromisoformat(to) + timedelta(days=1)).isoformat())).fetchone()[0]
            out["cogs"] = _r(cogs)
            rows = conn.execute(
                "SELECT w.id, w.name, COALESCE(SUM(CASE WHEN s.qty>0 THEN s.qty * p.cost_price ELSE 0 END),0) value "
                "FROM warehouses w LEFT JOIN stock s ON s.warehouse_id=w.id LEFT JOIN products p ON p.id=s.product_id "
                "WHERE w.company_id=? GROUP BY w.id ORDER BY w.is_default DESC, w.name", (ctx.cid,)).fetchall()
            out["stock_value"] = [{"warehouse_id": r["id"], "name": r["name"], "value": _r(r["value"])} for r in rows]
        out["low_stock"] = _low_stock(conn, ctx, 50)
    return out


# ── Mounting ─────────────────────────────────────────────────────

def _query(request: Request) -> dict:
    return {k: v for k, v in request.query_params.items()}


def _user_route(fn):
    async def route(request: Request):
        try:
            me = _user(request.headers.get("x-pub-token"))
            if not me:
                raise Err(401, "unauthorized")
            params = dict(request.path_params)
            ctx = _member_ctx(me["id"], params.pop("cid"))
            return JSONResponse(fn(ctx, _query(request), await _body(request), **params))
        except Err as e:
            return _error(e)
    return route


def _api_route(fn):
    async def route(request: Request):
        try:
            ctx = _key_ctx(request)
            return JSONResponse(fn(ctx, _query(request), await _body(request), **dict(request.path_params)))
        except Err as e:
            return _error(e)
    return route


@router.get("/api/v1")
async def api_index():
    """The route list, so whoever builds an integration can see what exists
    without a key. Only the shape — no data."""
    return {"app": APP_ID, "version": 1, "auth": "Authorization: Bearer <key>",
            "endpoints": [f"{m} /pub/{APP_ID}/api/v1{p}" for m, p, _f, api in _ENDPOINTS if api]}


def _mount():
    for method, path, fn, api in _ENDPOINTS:
        router.add_api_route("/c/{cid}" + path, _user_route(fn), methods=[method])
        if api:
            router.add_api_route("/api/v1" + path, _api_route(fn), methods=[method])


_mount()
