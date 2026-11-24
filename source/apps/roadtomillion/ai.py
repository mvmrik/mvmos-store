"""
Road to a Million: the owner's AI helper for the question bank (desktop only).

It asks the AI of mvmAI (the model set for its public page) through the
app-to-app API, never through a chat of its own: the call keeps nothing, offers
no tools and charges no credits. Three things use it:

  fill     complete and check one question (missing fields, translations, facts)
  suggest  propose new questions in one language, to be reviewed first
  finish   complete the reviewed proposals (all languages, chances) and add them

The requests of one user go through one AI session of mvmAI (app="roadtomillion"):
within an hour it continues, so only the new task is sent; after an hour a new
session starts and the rules are sent again.

Calls can take a minute, so they run as jobs the window polls. Nothing is saved
by `fill` and `suggest`; only `finish` and the import add questions.
"""
import difflib
import json
import re
import sys
import threading
import time
import uuid

JOB_TTL = 3600
ASK_TIMEOUT = 240
BATCH_FILL = 4           # questions completed per AI call
BATCH_SUGGEST = 10       # questions proposed per AI call
MAX_COUNT = 40

_LOCK = threading.Lock()
_JOBS = {}               # id -> job dict

RULES = """You help the owner of the quiz game "Road to a Million" (a ladder of 20 questions, difficulty 1 to 20, the last one worth 1,000,000) to write and check questions. Answer ONLY with the JSON object that is asked for: no markdown, no text around it.

What a good question is:
1. One clear sentence, no picture needed. Four answers: one right, three plausible but clearly wrong, of the same kind as the right one. Answers short (under 60 characters). Numbers as digits.
2. Prefer enduring facts. Facts that may change (such as a capital, company name, technology or record) are allowed but must be marked changeable=true. Always assess this for every question, including reviewed or edited questions; preserve an existing true flag unless clearly inappropriate. Avoid vague "current", "latest", "now" and "today" wording; date-bound historical facts need no flag solely because they were once changeable.
3. Exactly one defensible right answer that can be checked in a reliable source. No opinion, no trick wording, no "which is NOT", no hot-button politics, nothing offensive. Write your own wording; do not copy TV quiz shows.
4. The question must make sense in every language it is shown in (en, bg, de, es, fr, ja, pt-BR, ru, zh-CN). Never write "in English" or the name of a language as a hint. No questions about translating, spelling, pronouncing, rhymes, grammar, letters or alphabet order of one language, wordplay, proverbs or idioms of one language. If a fact only makes sense in one language, reject the question instead of translating it literally.
5. Translations keep the meaning, the order of the answers (the right answer stays FIRST), numbers and years; use the usual spelling of names in each language. Do not add explanations.

The numbers of a question:
- changeable: boolean, true whenever the answer, question wording, or correctness of any option may change over time; otherwise false. Always include this field.
- c: the category, one of: {cats}.
- d: difficulty 1-20 for an average adult worldwide (1 = a child knows it, 10 = a well-read adult usually knows it, 20 = only experts or the very well read). d is a REAL RATING of how hard that question is, never a number in a list: do NOT number the questions 1, 2, 3 ... 20, do NOT spread them over the scale and do NOT make them harder one after another. Rate each question on its own: ask yourself what share of average adults would answer it correctly without options (about 95% = 1-2, 80% = 4, 60% = 7, 40% = 10, 25% = 13, 10% = 16, under 5% = 18-20). Many questions may get the same d, and all of them may be equal if that is the honest rating. A very hard question never gets a low d just because it is first in the list, and an easy one never gets a high d just because it is last.
- country_difficulty (OPTIONAL, usually left out): an object {{"<country key>": difficulty 1-20}} only for the countries where this question is clearly easier or harder than "d" because it is about that country's own history, language, geography or culture. Example: "Which year was Bulgaria founded?" is easy for a Bulgarian but hard for a Chinese, so d is the worldwide difficulty and {{"BG": 2}} is added (a Chinese player then still gets d, or you add {{"CN": 14}}). A general question that is about the same for everybody must NOT have it. Add only the countries that really differ, never all of them; keys: {countries}.
- country_chances: an object with the chance (0-100, in percent) that an average adult of each country knows the answer, keys: {countries}. A fact about a country is known better there.
- specialist_chances: an object with the chance (0-100) that a specialist of each profession knows the answer, keys: {professions}. The matching specialist is high, the others follow general knowledge.

A question record in JSON looks like this (the right answer is always the FIRST one in "a"):
{{"c": "geography", "d": 3, "changeable": false, "country_chances": {{{ex_k}}}, "specialist_chances": {{{ex_s}}}, "texts": {{"en": {{"q": "Which is the largest planet in the Solar System?", "a": ["Jupiter", "Saturn", "Neptune", "Mars"]}}, "bg": {{"q": "...", "a": ["...", "...", "...", "..."]}}}}}}
"""


