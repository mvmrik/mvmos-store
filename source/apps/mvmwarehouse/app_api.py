"""
mvmWarehouse's app-to-app API — how another mvmOS app (an online shop built
with mvmSiteBuilder, for example) reads the catalogue and stock or places
orders and payments. Loaded by Apps Hub via hub.call_app_api("mvmwarehouse",
...) once an admin enables it at Apps Hub -> Settings -> App APIs.

Every function acts for an Apps Hub user (user_id) on one of that user's
companies (company_id) and runs the very same service functions as the HTTP
routes in api.py, with that member's permissions — an app can never do more
than the person it acts for could do in the window. Errors are ValueError
with the same code the HTTP API returns (e.g. "insufficient_stock").
"""

import sys


def _pub():
    pub = sys.modules.get("app_public_mvmwarehouse")
    if pub is None:
        raise RuntimeError("mvmwarehouse api.py not loaded")
    return pub


def _run(user_id: str, company_id: str, fn, q=None, body=None, **params):
    pub = _pub()
    try:
        ctx = pub._member_ctx(user_id, company_id)
        ctx.via = "app"
        return fn(ctx, q or {}, body or {}, **params)
    except pub.Err as e:
        raise ValueError(e.code) from None


def list_companies(user_id: str):
    """Companies the user belongs to, each with id, name, currency, role and
    the user's permissions per area (0 none, 1 view, 2 edit)."""
    return _pub()._companies_for(user_id)


def get_company(user_id: str, company_id: str):
    """The company's details, the user's permissions, its warehouses,
    price lists and categories."""
    pub = _pub()
    return _run(user_id, company_id, pub.company_info)


def list_products(user_id: str, company_id: str, q: str = "", category_id: str = "",
                  warehouse_id: str = "", price_list_id: str = "", updated_since: str = "",
                  online_only: bool = False, limit: int = 500, offset: int = 0):
    """Active products matching q (name, SKU or barcode). Each carries its
    photo URLs (images), web_description and online (marked for showing in
    an online shop; online_only=True returns only those). With stock rights
    each carries on_hand, reserved and available; with price_list_id also
    list_price (without VAT). updated_since (ISO time) returns only products
    changed since then."""
    pub = _pub()
    query = {"q": q, "category_id": category_id, "warehouse_id": warehouse_id,
             "price_list_id": price_list_id, "updated_since": updated_since,
             "online": "1" if online_only else "",
             "limit": str(limit), "offset": str(offset)}
    return _run(user_id, company_id, pub.list_products, {k: v for k, v in query.items() if v})


def get_product(user_id: str, company_id: str, product_id: str):
    """One product with stock per warehouse and its price on every active
    price list."""
    pub = _pub()
    return _run(user_id, company_id, pub.get_product, pid=product_id)


def get_stock(user_id: str, company_id: str, product_id: str = "", warehouse_id: str = ""):
    """Stock rows (product, warehouse, on_hand, reserved, available),
    optionally for one product and/or one warehouse."""
    pub = _pub()
    query = {k: v for k, v in {"product_id": product_id, "warehouse_id": warehouse_id}.items() if v}
    return _run(user_id, company_id, pub.stock_levels, query)["items"]


def get_price(user_id: str, company_id: str, product_id: str, price_list_id: str = ""):
    """A product's price without VAT on a price list (or its base price),
    with its VAT rate and the price with VAT."""
    pub = _pub()

    def _price(ctx, q, body):
        if not (ctx.can("catalog") or ctx.can("orders") or ctx.can("pricelists")):
            raise pub.Err(403, "forbidden")
        with pub._db() as conn:
            p = pub._get_product(conn, ctx, product_id)
            pl = pub._price_list(conn, ctx, price_list_id or None)
            price = pub._list_price(conn, p, pl)
        vat = p["vat_rate"] if ctx.company["vat_registered"] else 0
        return {"product_id": p["id"], "price": price, "vat_rate": vat,
                "price_with_vat": pub._r(price * (1 + vat / 100)), "currency": ctx.company["currency"]}

    return _run(user_id, company_id, _price)


def create_order(user_id: str, company_id: str, lines: list, partner_id: str = "",
                 customer: dict = None, warehouse_id: str = "", price_list_id: str = "",
                 ship_to: str = "", note: str = "", confirm: bool = False,
                 source: str = "app", external_ref: str = "", idempotency_key: str = ""):
    """Create an order. lines: [{product_id, qty, unit_price?, discount?}] or
    free lines [{name, qty, unit_price, vat_rate?}]. The customer is
    partner_id, or customer={name, email, phone, address, city, country, ...}
    which is matched to an existing partner by e-mail or created. confirm=True
    reserves the goods at once and fails with "insufficient_stock" when they
    are not available. source/external_ref identify the order on the caller's
    side (e.g. "shop" and the shop's order number). Safe to retry with the
    same idempotency_key — the first order is returned instead of a second."""
    pub = _pub()
    body = {"lines": lines, "ship_to": ship_to, "note": note, "external_ref": external_ref,
            "idempotency_key": idempotency_key}
    if partner_id:
        body["partner_id"] = partner_id
    if customer:
        body["customer"] = customer
    if warehouse_id:
        body["warehouse_id"] = warehouse_id
    if price_list_id:
        body["price_list_id"] = price_list_id
    if confirm:
        body["status"] = "confirmed"
    src = (source or "app").strip()[:30] or "app"
    return _run(user_id, company_id, lambda ctx, q, b: pub.create_order_in(ctx, b, src), body=body)


def get_order(user_id: str, company_id: str, order_id: str):
    """An order with its lines, status, totals, what has been paid and the
    invoice number once invoiced."""
    pub = _pub()
    return _run(user_id, company_id, pub.get_order, oid=order_id)


def find_orders(user_id: str, company_id: str, external_ref: str = "", source: str = "",
                status: str = "", limit: int = 100):
    """Orders by the caller's own reference and/or source and/or status
    (draft, confirmed, shipped, cancelled, open)."""
    pub = _pub()
    query = {k: v for k, v in {"external_ref": external_ref, "source": source, "status": status,
                               "limit": str(limit)}.items() if v}
    return _run(user_id, company_id, pub.list_orders, query)["items"]


def set_order_status(user_id: str, company_id: str, order_id: str, status: str):
    """Move an order to confirmed, shipped (issues its stock; needs stock
    edit rights), cancelled or back to draft."""
    pub = _pub()
    if status not in pub.ORDER_STATES:
        raise ValueError("invalid_status")
    return _run(user_id, company_id, lambda ctx, q, b: pub.set_order_status_in(ctx, order_id, status))


def add_payment(user_id: str, company_id: str, amount: float, order_id: str = "",
                invoice_id: str = "", partner_id: str = "", method: str = "card",
                pay_date: str = "", reference: str = "", idempotency_key: str = ""):
    """Record money received against an order, an invoice or a partner.
    method is cash, bank, card, cod or other. Safe to retry with the same
    idempotency_key."""
    pub = _pub()
    body = {"amount": amount, "order_id": order_id, "invoice_id": invoice_id, "partner_id": partner_id,
            "method": method, "pay_date": pay_date, "reference": reference,
            "idempotency_key": idempotency_key}
    return _run(user_id, company_id, lambda ctx, q, b: pub.add_payment_in(ctx, b), body=body)


def create_invoice(user_id: str, company_id: str, order_id: str, kind: str = "invoice"):
    """Issue an invoice (or proforma with kind="proforma") for an order.
    Payments already recorded against the order count against it."""
    pub = _pub()
    return _run(user_id, company_id, pub.create_invoice, body={"order_id": order_id, "kind": kind})
