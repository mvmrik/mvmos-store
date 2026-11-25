"""
Road to a Million: the owner's question manager (desktop only).

The questions live in the app's own database (bank.py); the files in public/q/
are the seed that travels with the app and is imported on every installation
after an update. This router lets the administrator browse the bank, edit a
question, add one by hand and write the bank back into the seed files
(export), which is what gets committed. A question is never deleted: ids are
permanent, so it is hidden with `retired` instead.

Mounted at /api/apps/roadtomillion with a desktop session; changing anything
needs the administrator, like any other system-wide action. The game server
re-reads the bank whenever a new room starts, so a saved change reaches the
next game without a restart.
"""
import importlib.util
import os
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_bank():
    mod = sys.modules.get("roadtomillion_bank")
    if mod is None:
        spec = importlib.util.spec_from_file_location("roadtomillion_bank", os.path.join(HERE, "bank.py"))
        mod = importlib.util.module_from_spec(spec)
        sys.modules["roadtomillion_bank"] = mod
        spec.loader.exec_module(mod)
    return mod


bank = _load_bank()
LANGS = bank.LANGS


def _load_ai():
    mod = sys.modules.get("roadtomillion_ai")
    if mod is None:
        spec = importlib.util.spec_from_file_location("roadtomillion_ai", os.path.join(HERE, "ai.py"))
        mod = importlib.util.module_from_spec(spec)
        sys.modules["roadtomillion_ai"] = mod
        spec.loader.exec_module(mod)
    return mod


ai = _load_ai()


def _session(request: Request):
    return sys.modules["backend.auth"].get_current_session(request)


def _admin(request: Request, session=Depends(_session)):
    return sys.modules["backend.auth"].ensure_admin(session, request)


desktop_router = APIRouter(dependencies=[Depends(_session)])


class Text(BaseModel):
    q: str = ""
    a: list[str] = []


class Question(BaseModel):
    c: str
    d: int
    retired: bool = False
    changeable: bool = False
    k: list[int] | None = None
    s: list[int] | None = None
    dc: dict[str, int] | None = None      # optional difficulty of single countries
    texts: dict[str, Text]


def _validate(head, body: Question):
    if body.c not in head["cats"]:
        raise HTTPException(400, "bad_category")
    if not 1 <= body.d <= 20:
        raise HTTPException(400, "bad_level")
    k, s = body.k, body.s
    if k is not None and (len(k) != len(head["countries"]) or any(not 0 <= v <= 100 for v in k)):
        raise HTTPException(400, "bad_chances")
    if s is not None and (len(s) != len(head["professions"]) or any(not 0 <= v <= 100 for v in s)):
        raise HTTPException(400, "bad_chances")
    if body.dc is not None and any(c not in head["countries"] or not 1 <= v <= 20 for c, v in body.dc.items()):
        raise HTTPException(400, "bad_difficulty")
    texts = {}
    for lang, t in body.texts.items():
        if lang not in LANGS:
            raise HTTPException(400, "bad_language")
        q = t.q.strip()
        a = [x.strip() for x in t.a]
        if not q and not any(a):
            continue                      # this language is left empty
        if not q or len(a) != 4 or any(not x for x in a) or len(set(a)) != 4:
            raise HTTPException(400, "bad_text:" + lang)
        if len(q) > 400 or any(len(x) > 160 for x in a):
            raise HTTPException(400, "too_long:" + lang)
        texts[lang] = {"q": q, "a": a}
    if "en" not in texts:
        raise HTTPException(400, "english_required")
    return texts


@desktop_router.get("/questions")
def questions(cat: str = "", level: int = 0, q: str = "", lang: str = "en", incomplete: bool = False,
              offset: int = 0, limit: int = 100, pending: bool = False, changeable: bool = False):
    out = bank.listing(cat, level, q.strip(), lang if lang in LANGS else "en", incomplete,
                       max(0, offset), max(1, min(limit, 500)), pending, changeable)
    out.update(bank.header())
    out["langs"] = LANGS
    return out


@desktop_router.get("/questions/{qid}")
def one_question(qid: str):
    row = bank.get(qid)
    if not row:
        raise HTTPException(404, "not_found")
    return row


def _save(qid, body: Question):
    texts = _validate(bank.header(), body)
    head = bank.header()
    k = body.k if body.k is not None else ([90] * len(head["countries"]) if qid is None else None)
    s = body.s if body.s is not None else ([90] * len(head["professions"]) if qid is None else None)
    new_id = bank.save(qid, body.c, body.d, k, s, body.retired, texts, body.dc, body.changeable)
    if new_id is None:
        raise HTTPException(404, "not_found")
    return {"id": new_id}


@desktop_router.post("/questions", dependencies=[Depends(_admin)])
def add_question(body: Question):
    return _save(None, body)


@desktop_router.put("/questions/{qid}", dependencies=[Depends(_admin)])
def edit_question(qid: str, body: Question):
    return _save(qid, body)


@desktop_router.post("/export", dependencies=[Depends(_admin)])
def export_bank():
    return bank.export()


# ── AI helper (admin only; see ai.py) ────────────────────────────────────────

class Draft(BaseModel):
    changeable: bool = False
    c: str = ""
    d: int = 0
    k: list[int] | None = None
    s: list[int] | None = None
    dc: dict[str, int] | None = None
    texts: dict[str, Text] = {}


class FillBody(BaseModel):
    lang: str = "en"                      # language of the notes
    question: Draft
    instruction: str = Field(default="", max_length=4000)


