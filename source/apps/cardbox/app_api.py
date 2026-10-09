"""App API for Cardbox. Apps Hub gates this module before invoking actions."""
import sys


def _app():
    app = sys.modules.get("app_public_cardbox")
    if app is None:
        raise RuntimeError("Cardbox is unavailable")
    return app


def list_items(user_id: str, query: str = "", kind: str = "", archived: bool = False):
    """Search the user's cards, codes and contacts. kind: loyalty, discount, voucher, ticket, business or other. Returns item metadata and image presence, never image bytes."""
    return _app().list_items(user_id, query, kind, archived)


def get_item(user_id: str, item_id: str):
    """Get one item belonging to the user, including optional contact details and whether each image exists."""
    return _app().get_item(user_id, item_id)


def record_use(user_id: str, item_id: str):
    """Count one deliberate use of the user's card or code, updating its last-used time and most-used sorting."""
    return _app().record_use(user_id, item_id)


def get_sort_settings(user_id: str):
    """Read the user's general sort order and any category-specific overrides."""
    return _app().get_sort_settings(user_id)


def set_sort_setting(user_id: str, category: str, sort: str):
    """Set a general or category sort. category: all or an item kind. sort: favorites_recent, recent_used, most_used, expires_soon; use inherit to clear a category override."""
    return _app().set_sort_setting(user_id, category, sort)


def create_item(user_id: str, title: str = "", kind: str = "other", issuer: str = "", code: str = "", code_format: str = "none", notes: str = "", tags: str = "", expires_at: str = "", person: str = "", company: str = "", role: str = "", phone: str = "", email: str = "", website: str = "", address: str = ""):
    """Add a card, discount code, voucher, ticket or business card. A business card may have only a photo later; contact fields are optional. code_format: none, qr or code128. expires_at: YYYY-MM-DD."""
    return _app().create_item(user_id, {k: v for k, v in locals().copy().items() if k != "user_id"})


def update_item(user_id: str, item_id: str, title: str = None, kind: str = None, issuer: str = None, code: str = None, code_format: str = None, notes: str = None, tags: str = None, expires_at: str = None, favorite: bool = None, archived: bool = None, person: str = None, company: str = None, role: str = None, phone: str = None, email: str = None, website: str = None, address: str = None):
    """Change only supplied fields of one of the user's items. Use favorite or archived to organize it."""
    data = {k: v for k, v in locals().copy().items() if k not in ("user_id", "item_id") and v is not None}
    return _app().update_item(user_id, item_id, data)


def delete_item(user_id: str, item_id: str):
    """Permanently remove an item and its private images from the user's collection."""
    return _app().delete_item(user_id, item_id)


def attach_image(user_id: str, item_id: str, side: str, image_base64: str):
    """Attach a PNG, JPEG or WebP image to the front or back of an item. image_base64 may be raw base64 or a data URL, up to 5 MB decoded. Useful when an AI reads an uploaded business card and saves the original photo."""
    return _app().set_image_base64(user_id, item_id, side, image_base64)


def get_image(user_id: str, item_id: str, side: str):
    """Read the owner's front or back image as base64 with its MIME type. Call explicitly when an authorized app needs the original card photo."""
    return _app().get_image_base64(user_id, item_id, side)


def remove_image(user_id: str, item_id: str, side: str):
    """Remove the front or back image from the user's item, leaving its details intact."""
    return _app().remove_image(user_id, item_id, side)
