"""Isolated Game Hub catalogue service for Racelandia's standalone tests."""
import importlib.util
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
_scratch = tempfile.TemporaryDirectory(prefix='racelandia-name-service-')
_spec = importlib.util.spec_from_file_location('fixture_gamehub_names', ROOT / 'backend/apps/gamehub/names.py')
catalogue = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(catalogue)


def connect():
    conn = sqlite3.connect(Path(_scratch.name) / 'names.db')
    conn.row_factory = sqlite3.Row
    return conn


def generate_names(**kwargs):
    with connect() as conn:
        return catalogue.generate(conn, **kwargs)


def install():
    sys.modules['app_backend_gamehub'] = SimpleNamespace(generate_names=generate_names, name_display_rules=catalogue.display_rules)
