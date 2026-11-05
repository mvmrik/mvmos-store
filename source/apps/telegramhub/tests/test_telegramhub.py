"""Telegram Hub: pairing, delivery rules, translations and the Mini App check."""
import hashlib
import hmac
import json
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend" / "apps" / "telegramhub" / "backend.py"


def load(tmp, premium=None):
    users = {
        "u1": {"id": "u1", "username": "anna", "language": "bg", "is_admin": 0},
        "u2": {"id": "u2", "username": "boris", "language": "auto", "is_admin": 0},
    }
    hub = types.SimpleNamespace(
        get_users_by_ids=lambda ids: [users[i] for i in ids if i in users],
        get_pub_session=lambda t: None,
        issue_pub_token=lambda uid: "tok-" + uid,
        _detect_public_apps=lambda: ["budget", "chat", "mvmai"],
        is_app_public=lambda a: True,
        can_access_public_app=lambda a, uid: True,
    )
    sys.modules["backend.auth"] = types.SimpleNamespace(get_current_session=lambda: None)
    sys.modules["backend.apphub"] = hub
    sys.modules["backend.premium"] = types.SimpleNamespace(
        load_premium_backend=lambda app_id: premium, is_premium=lambda: premium is not None)
    sys.modules["backend.db"] = types.SimpleNamespace(get_conn=lambda: (_ for _ in ()).throw(RuntimeError))
    sys.modules.pop("backend.app_isolation", None)
    sys.modules.pop("backend.notifications", None)
    mod = types.ModuleType("app_backend_telegramhub")
    mod.__file__ = str(BACKEND)
    sys.modules["app_backend_telegramhub"] = mod
    exec(compile(BACKEND.read_text(), str(BACKEND), "exec"), mod.__dict__)
    mod._DB_PATH = str(Path(tmp) / "data.db")
    mod._KEY_PATH = str(Path(tmp) / "key")
    mod._GRACE_SECONDS = 0
    mod.sent = []
    mod._send = lambda bot, chat, text, buttons=None: mod.sent.append((bot["id"], chat, text, buttons)) or {"ok": True}
    mod._call = lambda token, method, payload=None: {"ok": True, "result": {}}
    mod._set_config("public_base_url", "https://example.org")
    return mod


def add_bot(mod, bid, user, mode="hub", app_id=None, chat="100", lang=None, pair=None):
    with mod._db() as conn:
        conn.execute(
            "INSERT INTO bots(id,user_id,token,tg_id,username,mode,app_id,secret,chat_id,pair_code,lang,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (bid, user, mod._enc(f"{abs(hash(bid)) % 10**8 + 10**7}:{'A' * 35}"), bid + "-tg", bid + "_bot", mode, app_id,
             "secret-" + bid, chat, pair, lang, "now"))
        conn.commit()


def row(user="anna", source="budget", **kw):
    base = {"id": None, "username": user, "source": source, "action_app": source, "audience": "hub", "title": "T",
            "body": "", "title_key": None, "body_key": None, "vars": None, "link": None}
    base.update(kw)
    return base


