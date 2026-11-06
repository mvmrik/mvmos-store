"""
mvmOS mvmFonts — a shelf of free fonts with Latin and Cyrillic, for the apps that write.

Mounted at /pub/mvmfonts (font files, open: a browser cannot send a header when it
loads an @font-face) and at /api/apps/mvmfonts (the desktop window).

The bundled fonts come from Google Fonts under their own open licences (see
LICENSES.md) and are kept as woff2 subsets of Latin, Latin Extended and Cyrillic.
An administrator can add fonts of their own; they live in storage/custom/.
"""

import os
import sys
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

try:
    from . import fonts_lib as lib
except ImportError:  # loaded by exec from public_loader
    sys.path.insert(0, os.path.dirname(__file__))
    import fonts_lib as lib

router = APIRouter()
desktop_router = APIRouter()

MAX_BYTES = 6 * 1024 * 1024
MAX_CUSTOM = 300
_MAGIC = {b"wOF2": "woff2", b"wOFF": "woff", b"OTTO": "otf", b"\x00\x01\x00\x00": "ttf", b"true": "ttf"}


def _session(session):
    if not session or not session.get("effective_user"):
        raise HTTPException(401, "Desktop session required")
    return session


def _admin(session):
    _session(session)
    if session.get("effective_user") != "root":
        raise HTTPException(403, "admin_only")
    return session


@router.get("/file/{name}")
async def font_file(name: str):
    path = lib.file_path(name)
    if not path:
        raise HTTPException(404, "not_found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable",
                                       "Access-Control-Allow-Origin": "*"})


@router.get("/client.js")
async def client_js():
    """The small script other apps load to use these fonts (see public/client.js)."""
    return FileResponse(os.path.join(os.path.dirname(__file__), "public", "client.js"),
                        media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@desktop_router.get("/catalog")
async def catalog(session=Depends(sys.modules["backend.auth"].get_current_session)):
    _session(session)
    data = lib.catalog()
    data["admin"] = session.get("effective_user") == "root"
    return data


@desktop_router.post("/custom")
async def upload(request: Request, family: str, weight: int = 400, italic: bool = False,
                 category: str = "sans",
                 session=Depends(sys.modules["backend.auth"].get_current_session)):
    _admin(session)
    family = " ".join((family or "").split())[:60]
    if not family or any(c in family for c in "<>\"'{};\\/"):
        return JSONResponse({"error": "bad_family"}, status_code=400)
    if category not in lib.CATEGORIES:
        category = "sans"
    weight = min(900, max(100, int(weight)))
    data = await request.body()
    if len(data) > MAX_BYTES:
        return JSONResponse({"error": "too_big"}, status_code=413)
    ext = _MAGIC.get(data[:4])
    if not ext:
        return JSONResponse({"error": "bad_font"}, status_code=400)
    items = lib.custom_items()
    if len(items) >= MAX_CUSTOM:
        return JSONResponse({"error": "too_many"}, status_code=400)
    style = "italic" if italic else "normal"
    # Same family, weight and style replaces the earlier file.
    for it in [i for i in items if i["family"].lower() == family.lower() and i["weight"] == weight and i["style"] == style]:
        try:
            os.remove(os.path.join(lib.CUSTOM_DIR, it["file"]))
        except OSError:
            pass
        items.remove(it)
    ident = uuid.uuid4().hex[:16]
    name = f"c{ident}.{ext}"
    os.makedirs(lib.CUSTOM_DIR, exist_ok=True)
    with open(os.path.join(lib.CUSTOM_DIR, name), "wb") as f:
        f.write(data)
    items.append({"id": ident, "family": family, "weight": weight, "style": style,
                  "category": category, "file": name})
    lib.save_custom(items)
    return {"ok": True, "id": ident}


@desktop_router.delete("/custom/{ident}")
async def delete(ident: str, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _admin(session)
    items = lib.custom_items()
    hit = next((i for i in items if i["id"] == ident), None)
    if not hit:
        raise HTTPException(404, "not_found")
    try:
        os.remove(os.path.join(lib.CUSTOM_DIR, hit["file"]))
    except OSError:
        pass
    items.remove(hit)
    lib.save_custom(items)
    return {"ok": True}
