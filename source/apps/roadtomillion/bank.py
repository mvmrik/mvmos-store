"""
Road to a Million: the question bank in the app's own database (data.db).

The questions that travel with the app are the files in public/q/ (meta.json and
one q/<lang>.js per language, JSON content). They are the seed: whenever their
content differs from what was last imported, sync() copies every question whose
content changed into data.db, so an update brings new and corrected questions to
every installation. A question whose seed content did not change is left alone.

On the maintainer's installation the manager edits data.db and export() writes
it back into the seed files, which is what gets committed and packed.
"""
import hashlib
import json
import os
import sqlite3
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
QDIR = os.path.join(HERE, "public", "q")
META = os.path.join(QDIR, "meta.json")
DB = os.path.join(HERE, "data.db")
LANGS = ["en", "bg", "de", "es", "fr", "ja", "pt-BR", "ru", "zh-CN"]
_LOCK = threading.RLock()
_state = {"sig": None}


def _conn():
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=15000")
    c.executescript("""
        CREATE TABLE IF NOT EXISTS question (
            id TEXT PRIMARY KEY, c TEXT NOT NULL, d INTEGER NOT NULL,
            k TEXT NOT NULL, s TEXT NOT NULL, retired INTEGER NOT NULL DEFAULT 0, seed_h TEXT);
        CREATE TABLE IF NOT EXISTS qtext (
            id TEXT NOT NULL, lang TEXT NOT NULL, q TEXT NOT NULL, a TEXT NOT NULL,
            PRIMARY KEY (id, lang));
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
        CREATE INDEX IF NOT EXISTS question_cd ON question (c, d);
    """)
    # custom = 1: a question written on this installation, not shipped with the app.
    # An update never overwrites it; only export() turns it into a shipped one.
    if "custom" not in [r["name"] for r in c.execute("PRAGMA table_info(question)")]:
        c.execute("ALTER TABLE question ADD COLUMN custom INTEGER NOT NULL DEFAULT 0")
        c.commit()
    # edited = 1: a shipped question changed here and not yet written back to the files
    if "edited" not in [r["name"] for r in c.execute("PRAGMA table_info(question)")]:
        c.execute("ALTER TABLE question ADD COLUMN edited INTEGER NOT NULL DEFAULT 0")
        c.commit()
    # dc: optional difficulty for single countries, {"CN": 15}; a country that is not there uses d
    if "dc" not in [r["name"] for r in c.execute("PRAGMA table_info(question)")]:
        c.execute("ALTER TABLE question ADD COLUMN dc TEXT NOT NULL DEFAULT '{}'")
        c.commit()
    if "changeable" not in [r["name"] for r in c.execute("PRAGMA table_info(question)")]:
        c.execute("ALTER TABLE question ADD COLUMN changeable INTEGER NOT NULL DEFAULT 0")
        c.commit()
    return c


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def header():
    m = _read(META, {})
    return {"cats": m.get("cats", []), "countries": m.get("countries", []), "professions": m.get("professions", [])}


