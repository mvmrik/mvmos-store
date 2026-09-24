"""
Classifieds' app-to-app API — the only way another app (or mvmAI) should
touch Classifieds data. Loaded by Apps Hub via
hub.call_app_api("classifieds", ...) once an admin enables it at Apps Hub ->
Settings -> App APIs. Every action runs the very same _<route>(me, ...)
function api.py's own routes call, reached via
sys.modules["app_public_classifieds"] (api.py is exec'd into that module name
by backend/public_loader.py at startup), so validation, validity periods and
the once-a-day bump limit behave exactly as they do on the Classifieds page.

user_id is always an Apps Hub public_users.id; every action only ever sees
or changes that user's own listings. Photos, messages and VIP promotion stay
on the Classifieds page.

Prices are plain amounts (12.5 means 12.50) in the listing's currency; 0
marks the item as free.

Invalid input raises ValueError with api.py's own short English code (e.g.
bump_wait, category_required); a listing that doesn't exist or belongs to
someone else raises LookupError("not found"). A profile banned from Classifieds
gets ValueError("banned") from anything that publishes.
"""

import sys

from pydantic import ValidationError


def _pub():
    pub = sys.modules.get("app_public_classifieds")
    if pub is None:
        raise RuntimeError("classifieds api.py not loaded")
    return pub


def _call(fn, *args):
    """api.py's helpers answer errors with HTTPException; turn those into the
    exceptions app APIs use."""
    from fastapi import HTTPException
    try:
        return fn(*args)
    except HTTPException as e:
        if e.status_code == 404:
            raise LookupError("not found")
        raise ValueError(str(e.detail))


def _body(pub, **fields):
    try:
        return pub.ListingBody(**fields)
    except ValidationError as e:
        err = e.errors()[0]
        field = ".".join(str(x) for x in err["loc"]).replace("price_cents", "price")
        raise ValueError(f"{field}: {err['msg']}")


def _cents(price):
    try:
        return round(float(price) * 100)
    except (TypeError, ValueError):
        raise ValueError("price must be a number")


def _shape(d):
    """What a caller needs of a listing: the price as an amount and the
    dates it can act on, without the page's internal sort fields."""
    d["price"] = d.pop("price_cents") / 100
    for k in ("sort_at", "last_bump_at", "vip_until", "watched", "owned"):
        d.pop(k, None)
    d["photos"] = len(d.get("photos") or [])
    return d


def _own(pub, user_id, listing_id):
    with pub.db() as c:
        row = _call(pub.own, c, listing_id, {"id": user_id})
        return _shape(pub.output(c, row, {"id": user_id}))


def list_categories(user_id: str):
    """The Classifieds categories (id, name, parent_id) a listing can be put
    in, plus the default currency and how many days a listing stays
    active."""
    pub = _pub()
    with pub.db() as c:
        cfg = pub.settings(c)
        cats = [dict(r) for r in c.execute("SELECT id,name,parent_id FROM categories ORDER BY name COLLATE NOCASE")]
    return {"categories": cats, "currency": cfg["currency"], "currencies": cfg["currencies"],
            "validity_days": cfg["validity_days"]}


def list_my_listings(user_id: str, status: str = "all", search: str = ""):
    """List the user's own listings, newest first. status filters them:
    all, active, expired or inactive (deactivated). Each listing has id,
    title, description, category_id, price, currency, location, contact,
    status, expires_at and bump_available_at (unix seconds), views,
    watchers_count, vip and the number of photos."""
    if status not in ("all", "active", "expired", "inactive"):
        raise ValueError("status must be all, active, expired or inactive")
    pub = _pub()
    me = {"id": user_id}
    items, offset = [], 0
    while True:
        page = _call(pub._listing_list, me, True, False, (search or "").strip()[:160],
                     0, False, 0, None, status, "", offset)
        items += page["items"]
        offset += len(page["items"])
        if not page["items"] or offset >= page["total"]:
            break
    return [_shape(d) for d in items]


def get_listing(user_id: str, listing_id: str):
    """Get one of the user's own listings by id."""
    return _own(_pub(), user_id, listing_id)


def add_listing(user_id: str, title: str, description: str, category_id: int,
                price: float = 0, currency: str = None, location: str = "",
                contact: str = ""):
    """Publish a new listing for the user. category_id comes from
    list_categories; price 0 means free; currency defaults to the
    Classifieds currency. It stays active for the configured validity days.
    Photos can be added on the Classifieds page. Returns the listing."""
    pub = _pub()
    body = _body(pub, title=title or "", description=description or "",
                 category_id=category_id, price_cents=_cents(price),
                 currency=currency or None, location=location or "",
                 contact=contact or "")
    lid = _call(pub._create, {"id": user_id}, body)["id"]
    return _own(pub, user_id, lid)


def update_listing(user_id: str, listing_id: str, title: str = None,
                   description: str = None, category_id: int = None,
                   price: float = None, currency: str = None,
                   location: str = None, contact: str = None):
    """Edit one of the user's listings. Only the fields you pass change.
    Returns the listing."""
    pub = _pub()
    cur = _own(pub, user_id, listing_id)
    body = _body(
        pub,
        title=cur["title"] if title is None else title,
        description=cur["description"] if description is None else description,
        category_id=cur["category_id"] if category_id is None else category_id,
        price_cents=round(cur["price"] * 100) if price is None else _cents(price),
        currency=cur["currency"] if not currency else currency,
        location=cur["location"] if location is None else location,
        contact=cur["contact"] if contact is None else contact,
    )
    _call(pub._edit, {"id": user_id}, listing_id, body)
    return _own(pub, user_id, listing_id)


def bump_listing(user_id: str, listing_id: str):
    """Renew ("bump") one of the user's active listings: moves it back to
    the top of the feed as if just posted. Allowed once every 24 hours per
    listing (bump_available_at tells when); fails with bump_wait before
    that, and with inactive_listing when it is deactivated or expired —
    activate it first. Returns the listing."""
    pub = _pub()
    _call(pub._action, {"id": user_id}, listing_id, "bump")
    return _own(pub, user_id, listing_id)


def activate_listing(user_id: str, listing_id: str):
    """Make one of the user's deactivated or expired listings visible again.
    An expired listing gets a fresh validity period from today. Returns the
    listing."""
    pub = _pub()
    _call(pub._action, {"id": user_id}, listing_id, "activate")
    return _own(pub, user_id, listing_id)


def deactivate_listing(user_id: str, listing_id: str):
    """Hide one of the user's listings from the public feed without deleting
    it; activate_listing brings it back. Returns the listing."""
    pub = _pub()
    _call(pub._action, {"id": user_id}, listing_id, "deactivate")
    return _own(pub, user_id, listing_id)


def delete_listing(user_id: str, listing_id: str):
    """Permanently delete one of the user's listings with its photos.
    Conversations about it keep their messages."""
    return _call(_pub()._delete, {"id": user_id}, listing_id)
