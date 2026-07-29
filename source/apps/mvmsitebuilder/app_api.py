"""Generic widget-registration API for provider applications."""
import sys

def set_site_widgets(user_id: str, source: str, widgets: list):
    premium = sys.modules["backend.premium"].load_premium_backend("mvmsitebuilder")
    if premium is None:
        raise RuntimeError("premium_required")
    return premium.set_site_widgets(user_id, source, widgets)