# ── helpers ──────────────────────────────────────────────────────────────────

def hub():
    return sys.modules.get("backend.apphub")


def status(token=None):
    """Whether mvmAI can be asked right now, and why not."""
    h = hub()
    if not h or not sys.modules.get("app_public_mvmai"):
        return {"available": False, "reason": "mvmai_missing"}
    try:
        if not h.is_app_api_enabled("mvmai"):
            return {"available": False, "reason": "mvmai_disabled"}
    except Exception:
        return {"available": False, "reason": "mvmai_missing"}
    if not asker(token):
        return {"available": False, "reason": "login_required"}
    return {"available": True}


def asker(token):
    """The Apps Hub profile the AI is asked as: the one logged in on this desktop
    (AppHub.getToken(), sent as X-Pub-Token), like every app that needs a profile."""
    h = hub()
    try:
        user = h.get_pub_session(token) if token else None
        return user["id"] if user else None
    except Exception:
        return None


def rules(head):
    ex_k = ", ".join('"%s": 90' % c for c in head["countries"][:2]) + ", ..."
    ex_s = ", ".join('"%s": 90' % p for p in head["professions"][:2]) + ", ..."
    return RULES.format(cats=", ".join(head["cats"]), countries=", ".join(head["countries"]),
                        professions=", ".join(head["professions"]), ex_k=ex_k, ex_s=ex_s)