def _qhash(row, texts):
    """One fingerprint for a question's whole content, the same from files and from rows."""
    norm = {"c": row["c"], "d": int(row["d"]), "k": [int(x) for x in row["k"]], "s": [int(x) for x in row["s"]],
            "r": bool(row["retired"]), "t": {l: {"q": texts[l]["q"], "a": list(texts[l]["a"])} for l in sorted(texts)}}
    if row.get("changeable"):
        norm["changeable"] = True
    if row.get("dc"):
        norm["dc"] = {k: int(v) for k, v in row["dc"].items()}      # only when set, so older fingerprints stay the same
    return hashlib.sha1(json.dumps(norm, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _seed_files():
    return [META] + [os.path.join(QDIR, l + ".js") for l in LANGS]


def sync(force=False):
    """Import the seed files when their content changed. Cheap when nothing changed."""
    try:
        sig = tuple((os.stat(p).st_mtime_ns, os.stat(p).st_size) for p in _seed_files() if os.path.exists(p))
    except OSError:
        return
    if not force and sig == _state["sig"]:
        return
    with _LOCK:
        raw = b""
        for p in _seed_files():
            try:
                with open(p, "rb") as f:
                    raw += f.read()
            except OSError:
                pass
        digest = hashlib.sha1(raw).hexdigest()
        c = _conn()
        try:
            row = c.execute("SELECT value FROM kv WHERE key='seed_digest'").fetchone()
            if row and row["value"] == digest and not force:
                _state["sig"] = sig
                return
            meta = _read(META, {})
            files = {l: _read(os.path.join(QDIR, l + ".js"), {}) for l in LANGS}
            have = {r["id"]: r["seed_h"] for r in c.execute("SELECT id, seed_h FROM question")}
            c.execute("BEGIN IMMEDIATE")
            for m in meta.get("q", []):
                qid = m.get("id")
                texts = {l: files[l][qid] for l in LANGS if qid in files[l]}
                if not qid or "en" not in texts:
                    continue
                row_ = {"c": m["c"], "d": m["d"], "k": m["k"], "s": m["s"], "retired": bool(m.get("retired")), "dc": m.get("dc") or {}, "changeable": bool(m.get("changeable"))}
                h = _qhash(row_, texts)
                if have.get(qid) == h:
                    continue
                mine = c.execute("SELECT custom FROM question WHERE id=?", (qid,)).fetchone()
                if mine and mine["custom"]:
                    # a question of this installation has the id of a shipped one:
                    # it moves to a free id of its own and is never touched
                    top = c.execute("SELECT max(CAST(substr(id,2) AS INTEGER)) m FROM question WHERE id GLOB 'c[0-9]*'").fetchone()["m"] or 0
                    new_id = "c%04d" % (top + 1)
                    c.execute("UPDATE question SET id=? WHERE id=?", (new_id, qid))
                    c.execute("UPDATE qtext SET id=? WHERE id=?", (new_id, qid))
                c.execute("INSERT OR REPLACE INTO question (id,c,d,k,s,retired,seed_h,custom,dc,changeable) VALUES (?,?,?,?,?,?,?,0,?,?)",
                          (qid, row_["c"], int(row_["d"]), json.dumps(row_["k"]), json.dumps(row_["s"]), int(row_["retired"]), h, json.dumps(row_["dc"]), int(row_["changeable"])))
                c.execute("DELETE FROM qtext WHERE id=?", (qid,))
                c.executemany("INSERT INTO qtext (id,lang,q,a) VALUES (?,?,?,?)",
                              [(qid, l, t["q"], json.dumps(t["a"], ensure_ascii=False)) for l, t in texts.items()])
            c.execute("INSERT OR REPLACE INTO kv (key,value) VALUES ('seed_digest',?)", (digest,))
            c.commit()
            _state["sig"] = sig
        finally:
            c.close()


# ── What the game reads ──────────────────────────────────────────────────────

def game_bank():
    sync()
    c = _conn()
    try:
        return [{"id": r["id"], "c": r["c"], "d": r["d"], "k": json.loads(r["k"]), "s": json.loads(r["s"]), "dc": json.loads(r["dc"] or "{}")}
                for r in c.execute("SELECT id,c,d,k,s,dc FROM question WHERE retired=0")]
    finally:
        c.close()


def text(qid, lang):
    """{'q','a'} in the player's language, in English when that language has none."""
    c = _conn()
    try:
        for l in (lang, "en"):
            r = c.execute("SELECT q,a FROM qtext WHERE id=? AND lang=?", (qid, l)).fetchone()
            if r:
                return {"q": r["q"], "a": json.loads(r["a"])}
    finally:
        c.close()
    return None


# ── What the manager reads and writes ────────────────────────────────────────

def listing(cat="", level=0, needle="", lang="en", incomplete=False, offset=0, limit=100, pending=False, changeable=False):
    sync()
    where, args = [], []
    if cat:
        where.append("q.c=?"); args.append(cat)
    if level:
        where.append("q.d=?"); args.append(level)
    if needle:
        like = "%" + needle.replace("%", "").replace("_", "") + "%"
        where.append("(q.id LIKE ? OR EXISTS (SELECT 1 FROM qtext t WHERE t.id=q.id AND (t.q LIKE ? OR t.a LIKE ?)))")
        args += [like, like, like]
    if incomplete:
        where.append("(SELECT count(*) FROM qtext t WHERE t.id=q.id) < ?"); args.append(len(LANGS))
    if changeable:
        where.append("q.changeable=1")
    if pending:
        where.append("(q.custom=1 OR q.edited=1)")
    w = (" WHERE " + " AND ".join(where)) if where else ""
    c = _conn()
    try:
        counts = {r["c"]: r["n"] for r in c.execute("SELECT q.c, count(*) n FROM question q" + w + " GROUP BY q.c", args)}
        order = header()["cats"]
        # categories in the game's own order, also across pages
        rank = "CASE q.c " + "".join("WHEN '%s' THEN %d " % (x.replace("'", ""), i) for i, x in enumerate(order)) + "ELSE 99 END"
        rows = c.execute(
            "SELECT q.id, q.c, q.d, q.retired, q.custom, q.edited, q.changeable, "
            "(SELECT q FROM qtext t WHERE t.id=q.id AND t.lang=?) AS txt, "
            "(SELECT q FROM qtext t WHERE t.id=q.id AND t.lang='en') AS en, "
            "(SELECT count(*) FROM qtext t WHERE t.id=q.id) AS have FROM question q" + w +
            " ORDER BY " + rank + ", q.d, q.id LIMIT ? OFFSET ?", [lang] + args + [limit, offset]).fetchall()
        unexported = (c.execute("SELECT value FROM kv WHERE key='dirty'").fetchone() or {"value": "0"})["value"] == "1"
        items = [{"id": r["id"], "c": r["c"], "d": r["d"], "retired": bool(r["retired"]), "changeable": bool(r["changeable"]), "custom": bool(r["custom"]), "edited": bool(r["edited"]),
                  "text": r["txt"] or r["en"] or "", "missing": len(LANGS) - r["have"]} for r in rows]
        waiting = c.execute("SELECT count(*) n FROM question WHERE custom=1 OR edited=1").fetchone()["n"]
        return {"total": sum(counts.values()), "counts": counts, "items": items, "unexported": unexported, "pending": waiting}
    finally:
        c.close()


def get(qid):
    c = _conn()
    try:
        r = c.execute("SELECT * FROM question WHERE id=?", (qid,)).fetchone()
        if not r:
            return None
        texts = {t["lang"]: {"q": t["q"], "a": json.loads(t["a"])} for t in c.execute("SELECT * FROM qtext WHERE id=?", (qid,))}
        return {"id": r["id"], "c": r["c"], "d": r["d"], "k": json.loads(r["k"]), "s": json.loads(r["s"]),
                "dc": json.loads(r["dc"] or "{}"), "retired": bool(r["retired"]), "changeable": bool(r["changeable"]), "texts": texts}
    finally:
        c.close()


def save(qid, c_, d, k, s, retired, texts, dc=None, changeable=None):
    """Serialize edits with export so no saved question is marked as exported prematurely."""
    with _LOCK:
        return _save(qid, c_, d, k, s, retired, texts, dc, changeable)


def _save(qid, c_, d, k, s, retired, texts, dc=None, changeable=None):
    """Insert (qid None) or update one question; returns its id."""
    sync()
    c = _conn()
    try:
        c.execute("BEGIN IMMEDIATE")
        old = None
        if qid is None:
            top = c.execute("SELECT max(CAST(substr(id,2) AS INTEGER)) m FROM question WHERE id GLOB 'q[0-9]*'").fetchone()["m"] or 0
            qid = "q%04d" % (top + 1)
        else:
            old = c.execute("SELECT * FROM question WHERE id=?", (qid,)).fetchone()
            if not old:
                c.rollback()
                return None
        k = k if k is not None else (json.loads(old["k"]) if old else None)
        s = s if s is not None else (json.loads(old["s"]) if old else None)
        dc = dc if dc is not None else (json.loads(old["dc"] or "{}") if old else {})
        changeable = bool(changeable) if changeable is not None else bool(old["changeable"]) if old else False
        c.execute("INSERT OR REPLACE INTO question (id,c,d,k,s,retired,seed_h,custom,edited,dc,changeable) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                  (qid, c_, d, json.dumps(k), json.dumps(s), int(retired), old["seed_h"] if old else None,
                   old["custom"] if old else 1, 1 if old and not old["custom"] else 0, json.dumps(dc), int(changeable)))
        c.execute("DELETE FROM qtext WHERE id=?", (qid,))
        c.executemany("INSERT INTO qtext (id,lang,q,a) VALUES (?,?,?,?)",
                      [(qid, l, t["q"], json.dumps(t["a"], ensure_ascii=False)) for l, t in texts.items()])
        c.execute("INSERT OR REPLACE INTO kv (key,value) VALUES ('dirty','1')")
        c.commit()
        return qid
    finally:
        c.close()


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def export():
    """Write the database back into the seed files that are committed and packed."""
    sync()
    with _LOCK:
        c = _conn()
        try:
            head = _read(META, {})
            rows = c.execute("SELECT * FROM question ORDER BY id").fetchall()
            texts = {}
            for t in c.execute("SELECT * FROM qtext"):
                texts.setdefault(t["lang"], {})[t["id"]] = {"q": t["q"], "a": json.loads(t["a"])}
            meta_q, hashes = [], {}
            for r in rows:
                e = {"id": r["id"], "c": r["c"], "d": r["d"], "k": json.loads(r["k"]), "s": json.loads(r["s"])}
                dc = json.loads(r["dc"] or "{}")
                if dc:
                    e["dc"] = dc
                if r["changeable"]:
                    e["changeable"] = True
                if r["retired"]:
                    e["retired"] = True
                meta_q.append(e)
                own = {l: texts[l][r["id"]] for l in LANGS if r["id"] in texts.get(l, {})}
                hashes[r["id"]] = _qhash({"c": e["c"], "d": e["d"], "k": e["k"], "s": e["s"], "retired": r["retired"], "dc": dc, "changeable": bool(r["changeable"])}, own)
            head["q"] = meta_q
            for l in LANGS:
                _write(os.path.join(QDIR, l + ".js"), {r["id"]: texts[l][r["id"]] for r in rows if r["id"] in texts.get(l, {})})
            _write(META, head)
            c.execute("BEGIN IMMEDIATE")
            for qid, h in hashes.items():
                c.execute("UPDATE question SET seed_h=? WHERE id=?", (h, qid))
            c.execute("UPDATE question SET custom=0, edited=0")     # now shipped with the app
            c.execute("INSERT OR REPLACE INTO kv (key,value) VALUES ('dirty','0')")
            c.commit()
        finally:
            c.close()
        _state["sig"] = None
        sync()
    return {"questions": len(rows)}


def same_category_texts(cat, langs):
    """(id, lang, question) of every question of a category in the given languages, to spot repeats."""
    c = _conn()
    try:
        marks = ",".join("?" for _ in langs)
        return [(r["id"], r["lang"], r["q"]) for r in c.execute(
            "SELECT t.id, t.lang, t.q FROM qtext t JOIN question q ON q.id=t.id WHERE q.c=? AND t.lang IN (%s)" % marks, [cat] + list(langs))]
    finally:
        c.close()