class TelegramHub(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def test_token_is_stored_encrypted(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1")
        with mod._db() as conn:
            raw = conn.execute("SELECT token FROM bots").fetchone()[0]
        self.assertTrue(raw.startswith("enc:"))
        self.assertTrue(mod._bots_of("u1")[0]["token"].endswith("A" * 35))

    def test_translated_in_the_profile_language_with_english_fallback(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1")
        mod._deliver(row(title="x", title_key="budget_notif_shared", vars=json.dumps({"name": "Иван", "title": "Храна"})))
        self.assertIn("Иван сподели бюджетна категория", mod.sent[0][2])
        self.assertEqual(mod._text("nope", "fallback", {}, "bg", "budget"), "fallback")

    def test_auto_language_uses_the_language_telegram_reported(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b2", "u2", lang="de")
        mod._deliver(row("boris", title_key="budget_notif_shared", vars=json.dumps({"name": "A", "title": "B"})))
        self.assertIn("hat die Budget-Kategorie", mod.sent[0][2])

    def test_only_the_recipient_gets_it_and_muted_apps_are_skipped(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1")
        add_bot(mod, "b2", "u2", chat="200")
        mod._deliver(row("anna"))
        self.assertEqual([s[0] for s in mod.sent], ["b1"])
        mod.sent.clear()
        with mod._db() as conn:
            conn.execute("INSERT INTO muted VALUES('b1','budget')")
            conn.commit()
        mod._deliver(row("anna", "budget"))
        mod._deliver(row("anna", "chat"))
        self.assertEqual(len(mod.sent), 1)
        self.assertIn("chat", mod.sent[0][3][0][0]["web_app"])

    def test_desktop_notifications_are_never_forwarded(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1")
        started = []
        mod.threading = types.SimpleNamespace(Thread=lambda **kw: types.SimpleNamespace(start=lambda: started.append(kw)))
        mod._on_notification(row(audience="os"))
        self.assertEqual(started, [])
        mod._on_notification(row(audience="hub"))
        self.assertEqual(len(started), 1)

    def test_unpaired_bot_receives_nothing(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1", chat=None, pair="code")
        mod._deliver(row())
        self.assertEqual(mod.sent, [])

    def test_app_bot_is_free_and_takes_only_its_own_app(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1", mode="app", app_id="mvmai")
        self.assertEqual(mod._target(mod._bots_of("u1")[0]), "/pub/mvmai/")
        mod._deliver(row("anna", "chat"))
        self.assertEqual(mod.sent, [])
        mod._deliver(row("anna", "mvmai"))
        self.assertEqual(len(mod.sent), 1)
        self.assertIn("mvmai", mod.sent[0][3][0][0]["web_app"])

    def test_custom_bot_gets_no_notifications_and_opens_nothing(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1", mode="custom")
        mod._deliver(row("anna", "budget"))
        self.assertEqual(mod.sent, [])
        self.assertIsNone(mod._target(mod._bots_of("u1")[0]))

    def test_custom_bot_is_inert_without_the_premium_module(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1", mode="custom")
        bot = mod._bots_of("u1")[0]
        mod._handle_update_sync(bot, {"message": {"chat": {"id": 100, "type": "private"}, "text": "hi"}})
        self.assertEqual(len(mod.sent), 1)
        self.assertEqual(mod.sent[0][3], [])
        self.assertFalse(mod.custom_available())
        with self.assertRaises(Exception):
            mod._custom()

    def test_pairing_binds_only_with_the_right_code_and_keeps_strangers_out(self):
        mod = load(self.tmp.name)
        add_bot(mod, "b1", "u1", chat=None, pair="abc123")
        bot = mod._bot_by("id", "b1")
        mod._handle_update_sync(bot, {"message": {"chat": {"id": 7, "type": "private"}, "text": "/start wrong"}})
        self.assertIsNone(mod._bot_by("id", "b1")["chat_id"])
        mod._handle_update_sync(bot, {"message": {"chat": {"id": 7, "type": "private"}, "text": "/start abc123",
                                                  "from": {"language_code": "pt"}}})
        paired = mod._bot_by("id", "b1")
        self.assertEqual((paired["chat_id"], paired["pair_code"], paired["lang"]), ("7", None, "pt-BR"))
        mod.sent.clear()
        mod._handle_update_sync(paired, {"message": {"chat": {"id": 8, "type": "private"}, "text": "/start abc123"}})
        self.assertEqual(mod._bot_by("id", "b1")["chat_id"], "7")
        self.assertEqual(mod.sent[0][1], "8")

    def test_mini_app_data_must_be_signed_by_that_bots_token(self):
        mod = load(self.tmp.name)
        token = "123456789:" + "B" * 35

        def signed(user_id, secret_token):
            fields = {"auth_date": str(int(time.time())), "user": json.dumps({"id": user_id})}
            check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
            key = hmac.new(b"WebAppData", secret_token.encode(), hashlib.sha256).digest()
            fields["hash"] = hmac.new(key, check.encode(), hashlib.sha256).hexdigest()
            return urlencode(fields)

        self.assertEqual(mod._verify_init_data(signed(100, token), token)["id"], 100)
        self.assertIsNone(mod._verify_init_data(signed(100, "999:" + "C" * 35), token))
        self.assertIsNone(mod._verify_init_data("hash=abc", token))

    def test_the_legacy_single_bot_moves_to_the_linked_profile(self):
        mod = load(self.tmp.name)
        import sqlite3
        conn = sqlite3.connect(mod._DB_PATH)
        conn.executescript(
            "CREATE TABLE links(chat_id TEXT PRIMARY KEY, user_id TEXT, pub_token TEXT, linked_at TEXT);"
            "CREATE TABLE enabled_apps(app_id TEXT);")
        conn.execute("INSERT INTO config VALUES('bot_token','555555555:" + "D" * 35 + "')")
        conn.execute("INSERT INTO config VALUES('webhook_secret','old-secret')")
        conn.execute("INSERT INTO links VALUES('42','u1','t','2026-01-01')")
        conn.commit()
        conn.close()
        bots = mod._bots_of("u1")
        self.assertEqual((bots[0]["chat_id"], bots[0]["secret"], bots[0]["tg_id"]), ("42", "old-secret", "555555555"))
        with mod._db() as c:
            self.assertEqual(c.execute("SELECT name FROM sqlite_master WHERE name='links'").fetchone(), None)


PREMIUM = ROOT / "apps" / "telegramhub" / "premium" / "backend.py"


class FakeAuto:
    """The slice of backend.automations the custom bot uses."""

    class RuleError(Exception):
        pass

    def __init__(self):
        self.calls = []

    def _fns(self):
        def list_categories(user_id): return []
        def add_to_category(user_id, category_id, amount, source_app=None): return {}
        return {"list_categories": list_categories, "add_to_category": add_to_category}

    def describe(self, app_id):
        if app_id != "budget":
            return None
        return {"id": "budget", "name": "Budget", "name_i18n": None, "icon": "💰",
                "reads": [{"id": "list_categories", "label": "List categories", "summary": ""}],
                "actions": [{"id": "add_to_category", "label": "Add to category", "summary": "", "params": [
                    {"id": "category_id", "label": "Category", "type": "text", "required": True, "pick": "list_categories", "default": None},
                    {"id": "amount", "label": "Amount", "type": "number", "required": True, "pick": "", "default": None}]}]}

    def api_functions(self, app_id): return self._fns()
    def own_options(self, app_id, fn, param, uid): return [{"value": "c1", "label": "Food"}, {"value": "c2", "label": "Fuel"}]

    def call_kwargs(self, spec, given, fn):
        return {"category_id": given["category_id"], "amount": float(given["amount"])}

    def run_function(self, app_id, fname, uid, kwargs):
        self.calls.append((app_id, fname, uid, kwargs))
        if fname == "list_categories":
            return {"categories": [{"id": "c1", "name": "Food", "spent": 12.5}, {"id": "c2", "name": "Fuel", "spent": 3}]}
        return {"category_id": kwargs["category_id"], "balance": 87.5}


class CustomBot(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        if not PREMIUM.is_file():
            self.skipTest("premium module not installed")
        self.auto = FakeAuto()
        sys.modules["backend.automations"] = self.auto
        sys.modules["backend.premium"] = types.SimpleNamespace(is_premium=lambda: True)
        self.mod = load(self.tmp.name)
        self.prem = types.ModuleType("tg_premium")
        exec(compile(PREMIUM.read_text(), str(PREMIUM), "exec"), self.prem.__dict__)
        sys.modules["backend.premium"] = types.SimpleNamespace(
            load_premium_backend=lambda a: self.prem, is_premium=lambda: True)
        hub = sys.modules["backend.apphub"]
        hub.is_app_api_enabled = lambda a: a == "budget"
        hub.get_user_apps = lambda uid: {"budget": True}
        hub._detect_app_apis = lambda: ["budget", "chat"]
        add_bot(self.mod, "c1", "u1", mode="custom")
        self.bot = self.mod._bots_of("u1")[0]
        self.user = sys.modules["backend.apphub"].get_users_by_ids(["u1"])[0]

    def tearDown(self):
        sys.modules.pop("backend.automations", None)
        self.tmp.cleanup()

    def say(self, text=None, data=None):
        chat = {"id": 100, "type": "private"}
        update = {"callback_query": {"id": "1", "data": data, "message": {"chat": chat}, "from": {"id": 100}}} if data \
            else {"message": {"chat": chat, "text": text}}
        self.mod.sent.clear()
        self.mod._handle_update_sync(self.mod._bot_by("id", "c1"), update)
        return self.mod.sent

    def make_button(self, **over):
        body = {"name": "Add amount", "app_id": "budget", "fn": "add_to_category", "reply": "In {category_id} you now have {balance}",
                "params": [{"id": "category_id", "mode": "ask"}, {"id": "amount", "mode": "ask", "prompt": "How much?"}]}
        body.update(over)
        return self.prem.save_button(self.bot, self.user, body)

    def test_only_enabled_apps_on_the_shelf_are_offered(self):
        self.assertEqual([a["id"] for a in self.prem.catalog(self.user)], ["budget"])
        with self.assertRaises(self.prem.Invalid):
            self.make_button(app_id="chat")

    def test_button_needs_a_name_a_real_function_and_fixed_values(self):
        with self.assertRaises(self.prem.Invalid):
            self.make_button(name=" ")
        with self.assertRaises(self.prem.Invalid):
            self.make_button(fn="drop_everything")
        with self.assertRaises(self.prem.Invalid):
            self.make_button(params=[{"id": "category_id", "mode": "fixed", "value": ""}, {"id": "amount", "mode": "ask"}])

    def test_menu_lists_the_buttons_and_offers_the_apps_own_choices(self):
        self.mod._set_config("custom_enabled", "1")
        button = self.make_button()
        menu = self.say("/start")
        self.assertEqual(menu[0][3][0][0]["callback"], f"b:{button['id']}")
        asked = self.say(data=f"b:{button['id']}")
        self.assertEqual([b[0]["text"] for b in asked[0][3][:2]], ["Food", "Fuel"])
        asked = self.say(data="o:1")
        self.assertEqual(asked[0][2], "How much?")

    def test_full_conversation_runs_the_function_as_the_profile(self):
        self.mod._set_config("custom_enabled", "1")
        button = self.make_button()
        self.say(data=f"b:{button['id']}")
        self.say(data="o:0")
        bad = self.say("many")
        self.assertIn("число", bad[0][2])
        self.assertEqual(self.auto.calls, [])
        done = self.say("7,5")
        self.assertEqual(self.auto.calls[0][:3], ("budget", "add_to_category", "u1"))
        self.assertEqual(self.auto.calls[0][3], {"category_id": "c1", "amount": 7.5, "source_app": "telegramhub"})
        self.assertEqual(done[0][2], "In Food you now have 87.5")

    def test_reply_text_cannot_inject_markup(self):
        self.mod._set_config("custom_enabled", "1")
        button = self.make_button(reply="<b>{category_id}</b> & {nothing}")
        self.say(data=f"b:{button['id']}")
        self.say(data="o:0")
        done = self.say("1")
        self.assertEqual(done[0][2], "&lt;b&gt;Food&lt;/b&gt; &amp; —")

    def test_read_button_shows_the_list_without_a_reply_text(self):
        self.mod._set_config("custom_enabled", "1")
        button = self.make_button(name="Show", fn="list_categories", reply="", params=[])
        done = self.say(data=f"b:{button['id']}")
        self.assertIn("Food — spent: 12.5", done[0][2])
        self.assertIn("Fuel — spent: 3", done[0][2])

    def test_only_the_paired_chat_can_press_buttons(self):
        self.mod._set_config("custom_enabled", "1")
        button = self.make_button(name="Show", fn="list_categories", reply="x", params=[])
        stranger = {"callback_query": {"id": "1", "data": f"b:{button['id']}",
                                       "message": {"chat": {"id": 999}}, "from": {"id": 999}}}
        self.mod.sent.clear()
        self.mod._handle_update_sync(self.mod._bot_by("id", "c1"), stranger)
        self.assertEqual(self.mod.sent, [])
        self.assertEqual(self.auto.calls, [])

    def test_cancel_clears_the_conversation(self):
        self.mod._set_config("custom_enabled", "1")
        button = self.make_button()
        self.say(data=f"b:{button['id']}")
        menu = self.say(data="x")
        self.assertEqual(menu[0][3][0][0]["callback"], f"b:{button['id']}")
        self.assertIsNone(self.prem._load_state(self.bot))

    def test_switching_the_option_off_makes_the_bot_inert(self):
        button = self.make_button()
        self.assertFalse(self.prem.available())
        self.say(data=f"b:{button['id']}")
        self.assertEqual(self.auto.calls, [])


if __name__ == "__main__":
    unittest.main()
