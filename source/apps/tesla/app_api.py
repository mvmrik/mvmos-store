"""Apps Hub visibility hook; not an externally callable app action."""
import importlib.util
import os
import sqlite3
from pathlib import Path

_spec = importlib.util.spec_from_file_location('_tesla_visibility_engine',os.path.join(os.path.dirname(__file__),'engine.py'))
_engine = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_engine)
_spec = importlib.util.spec_from_file_location('_tesla_visibility_sharing',os.path.join(os.path.dirname(__file__),'sharing.py'))
_sharing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sharing)


def _can_access_public(user_id):
    if not user_id:return False
    # Discovery must never initialize or migrate app data. Missing data denies access.
    try:
        c = sqlite3.connect(Path(_engine.DB_PATH).resolve().as_uri() + "?mode=ro", uri=True)
        c.row_factory = sqlite3.Row
        try:
            return _sharing.access(c, user_id) is not None
        finally:
            c.close()
    except sqlite3.Error:
        return False