class SuggestBody(BaseModel):
    lang: str = "en"                      # language of the notes
    write_lang: str = "en"                # language the questions are written in
    cat: str = ""
    count: int = 10
    text: str = ""


class FinishBody(BaseModel):
    lang: str = "en"
    items: list[Draft]


class ImportText(BaseModel):
    text: str


class RepairImport(BaseModel):
    text: str


class ImportItems(BaseModel):
    items: list[Draft]


def _ready(request: Request):
    token = request.headers.get("x-pub-token")
    st = ai.status(token)
    if not st["available"]:
        raise HTTPException(503 if st["reason"] != "login_required" else 401, st["reason"])
    return ai.asker(token)


def _ui(lang):
    return lang if lang in LANGS else "en"


def _as_raw(d: Draft):
    raw = {"changeable": d.changeable, "c": d.c, "d": d.d, "texts": {l: {"q": t.q, "a": t.a} for l, t in d.texts.items()}}
    if d.k is not None:
        raw["k"] = d.k
    if d.s is not None:
        raw["s"] = d.s
    if d.dc is not None:
        raw["dc"] = d.dc
    return raw


@desktop_router.get("/ai/status", dependencies=[Depends(_admin)])
def ai_status(request: Request):
    return ai.status(request.headers.get("x-pub-token"))


@desktop_router.get("/ai/job/{jid}", dependencies=[Depends(_admin)])
def ai_job(jid: str):
    st = ai.job_state(jid)
    if st is None:
        raise HTTPException(404, "not_found")
    return st


@desktop_router.post("/ai/fill", dependencies=[Depends(_admin)])
def ai_fill(request: Request, body: FillBody):
    user, head = _ready(request), bank.header()
    raw, ui = _as_raw(body.question), _ui(body.lang)
    return {"job": ai.start_job(lambda job: ai.fill(head, LANGS, user, raw, ui, body.instruction.strip()))}


@desktop_router.post("/ai/suggest", dependencies=[Depends(_admin)])
def ai_suggest(request: Request, body: SuggestBody):
    user, head = _ready(request), bank.header()
    if body.cat and body.cat not in head["cats"]:
        raise HTTPException(400, "bad_category")
    wl, ui, count = (body.write_lang if body.write_lang in LANGS else "en"), _ui(body.lang), max(1, min(body.count, ai.MAX_COUNT))
    return {"job": ai.start_job(lambda job: ai.suggest(head, LANGS, user, body.cat, wl, count, body.text, ui, job, bank))}


@desktop_router.post("/ai/finish", dependencies=[Depends(_admin)])
def ai_finish(request: Request, body: FinishBody):
    user, head = _ready(request), bank.header()
    if len(body.items) > ai.MAX_COUNT:
        raise HTTPException(400, "too_many_items")
    drafts, ui = [_as_raw(d) for d in body.items], _ui(body.lang)
    if not drafts:
        raise HTTPException(400, "empty")
    return {"job": ai.start_job(lambda job: ai.finish(head, LANGS, user, drafts, ui, job, bank))}


@desktop_router.post("/ai/review", dependencies=[Depends(_admin)])
def ai_review(request: Request, body: FinishBody):
    user, head = _ready(request), bank.header()
    if len(body.items) > 100:
        raise HTTPException(400, "too_many_items")
    drafts, ui = [_as_raw(d) for d in body.items], _ui(body.lang)
    if not drafts:
        raise HTTPException(400, "empty")
    return {"job": ai.start_job(lambda job: ai.review(head, LANGS, user, drafts, ui, job, bank))}


# ── Import of questions written by another AI ────────────────────────────────

@desktop_router.get("/import/template", dependencies=[Depends(_admin)])
def import_template(count: int = 10, topic: str = ""):
    return {"text": ai.template(bank.header(), count, topic)}


@desktop_router.post("/import/parse", dependencies=[Depends(_admin)])
def import_parse(body: ImportText):
    try:
        return {"items": ai.parse_import(bank.header(), LANGS, body.text[:600000], bank)}
    except Exception:
        raise HTTPException(400, "bad_import")


@desktop_router.post("/import/repair", dependencies=[Depends(_admin)])
def import_repair(request: Request, body: RepairImport):
    if not body.text.strip():
        raise HTTPException(400, "empty")
    if len(body.text) > 80000:
        raise HTTPException(400, "repair_too_long")
    user, head = _ready(request), bank.header()
    return {"job": ai.start_job(lambda job: ai.repair_import(head, LANGS, user, body.text, job, bank))}


@desktop_router.post("/import/add", dependencies=[Depends(_admin)])
def import_add(body: ImportItems):
    head = bank.header()
    added, failed = [], []
    if len(body.items) > 200:
        raise HTTPException(400, "too_many_items")
    for index, d in enumerate(body.items):
        item, issues = ai.normalize(_as_raw(d), head, LANGS)
        label = next(iter(item["texts"].values()), {}).get("q", "")[:120]
        if not item["c"] or not item["d"] or "en" not in item["texts"]:
            failed.append({"text": label, "why": "incomplete"})
            continue
        k = item["k"] or [90] * len(head["countries"])
        s = item["s"] or [90] * len(head["professions"])
        added.append({"index": index, "id": bank.save(None, item["c"], item["d"], k, s, False, item["texts"], item.get("dc") or {}, item.get("changeable", False)), "text": label})
    return {"added": added, "failed": failed}
