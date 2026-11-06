"""
Shared by api.py and app_api.py: the fonts that come with the app (fonts/catalog.json
and fonts/files/*.woff2) plus the ones an administrator uploaded (storage/custom/).
"""

import json
import os
import re

_DIR = os.path.dirname(__file__)
# The Store installer puts every folder it does not know under public/, so an
# installed copy keeps the bundled fonts in public/fonts; a source checkout has
# them next to this file.
BUNDLED_DIR = next((d for d in (os.path.join(_DIR, "public", "fonts"), os.path.join(_DIR, "fonts"))
                    if os.path.isfile(os.path.join(d, "catalog.json"))), os.path.join(_DIR, "fonts"))
CUSTOM_DIR = os.path.join(_DIR, "storage", "custom")
CUSTOM_INDEX = os.path.join(CUSTOM_DIR, "index.json")

FILE_URL = "/pub/mvmfonts/file/"
BUNDLED_RE = re.compile(r"^[a-f0-9]{16}\.woff2$")
CUSTOM_RE = re.compile(r"^c[a-f0-9]{16}\.(woff2|woff|ttf|otf)$")
CATEGORIES = ("sans", "serif", "mono", "display")


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def bundled():
    return _read(os.path.join(BUNDLED_DIR, "catalog.json"), {"ranges": {}, "families": []})


def custom_items():
    items = _read(CUSTOM_INDEX, [])
    return items if isinstance(items, list) else []


def save_custom(items):
    os.makedirs(CUSTOM_DIR, exist_ok=True)
    tmp = CUSTOM_INDEX + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)
    os.replace(tmp, CUSTOM_INDEX)


def file_path(name):
    """Absolute path of a served font file, or None for anything that is not one of ours."""
    if BUNDLED_RE.match(name or ""):
        path = os.path.join(BUNDLED_DIR, "files", name)
    elif CUSTOM_RE.match(name or ""):
        path = os.path.join(CUSTOM_DIR, name)
    else:
        return None
    return path if os.path.isfile(path) else None


def catalog():
    """Every installed family with ready-to-use URLs: {"ranges": {...}, "families": [...]}."""
    base = bundled()
    families = []
    for fam in base.get("families", []):
        families.append({
            "family": fam["family"],
            "category": fam["category"],
            "license": fam.get("license", ""),
            "custom": False,
            "cyrillic": True,
            "styles": [
                {"style": s["style"], "weight": s["weight"],
                 "files": {sub: FILE_URL + name for sub, name in s["files"].items()}}
                for s in fam["styles"]
            ],
        })
    by_name = {}
    for it in custom_items():
        fam = by_name.get(it["family"])
        if fam is None:
            fam = by_name[it["family"]] = {
                "family": it["family"], "category": it.get("category") or "sans",
                "license": "", "custom": True, "cyrillic": None, "styles": [],
            }
            families.append(fam)
        fam["styles"].append({
            "id": it["id"], "style": it["style"], "weight": str(it["weight"]),
            "files": {"all": FILE_URL + it["file"]},
        })
    families.sort(key=lambda f: f["family"].lower())
    ranges = dict(base.get("ranges", {}))
    ranges["all"] = "U+0-10FFFF"
    return {"ranges": ranges, "families": families}
