"""Generic widget-registration API for provider applications."""
import sys

# source names the calling app, which only an in-process call can vouch for,
# so this is never offered through the External API.
INTERNAL_ONLY = {"set_site_widgets"}

def set_site_widgets(user_id: str, source: str, widgets: list):
    premium = sys.modules["backend.premium"].load_premium_backend("mvmsitebuilder")
    if premium is None:
        raise RuntimeError("premium_required")
    return premium.set_site_widgets(user_id, source, widgets)
