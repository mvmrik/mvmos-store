"""
Shopping List's app-to-app API — the only way another app (or mvmAI) should
touch Shopping List data. Loaded by Apps Hub via
hub.call_app_api("shoppinglist", ...) once an admin enables it at Apps Hub ->
Settings -> App APIs. Every action runs the very same _<route>(user_id, ...)
function api.py's own routes call, reached via
sys.modules["app_public_shoppinglist"] (api.py is exec'd into that module
name by backend/public_loader.py at startup), so sharing rules, Budget
deduction and warranties behave exactly as they do in the Shopping List
window.

user_id is always an Apps Hub public_users.id; every action only sees lists
the user owns or was added to, with the same owner-only rules as the window.

Changes are pushed live to every open Shopping List window of the list's
members, just like a change made in the window itself.

Invalid input raises ValueError with api.py's own short English reason; a
list or item that doesn't exist or isn't shared with the user raises
LookupError("not found").
"""

import asyncio
import json
import sys


def _pub():
    pub = sys.modules.get("app_public_shoppinglist")
    if pub is None:
        raise RuntimeError("shoppinglist api.py not loaded")
    return pub


def _run(result):
    """api.py's helpers answer with (JSONResponse, live-update coroutine or
    None). The update is handed to the server's event loop — app APIs are
    called synchronously from inside it — and the response is turned back
    into data, or into the matching exception on an error status."""
    resp, notify = result
    if notify is not None:
        try:
            asyncio.get_running_loop().create_task(notify)
        except RuntimeError:
            # Called from a worker thread: nothing to push through, and
            # open windows still pick the change up on their next reload.
            notify.close()
    data = json.loads(resp.body)
    if resp.status_code == 404:
        raise LookupError(data.get("error") or "not found")
    if resp.status_code >= 400:
        raise ValueError(data.get("error") or "invalid request")
    return data


def _slim_item(d):
    """Drop avatars and photo lists an AI never needs; keep who added and
    who bought the item as a plain name."""
    def name(p):
        return (p or {}).get("display_name") or (p or {}).get("username")
    d["added_by_name"] = name(d.pop("added_by_user", None))
    d["bought_by_name"] = name(d.pop("bought_by_user", None))
    d.pop("warranty_photos", None)
    return d


def _own_item(pub, user_id, item_id):
    with pub._db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not pub._can_access_item(conn, row, user_id):
            raise LookupError("not found")
        return dict(row)


# ── Lists ────────────────────────────────────────────────────────

def list_lists(user_id: str):
    """List the user's shopping lists, their own and those shared with them.
    Each has id, title, role (owner or member), member_count, item_count
    and bought_count."""
    return _run(_pub()._list_lists(user_id))


def add_list(user_id: str, title: str):
    """Create a new shopping list owned by the user. Returns the list."""
    pub = _pub()
    return _run(pub._create_list(user_id, pub.ListBody(title=title or "")))


def rename_list(user_id: str, list_id: str, title: str):
    """Rename one of the user's shopping lists (owner only)."""
    pub = _pub()
    return _run(pub._update_list(user_id, list_id, pub.ListBody(title=title or "")))


def delete_list(user_id: str, list_id: str):
    """Delete one of the user's shopping lists (owner only). Its items are
    not lost: they stay in the user's shopping history with their
    warranties."""
    return _run(_pub()._delete_list(user_id, list_id))


# ── Items ────────────────────────────────────────────────────────

def list_items(user_id: str, list_id: str):
    """List the items of a shopping list, still to buy first. Each item has
    id, name, quantity, price, category_id (Budget category), bought_at
    (set when bought), added_by_name and bought_by_name."""
    return [_slim_item(d) for d in _run(_pub()._list_items(user_id, list_id))]


def add_item(user_id: str, list_id: str, name: str, quantity: float = 1,
             price: float = None, category_id: str = None):
    """Add an item to a shopping list. quantity defaults to 1; price is the
    price of one unit; category_id is a Budget category id
    (from list_budget_categories) that the price is taken from when the item
    is marked bought. Returns the item."""
    pub = _pub()
    body = pub.ItemBody(name=name or "", quantity=1 if quantity is None else quantity,
                        price=price, category_id=category_id or None)
    return _slim_item(_run(pub._add_item(user_id, list_id, body)))


def update_item(user_id: str, item_id: str, name: str = None,
                quantity: float = None, price: float = None,
                category_id: str = None):
    """Edit an item that is not bought yet. Only the fields you pass change;
    pass an empty category_id to stop its Budget deduction. Returns the
    item."""
    pub = _pub()
    cur = _own_item(pub, user_id, item_id)
    body = pub.ItemBody(
        name=cur["name"] if name is None else name,
        quantity=cur["quantity"] if quantity is None else quantity,
        price=cur["price"] if price is None else price,
        category_id=cur["category_id"] if category_id is None else (category_id or None),
    )
    return _slim_item(_run(pub._update_item(user_id, item_id, body)))


def delete_item(user_id: str, item_id: str):
    """Remove an item from its shopping list, with its warranty and photos."""
    return _run(_pub()._delete_item(user_id, item_id))


def mark_item_bought(user_id: str, item_id: str):
    """Mark an item as bought. When it has a price and a Budget category,
    price times quantity is deducted from that category. Returns the item."""
    return _slim_item(_run(_pub()._buy_item(user_id, item_id)))


def unmark_item_bought(user_id: str, item_id: str):
    """Put a bought item back on the list as still to buy, returning any
    Budget deduction it made. Returns the item."""
    return _slim_item(_run(_pub()._unbuy_item(user_id, item_id)))


def list_history(user_id: str):
    """Items the user added to shopping lists that were deleted since, with
    the deleted list's title in list_title_snapshot."""
    return [_slim_item(d) for d in _run(_pub()._list_history(user_id))]


def list_budget_categories(user_id: str):
    """The user's Budget categories (id, title) an item's price can be
    deducted from. available is false when Budget isn't installed or its API
    is off."""
    hub = sys.modules.get("backend.apphub")
    if hub is None:
        return {"available": False, "categories": []}
    try:
        cats = hub.call_app_api("budget", "list_categories", user_id)
    except Exception:
        return {"available": False, "categories": []}
    return {"available": True, "categories": [{"id": c.get("id"), "title": c.get("title")} for c in cats]}
