"""
Theme registry for mvmSiteBuilder. A theme is a folder under
apps/mvmsitebuilder/public/themes/<theme_id>/ containing:
  theme.json           name/description/author
  style.css            free-form CSS, no fixed class contract
  templates/page.html  full HTML document for rendering one page, using
                        {{tag}} placeholders (see README.md next to
                        _THEMES_DIR, i.e. apps/mvmsitebuilder/public/themes/
                        README.md, for the full list and rules)

Adding a new theme means dropping in a new folder — no code change. A
theme owns its entire document: header, nav markup, footer, mobile
behaviour, layout — public.py only fills in {{tag}} placeholders and
never dictates HTML structure. Future content types (e.g. a products
module) would add their own templates/<name>.html contract the same way,
without touching this file's logic.
"""

import json
import os
import re
import shutil
import tempfile
import zipfile

_THEMES_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "mvmsitebuilder", "public", "themes")

_THEME_ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")
_RESERVED_THEME_IDS = {"default"}
_MAX_ZIP_UNCOMPRESSED = 8 * 1024 * 1024
_MAX_ZIP_FILES = 300


def list_themes() -> list:
    themes = []
    if not os.path.isdir(_THEMES_DIR):
        return themes
    for theme_id in sorted(os.listdir(_THEMES_DIR)):
        if not theme_exists(theme_id):
            continue
        meta_path = os.path.join(_THEMES_DIR, theme_id, "theme.json")
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError):
            meta = {}
        themes.append({
            "id": theme_id,
            "name": meta.get("name", theme_id),
            "description": meta.get("description", ""),
            "author": meta.get("author", ""),
        })
    return themes


def theme_exists(theme_id: str) -> bool:
    if not theme_id or "/" in theme_id or ".." in theme_id:
        return False
    theme_dir = os.path.join(_THEMES_DIR, theme_id)
    return (
        os.path.isfile(os.path.join(theme_dir, "theme.json"))
        and os.path.isfile(os.path.join(theme_dir, "style.css"))
        and os.path.isfile(os.path.join(theme_dir, "templates", "page.html"))
    )


def theme_css_path(theme_id: str) -> str:
    return os.path.join(_THEMES_DIR, theme_id, "style.css")


def theme_template_path(theme_id: str, name: str = "page") -> str:
    if not name or "/" in name or ".." in name:
        name = "page"
    return os.path.join(_THEMES_DIR, theme_id, "templates", f"{name}.html")


def _read_meta(theme_id: str) -> dict:
    meta_path = os.path.join(_THEMES_DIR, theme_id, "theme.json")
    try:
        with open(meta_path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def theme_owner(theme_id: str) -> str:
    """Uploader's Apps Hub user id, or '' for bundled/core themes (e.g. default)."""
    return _read_meta(theme_id).get("_owner_id", "")


def _safe_extract(zip_path: str, dest_dir: str) -> None:
    with zipfile.ZipFile(zip_path) as zf:
        infos = zf.infolist()
        if len(infos) > _MAX_ZIP_FILES:
            raise ValueError("Zip has too many files")
        total = 0
        for info in infos:
            name = info.filename
            norm = os.path.normpath(name)
            if norm.startswith("..") or os.path.isabs(name) or norm.startswith(os.sep):
                raise ValueError("Zip contains an unsafe path")
            total += info.file_size
            if total > _MAX_ZIP_UNCOMPRESSED:
                raise ValueError("Zip is too large uncompressed")
        zf.extractall(dest_dir)


def _find_theme_root(extracted_dir: str) -> str:
    """Zip may contain the theme files at its root, or nested one folder
    deep (common when a folder is zipped via a GUI tool). Accept either."""
    def has_required(d: str) -> bool:
        return (
            os.path.isfile(os.path.join(d, "style.css"))
            and os.path.isfile(os.path.join(d, "templates", "page.html"))
        )

    if has_required(extracted_dir):
        return extracted_dir

    entries = [e for e in os.listdir(extracted_dir) if not e.startswith("__MACOSX")]
    if len(entries) == 1:
        nested = os.path.join(extracted_dir, entries[0])
        if os.path.isdir(nested) and has_required(nested):
            return nested

    raise ValueError("Zip must contain style.css and templates/page.html")


def install_theme_from_zip(theme_id: str, zip_path: str, owner_id: str) -> dict:
    """Validate + install an uploaded theme zip as apps/mvmsitebuilder/public/
    themes/<theme_id>/. Raises ValueError on a malformed upload, PermissionError
    if theme_id is reserved or already owned by someone else."""
    if not _THEME_ID_RE.match(theme_id or ""):
        raise ValueError("Theme id must be 1-40 characters, lowercase letters/digits/hyphens only")
    if theme_id in _RESERVED_THEME_IDS:
        raise PermissionError("This theme id is reserved")
    if os.path.isdir(os.path.join(_THEMES_DIR, theme_id)) and theme_owner(theme_id) != owner_id:
        raise PermissionError("This theme id is already taken by another user")

    work_dir = tempfile.mkdtemp(prefix="msb-theme-")
    try:
        _safe_extract(zip_path, work_dir)
        theme_root = _find_theme_root(work_dir)

        meta = {}
        meta_path = os.path.join(theme_root, "theme.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, encoding="utf-8") as f:
                    meta = json.load(f)
            except (OSError, json.JSONDecodeError):
                meta = {}
        meta.setdefault("name", theme_id)
        meta.setdefault("description", "")
        meta.setdefault("author", "")
        meta["_owner_id"] = owner_id
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f)

        os.makedirs(_THEMES_DIR, exist_ok=True)
        target_dir = os.path.join(_THEMES_DIR, theme_id)
        if os.path.isdir(target_dir):
            shutil.rmtree(target_dir)
        shutil.move(theme_root, target_dir)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    if not theme_exists(theme_id):
        raise ValueError("Uploaded theme is missing required files")

    return {"id": theme_id, "name": meta.get("name", theme_id),
            "description": meta.get("description", ""), "author": meta.get("author", "")}
