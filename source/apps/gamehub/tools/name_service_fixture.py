"""An isolated catalogue for game tests; never reads or writes installation data."""
import importlib.util
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location('test_name_catalogue', ROOT / 'backend/apps/gamehub/names.py')
catalogue = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(catalogue)
_scratch = tempfile.TemporaryDirectory(prefix='gamehub-name-consumers-')


def connect():
    conn = sqlite3.connect(Path(_scratch.name) / 'names.db')
    conn.row_factory = sqlite3.Row
    return conn


def generate_names(**kwargs):
    with connect() as conn:
        return catalogue.generate(conn, **kwargs)


def name_catalogue():
    with connect() as conn:
        return catalogue.catalogue(conn)


def install():
    hub = SimpleNamespace(generate_names=generate_names, name_catalogue=name_catalogue,
                          name_country=catalogue.country_for_language, name_display_rules=catalogue.display_rules)
    sys.modules['app_backend_gamehub'] = hub
    return hub