def _json_from(text):
    t = str(text or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", t)
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        raise ValueError("bad_ai_answer")
    body = t[a:b + 1]
    try:
        return json.loads(body)
    except ValueError:
        pass
    fixed = _escape_inner_quotes(body)
    try:
        return json.loads(fixed)
    except ValueError:
        try:
            return json.loads(_close_brackets(fixed))
        except ValueError:
            return json.loads(_close_brackets(_close_question_records(fixed)))


def _close_question_records(s):
    """Repair a missing record closer before the next question, outside strings.

    Only recognise the top-level questions array, and only when the following
    object starts with a question category. Other malformed input still fails.
    """
    out, stack, inside, escaped = [], [], False, False
    for i, ch in enumerate(s):
        if inside:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                inside = False
        elif ch == '"':
            inside = True
        elif ch in "[{":
            stack.append(ch)
        elif ch in "]}":
            if stack and stack[-1] == ("[" if ch == "]" else "{"):
                stack.pop()
        elif ch == "," and stack == ["{", "[", "{"]:
            if re.match(r'\s*\{\s*"(?:c|category)"\s*:', s[i + 1:]):
                out.append("}")
                stack.pop()
        out.append(ch)
    return "".join(out)


def _escape_inner_quotes(s):
    """Another AI sometimes writes a plain quote inside a text ("Title" in a question): escape a quote
    inside a string unless the next character is a structural one (comma, colon, closing bracket)."""
    out, inside, esc = [], False, False
    n = len(s)
    for i, ch in enumerate(s):
        if inside:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                j = i + 1
                while j < n and s[j] in " \t\r\n":
                    j += 1
                if j < n and s[j] not in ",:}]":
                    out.append("\\")
                else:
                    inside = False
        elif ch == '"':
            inside = True
        out.append(ch)
    return "".join(out)


def _close_brackets(s):
    """Another AI often drops a closing bracket: add the missing ones where a different closer shows up, and at the end."""
    out, stack, inside, esc = [], [], False, False
    for ch in s:
        if inside:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                inside = False
        elif ch == '"':
            inside = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            while stack and stack[-1] != ch:
                out.append(stack.pop())
            if stack:
                stack.pop()
        out.append(ch)
    text = re.sub(r",\s*$", "", "".join(out).rstrip())
    return text + "".join(reversed(stack))


def ask(head, user, task):
    """One request in the user's AI session for this app (mvmAI keeps it for an hour);
    the rules are sent only when a session starts. Returns the parsed JSON object."""
    intro = rules(head)
    prompt = task
    for attempt in (0, 1):
        p = prompt if attempt == 0 else prompt + "\n\nYour previous answer was not a valid JSON object. Answer again with ONLY the JSON object."
        try:
            res = hub().call_app_api("mvmai", "ask", user_id=user, prompt=p, timeout=ASK_TIMEOUT, max_chars=120000,
                                     app="roadtomillion", intro=intro)
        except TypeError:
            # An older mvmAI without sessions: every question stands alone.
            res = hub().call_app_api("mvmai", "ask", user_id=user, prompt=intro + "\nThe request:\n" + p, timeout=ASK_TIMEOUT, max_chars=120000)
        if not isinstance(res, dict) or res.get("error"):
            raise RuntimeError(str((res or {}).get("error") or "mvmai_failed"))
        try:
            return _json_from(res.get("text", ""))
        except Exception:
            continue
    raise RuntimeError("bad_ai_answer")


# ── normalising what the AI or an import gives ───────────────────────────────

def _chances(v, keys):
    """{key: n} or [n, ...] -> list in the order of keys, or None when anything is missing."""
    try:
        if isinstance(v, dict):
            out = [v[k] for k in keys]
        elif isinstance(v, list) and len(v) == len(keys):
            out = list(v)
        else:
            return None
        return [max(0, min(100, int(round(float(x))))) for x in out]
    except (KeyError, TypeError, ValueError):
        return None


def normalize(raw, head, langs):
    """One question record -> ({c, d, k, s, texts}, [issue codes]). k and s are None when incomplete."""
    issues = []
    raw = raw if isinstance(raw, dict) else {}
    c = str(raw.get("c", raw.get("category", "")) or "").strip()
    if c not in head["cats"]:
        c = ""
    try:
        d = int(raw.get("d", raw.get("level", 0)))
    except (TypeError, ValueError):
        d = 0
    if not 1 <= d <= 20:
        d = 0
    dc = {}
    src = raw.get("country_difficulty", raw.get("dc"))
    if isinstance(src, dict):
        for code, v in src.items():
            try:
                v = int(round(float(v)))
            except (TypeError, ValueError):
                continue
            if code in head["countries"] and 1 <= v <= 20:
                dc[code] = v
    k = _chances(raw.get("country_chances", raw.get("k")), head["countries"])
    s = _chances(raw.get("specialist_chances", raw.get("s")), head["professions"])
    texts = {}
    for lang, t in (raw.get("texts") or {}).items():
        if lang not in langs or not isinstance(t, dict):
            continue
        q = str(t.get("q") or "").strip()
        a = [str(x or "").strip() for x in (t.get("a") or [])]
        if not q and not any(a):
            continue
        if not q or len(a) != 4 or any(not x for x in a) or len(set(a)) != 4:
            issues.append("bad_text:" + lang)
        elif len(q) > 400 or any(len(x) > 160 for x in a):
            issues.append("too_long:" + lang)
        else:
            texts[lang] = {"q": q, "a": a}
    if not c:
        issues.append("no_category")
    if not d:
        issues.append("no_level")
    if k is None:
        issues.append("no_country_chances")
    if s is None:
        issues.append("no_specialist_chances")
    if "en" not in texts:
        issues.append("no_english")
    for lang in langs:
        if lang not in texts and not any(i.endswith(":" + lang) for i in issues):
            issues.append("missing_text:" + lang)
    return {"c": c, "d": d, "k": k, "s": s, "dc": dc, "changeable": raw.get("changeable") is True, "texts": texts}, issues


def similar(bank, c, texts):
    """The id of an existing question that reads (almost) the same, or ''."""
    probe = {l: re.sub(r"\W+", " ", t["q"].lower()).strip() for l, t in texts.items()}
    for qid, lang, q in bank.same_category_texts(c, list(probe)):
        mine = probe.get(lang)
        if mine and difflib.SequenceMatcher(None, mine, re.sub(r"\W+", " ", q.lower()).strip()).ratio() >= 0.88:
            return qid
    return ""


def draft_json(item, langs):
    """What is sent to the AI about a question: blanks stay visible as null / missing."""
    return {"changeable": bool(item.get("changeable")), "c": item.get("c") or None, "d": item.get("d") or None,
            "country_difficulty": item.get("dc") or {},
            "country_chances": item.get("k") and dict(zip(item["_head"]["countries"], item["k"])) or None,
            "specialist_chances": item.get("s") and dict(zip(item["_head"]["professions"], item["s"])) or None,
            "texts": {l: item["texts"][l] for l in langs if l in item["texts"]}}


# ── jobs ─────────────────────────────────────────────────────────────────────

def start_job(work):
    jid = uuid.uuid4().hex
    now = time.time()
    with _LOCK:
        for k in [k for k, v in _JOBS.items() if now - v["ts"] > JOB_TTL]:
            _JOBS.pop(k, None)
        job = {"status": "running", "ts": now, "progress": "", "result": None, "error": ""}
        _JOBS[jid] = job

    def run():
        try:
            job["result"] = work(job)
            job["status"] = "done"
        except Exception as e:
            job["error"] = str(e) or "mvmai_failed"
            job["status"] = "error"
        job["ts"] = time.time()

    threading.Thread(target=run, daemon=True).start()
    return jid


def job_state(jid):
    with _LOCK:
        j = _JOBS.get(jid)
        return None if not j else {"status": j["status"], "progress": j["progress"], "result": j["result"], "error": j["error"]}


# ── the three tasks ──────────────────────────────────────────────────────────

def fill(head, langs, user, question, ui_lang):
    """Complete and check one question. Returns {question, issues, verdict, notes}."""
    item, _ = normalize(question, head, langs)
    item["_head"] = head
    task = (
        "TASK fill. The owner is writing or editing one question. Its current state is below; null, empty and missing fields are what is missing.\n"
        "1. Fill everything that is missing: the category, the difficulty, both chance objects and the texts of every language that has none (translate from the best language available, English is required).\n"
        "2. Check the question: is it correct, is the right answer really right and the only defensible one, are the wrong answers really wrong, are the existing translations faithful and natural, does it obey rule 4? Also decide whether country_difficulty is needed: only when the question is clearly easier or harder for some countries (keep the owner's values, add or remove only when clearly right; a general question has none).\n"
        "3. Fix real mistakes you find, but keep what is correct untouched. If it cannot be repaired, use the verdict \"reject\".\n"
        "Current state:\n%s\n\n"
        "Answer with ONE JSON object: {\"verdict\": \"ok\" | \"fixed\" | \"reject\", \"notes\": [short sentences written in the language with the code %s saying what you filled, what you changed and why, or what is wrong], \"question\": <the complete question record, with the texts of all nine languages>}"
    ) % (json.dumps(draft_json(item, langs), ensure_ascii=False, indent=1), ui_lang)
    data = ask(head, user, task)
    out, issues = normalize(data.get("question"), head, langs)
    out["changeable"] = out["changeable"] or item["changeable"]
    verdict = data.get("verdict") if data.get("verdict") in ("ok", "fixed", "reject") else "fixed"
    notes = [str(n)[:300] for n in (data.get("notes") or [])][:12] if isinstance(data.get("notes"), list) else []
    return {"question": out, "issues": issues, "verdict": verdict, "notes": notes}


def suggest(head, langs, user, cat, lang, count, text, ui_lang, job, bank):
    """Propose `count` new questions in one language. Returns {items}."""
    items, left = [], count
    while left > 0:
        n = min(BATCH_SUGGEST, left)
        job["progress"] = "%d/%d" % (len(items), count)
        task = (
            "TASK suggest. Propose %d NEW questions written in the language with the code %s (only in that language, no translations yet).\n"
            "Category: %s.\nThe owner's wishes (free text, may be empty): %s\n"
            "Rate the difficulty of each question honestly and on its own (d is not a position in the list; equal values are fine), unless the wishes ask for a certain difficulty. Do not repeat yourself inside this batch.\n"
            "Answer with ONE JSON object: {\"questions\": [{\"c\": <category>, \"d\": <difficulty 1-20>, \"q\": <question>, \"a\": [<right answer>, <wrong>, <wrong>, <wrong>]}, ...]}"
        ) % (n, lang, cat or "choose the best fitting category for each question", text.strip()[:1500] or "-")
        data = ask(head, user, task)
        got = 0
        for r in (data.get("questions") or [])[:n] if isinstance(data.get("questions"), list) else []:
            if not isinstance(r, dict):
                continue
            item, _ = normalize({"c": r.get("c") or cat, "d": r.get("d"), "texts": {lang: {"q": r.get("q"), "a": r.get("a")}}}, head, langs)
            if lang not in item["texts"]:
                continue
            if cat:
                item["c"] = cat
            dup = similar(bank, item["c"], item["texts"]) if item["c"] else ""
            items.append({"c": item["c"], "d": item["d"], "texts": item["texts"], "dup": dup})
            got += 1
        if not got:
            break
        left -= n
    return {"items": items[:count]}


def complete(head, langs, user, drafts, ui_lang, job):
    """Fill and check reviewed questions in batches. Returns one result per draft, in order:
    {label, verdict, notes, item, issues} (verdict "none" when the AI gave no answer for it)."""
    results = []
    for start in range(0, len(drafts), BATCH_FILL):
        chunk = drafts[start:start + BATCH_FILL]
        job["progress"] = "%d/%d" % (start, len(drafts))
        shown = []
        for i, dr in enumerate(chunk):
            item, _ = normalize(dr, head, langs)
            item["_head"] = head
            shown.append(dict(draft_json(item, langs), i=i))
        task = (
            "TASK complete. The owner reviewed these %d questions. For each one: fill everything missing (the difficulty and category if null, both chance objects, and the texts of ALL nine languages, translated from the language it was written in), "
            "and check it as strictly as you would a new question (facts, a single defensible answer, rule 4). Keep the owner's wording and meaning wherever it is correct. "
            "If a question cannot be made correct, give it the verdict \"reject\" and say why.\n"
            "Questions:\n%s\n\n"
            "Answer with ONE JSON object: {\"items\": [{\"i\": <the number from the list>, \"verdict\": \"ok\" | \"fixed\" | \"reject\", \"notes\": [short sentence in the language with the code %s], \"question\": <the complete question record>}, ...]}"
        ) % (len(chunk), json.dumps(shown, ensure_ascii=False, indent=1), ui_lang)
        data = ask(head, user, task)
        by_i = {}
        for r in (data.get("items") or []) if isinstance(data.get("items"), list) else []:
            if isinstance(r, dict) and isinstance(r.get("i"), int):
                by_i[r["i"]] = r
        for i, dr in enumerate(chunk):
            label = next(iter(dr.get("texts", {}).values()), {}).get("q", "")[:120]
            r = by_i.get(i)
            if not r:
                results.append({"label": label, "verdict": "none", "notes": [], "item": None, "issues": []})
                continue
            item, issues = normalize(r.get("question"), head, langs)
            item["changeable"] = item["changeable"] or dr.get("changeable") is True
            notes = [str(n)[:300] for n in (r.get("notes") or [])][:6] if isinstance(r.get("notes"), list) else []
            verdict = r.get("verdict") if r.get("verdict") in ("ok", "fixed", "reject") else "fixed"
            results.append({"label": label, "verdict": verdict, "notes": notes, "item": item, "issues": issues})
    job["progress"] = "%d/%d" % (len(drafts), len(drafts))
    return results


def finish(head, langs, user, drafts, ui_lang, job, bank):
    """Complete the reviewed proposals and add them to the bank."""
    added, failed = [], []
    for index, r in enumerate(complete(head, langs, user, drafts, ui_lang, job)):
        item = r["item"]
        if r["verdict"] == "none":
            failed.append({"text": r["label"], "why": "no_answer"})
        elif r["verdict"] == "reject":
            failed.append({"text": r["label"], "why": "reject", "notes": r["notes"][:4]})
        elif not item["c"] or not item["d"] or "en" not in item["texts"]:
            failed.append({"text": r["label"], "why": "incomplete"})
        else:
            k = item["k"] or [90] * len(head["countries"])
            s = item["s"] or [90] * len(head["professions"])
            qid = bank.save(None, item["c"], item["d"], k, s, False, item["texts"], item.get("dc") or {}, item.get("changeable", False))
            added.append({"index": index, "id": qid, "text": item["texts"].get("en", {}).get("q", r["label"]),
                          "missing": [i.split(":")[1] for i in r["issues"] if i.startswith(("missing_text", "bad_text", "too_long"))]})
    return {"added": added, "failed": failed}


def review(head, langs, user, drafts, ui_lang, job, bank):
    """Complete and check imported questions without adding them: returns reviewable items."""
    out = []
    for r in complete(head, langs, user, drafts, ui_lang, job):
        item = r["item"]
        if item is None:
            out.append(None)
            continue
        dup = similar(bank, item["c"], item["texts"]) if item["c"] and item["texts"] else ""
        out.append(dict(item, issues=r["issues"], dup=dup, verdict=r["verdict"], notes=r["notes"]))
    return {"items": out}


# ── the template for another AI, and the import ─────────────────────────────

def template(head, count, topic):
    n = max(1, min(int(count or 10), 50))
    ex = {"c": head["cats"][0], "d": 3, "changeable": False,
          "country_chances": {c: 70 + (i * 7) % 28 for i, c in enumerate(head["countries"])},
          "specialist_chances": {p: 60 + (i * 11) % 36 for i, p in enumerate(head["professions"])},
          "texts": {"en": {"q": "Which is the largest planet in the Solar System?", "a": ["Jupiter", "Saturn", "Neptune", "Mars"]},
                    "bg": {"q": "...", "a": ["<right>", "<wrong>", "<wrong>", "<wrong>"]},
                    "<de, es, fr, ja, pt-BR, ru, zh-CN>": {"q": "...", "a": ["...", "...", "...", "..."]}}}
    guide = "What a good question is:" + rules(head).split("What a good question is:", 1)[1].split("A question record in JSON")[0]
    return (
        'Write quiz questions for the game "Road to a Million" (a ladder of 20 questions, difficulty 1 to 20, the last one worth 1,000,000).\n\n' + guide
        + "\nFunny opening question: Include at least one genuinely very easy question with d=1 whose three wrong answers are all funny and obviously absurd, so the one correct answer is immediately obvious to everyone. "
        "This is the only exception to the rule that wrong answers must be plausible and of the same kind as the right answer; the correct answer must still be uniquely correct. "
        "You may include other d=1 questions that are either normal or funny; whenever a d=1 question is funny, all three wrong answers must be funny and obviously absurd. Use funny wrong answers only on d=1 questions, not on higher difficulties. "
        "Keep the humor light, original, understandable across cultures and natural in all nine translations.\n"
        + "\nHow to answer:\nReply with ONE JSON object and nothing else (no markdown, no explanations): {\"questions\": [ ...records... ]}. "
        "Every record has: \"changeable\" (boolean), \"c\" (category), \"d\" (difficulty 1-20), \"country_chances\" (all keys), \"specialist_chances\" (all keys), optionally \"country_difficulty\" (see above, only when a question is specific to some countries) and \"texts\" with ALL nine languages "
        "(en, bg, de, es, fr, ja, pt-BR, ru, zh-CN), each {\"q\": question, \"a\": [right answer FIRST, wrong, wrong, wrong]}. "
        "Check every fact before you write it down. A record you are not sure about is better left out. "
        "Every record must be complete: all nine languages, four answers in each, all 9 country keys and all specialist keys, numbers only (never empty or text). "
        "Never put a plain double quote inside a text (use \u201e \u201c or single quotes instead, or escape it as \\\"). "
        "Before you answer, check that every bracket and brace is closed, so the whole answer is valid JSON that can be parsed.\n\nOne record looks like this:\n"
        + json.dumps(ex, ensure_ascii=False, indent=1)
        + "\n\nYour task: write %d new questions. %s\n" % (n, ("Topic and wishes: " + topic.strip()[:1500]) if topic.strip() else "Topic: any, spread over the categories.")
    )


def parse_import(head, langs, text, bank):
    """Pasted AI answer -> reviewable items [{c,d,k,s,texts,issues,dup}]."""
    data = _json_from(text)
    rows = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("bad_import")
    out = []
    for r in rows[:200]:
        item, issues = normalize(r, head, langs)
        dup = similar(bank, item["c"], item["texts"]) if item["c"] and item["texts"] else ""
        out.append(dict(item, issues=issues, dup=dup))
    return out
