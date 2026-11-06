"""
What other apps may ask mvmFonts. Reached only through hub.call_app_api("mvmfonts", ...),
which needs the switch in Apps Hub -> Settings -> App APIs.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import fonts_lib as lib  # noqa: E402

# Browsers load these by URL; nothing here is worth offering to scripts or Automations.
INTERNAL_ONLY = {"list_fonts"}


def list_fonts(user_id=None):
    """Every installed family: {"ranges": {subset: unicode-range}, "families": [{family, category,
    custom, cyrillic, styles: [{style, weight, files: {subset: url}}]}]}. The files are plain
    URLs that need no login, so an @font-face can use them."""
    return lib.catalog()
