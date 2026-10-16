"""Focused rule checks for the configurable Belot table."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock

from apps.belot import mp_game as rules


class Context:
    def __init__(self):
        self.finished = False
        self.scheduled = []
        self.messages = []

    def schedule(self, delay, action):
        self.scheduled.append((delay, action))

    async def send(self, player, message):
        self.messages.append(message)

    async def finish(self, records, metadata=None):
        self.finished = True
        self.finish_metadata = metadata


def game(**settings):
    ctx = Context()
    table = rules.Game(ctx)
    table.settings = rules.normalize({"announcements": False, "belote": False, **settings})
    table.seats = [{"id": str(i), "name": str(i), "bot": False} for i in range(4)]
    table.bid = "C"
    table.bidder = 0
    table.original_hands = [[] for _ in range(4)]
    table.declared = [[] for _ in range(4)]
    table.belotes = [[] for _ in range(4)]
    table.deals = 1
    return table, ctx


class BelotRulesTests(unittest.TestCase):
    def test_host_can_choose_partners_and_saved_seats_survive_resume(self):
        class SeatingContext(Context):
            def __init__(self, ids, saved_state=None):
                super().__init__()
                self.people = [{"id": id_, "display_name": id_, "connected": True} for id_ in ids]
                self.saved_state = saved_state

            def all_players(self):
                return self.people

        async def run():
            ctx = SeatingContext(["alice", "bob"])
            table = rules.Game(ctx)
            table._deal = AsyncMock()
            await table.on_start({"seats": ["alice", None, "bob", None]})
            self.assertEqual([p["id"] for p in table.seats], ["alice", None, "bob", None])
            snap = table.snapshot()
            resumed = rules.Game(SeatingContext(["alice", "bob"], snap))
            await resumed.on_start({"seats": ["alice", "bob", None, None]})
            self.assertEqual([p["id"] for p in resumed.seats], ["alice", None, "bob", None])

            ctx = SeatingContext(["alice", "bob", "charlie"])
            table = rules.Game(ctx)
            table._deal = AsyncMock()
            await table.on_start({"seats": ["alice", "charlie", None, "bob"]})
            self.assertEqual([p["id"] for p in table.seats], ["alice", "charlie", None, "bob"])

            # A duplicated or missing player cannot take another player's seat.
            table = rules.Game(ctx)
            table._deal = AsyncMock()
            await table.on_start({"seats": ["alice", "alice", None, None]})
            self.assertEqual({p["id"] for p in table.seats if not p["bot"]},
                             {"alice", "bob", "charlie"})
        asyncio.run(run())

    def test_card_obligations_are_independent(self):
        s = rules.normalize({})
        hand = ["7H", "AH"]
        trick = [(0, "8H")]
        self.assertEqual(rules.legal(hand, trick, "NT", s), hand)
        self.assertEqual(rules.legal(hand, trick, "NT", rules.normalize({"no_trump_raise": True})), ["AH"])
        self.assertEqual(rules.legal(hand, trick, "AT", s), ["AH"])
        self.assertEqual(rules.legal(hand, trick, "H", s), ["AH"])
        self.assertEqual(rules.legal(hand, trick, "H", rules.normalize({"trump_raise": False})), hand)
        self.assertEqual(rules.legal(hand, trick, "C", s), hand)
        self.assertEqual(rules.legal(hand, trick, "C", rules.normalize({"plain_raise": True})), ["AH"])

    def test_discard_instead_of_undertrump(self):
        s = rules.normalize({})
        trick = [(0, "8H"), (1, "JC")]
        self.assertEqual(rules.legal_for(["9C", "AD"], trick, "C", s, 2), ["AD"])
        self.assertEqual(rules.legal_for(["9C", "AD"], trick, "C", rules.normalize({"allow_undertrump": True}), 2), ["9C"])

    def test_declarations_cannot_share_a_card(self):
        hand = ["7C", "8C", "9C", "TC", "TH", "TD", "TS"]
        options = rules.announcement_options(hand)
        quad = next(x for x in options if x["id"] == "quad:T")
        four = next(x for x in options if x["kind"] == "run" and len(x["cards"]) == 4)
        three = next(x for x in options if x["kind"] == "run" and x["cards"] == ["7C", "8C", "9C"])
        self.assertEqual(len(rules.declared_announcements(options, [quad["id"], four["id"]])), 1)
        self.assertEqual(len(rules.declared_announcements(options, [quad["id"], three["id"]])), 2)

    def test_equal_value_priority_can_change(self):
        run = next(x for x in rules.announcement_options(["7C", "8C", "9C", "TC", "JC"])
                   if len(x["cards"]) == 5)
        quad = next(x for x in rules.announcement_options(["TC", "TD", "TH", "TS"])
                    if x["kind"] == "quad")
        self.assertGreater(rules.announcement_power(quad, rules.normalize({})),
                           rules.announcement_power(run, rules.normalize({})))
        variant = rules.normalize({"equal_value_priority": "run"})
        self.assertGreater(rules.announcement_power(run, variant),
                           rules.announcement_power(quad, variant))

    def test_escape_from_contra_is_configurable(self):
        async def run():
            table, _ = game(escape_contra=False)
            table.bid = "H"
            table.double = 1
            table.turn = 2
            await table._bid(2, "S")
            self.assertEqual(table.bid, "H")
            table.settings["escape_contra"] = True
            await table._bid(2, "S")
            self.assertEqual((table.bid, table.double), ("S", 0))
        asyncio.run(run())

    def test_balanced_rounding_and_hanging(self):
        async def run():
            table, _ = game()
            table._deal = AsyncMock()
            table.bidder = 1
            table.trick_points = [34, 224]
            await table._score_deal([])
            self.assertEqual(table.scores, [4, 22])
            table, _ = game()
            table._deal = AsyncMock()
            table.trick_points = [154, 154]
            await table._score_deal([])
            self.assertEqual((table.scores, table.hanging), ([0, 15], 16))
            table.trick_points = [100, 62]
            await table._score_deal([])
            self.assertEqual((table.scores, table.hanging), ([26, 21], 0))
        asyncio.run(run())

    def test_match_continues_after_capot_and_above_target_tie(self):
        async def run():
            table, ctx = game(target=51)
            table.scores = [45, 0]
            table.trick_points = [162, 0]
            table.tricks_won = [8, 0]
            await table._score_deal([])
            self.assertFalse(ctx.finished)
            self.assertEqual(table.scores[0], 70)
            table, ctx = game()
            table.scores = [141, 145]
            table.trick_points = [100, 62]
            await table._score_deal([])
            self.assertEqual(table.scores, [151, 151])
            self.assertFalse(ctx.finished)
        asyncio.run(run())

    def test_all_trump_belote_needs_lead_or_follow(self):
        table, _ = game(belote=True)
        table.bid = "AT"
        table.original_hands[0] = ["KH", "QH"]
        table.hands[0] = ["KH", "QH"]
        table.trick = [(1, "7C")]
        self.assertFalse(table._can_belote(0, "KH"))
        table.trick = [(1, "7H")]
        self.assertTrue(table._can_belote(0, "KH"))
        table.settings["all_trump_belote_follow"] = False
        table.trick = [(1, "7C")]
        self.assertTrue(table._can_belote(0, "KH"))

    def test_no_belote_with_the_last_card_of_the_pair(self):
        # The king went earlier without belote; the queen alone cannot say it.
        table, _ = game(belote=True)
        table.bid = "AT"
        table.original_hands[0] = ["KH", "QH"]
        table.hands[0] = ["QH"]
        table.trick = [(1, "7H")]
        self.assertFalse(table._can_belote(0, "QH"))
        table.bid = "H"
        table.trick = []
        self.assertFalse(table._can_belote(0, "QH"))

    def test_only_declared_announcements_score_and_higher_run_wins(self):
        async def run():
            table, ctx = game(announcements=True)
            table._deal = AsyncMock()
            table.bidder = 1
            table.trick_points = [81, 81]
            table.original_hands[0] = ["7C", "8C", "9C"]
            table.original_hands[1] = ["8D", "9D", "TD"]
            table.declared = [["run:C:0:3"], ["run:D:1:4"], [], []]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["raw"], [81, 101])
            table, ctx = game(announcements=True)
            table._deal = AsyncMock()
            table.trick_points = [81, 81]
            table.original_hands[0] = ["7C", "8C", "9C"]
            table.declared = [[], [], [], []]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["raw"], [81, 81])
        asyncio.run(run())

    def test_announcement_visibility_hides_details_until_deal_end(self):
        async def run():
            table, ctx = game(announcements=True)
            table.phase = "playing"
            table.turn = 1
            table.original_hands[0] = ["7C", "8C", "9C"]
            table.declared = [["run:C:0:3"], None, None, None]
            named = table._state("1")
            self.assertEqual(named["announced"][0]["items"],
                             [{"kind": "run", "value": 20, "length": 3}])
            self.assertNotIn("7C", json.dumps(named))
            table.settings["announcement_visibility"] = "hidden"
            hidden = table._state("1")
            self.assertEqual(hidden["announced"][0], {"has": True})
            self.assertNotIn("20", json.dumps(hidden["announced"]))
            table.trick_points = [81, 81]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["last_reveal"][0][0]["cards"],
                             ["7C", "8C", "9C"])
        asyncio.run(run())

    def test_contra_tie_hangs_all_points(self):
        async def run():
            table, _ = game()
            table.double = 1
            table.trick_points = [81, 81]
            await table._score_deal([])
            self.assertEqual((table.scores, table.hanging), ([0, 0], 32))
            table, _ = game(contra_tie_mode="split")
            table.double = 1
            table.trick_points = [81, 81]
            await table._score_deal([])
            self.assertEqual((table.scores, table.hanging), ([16, 16], 0))
        asyncio.run(run())


    def test_capot_cancels_contra_unless_the_option_is_off(self):
        async def run():
            # Team 1 (the callers) takes every trick; the contra would quadruple it.
            table, _ = game()
            table.bidder, table.double = 1, 1
            table.trick_points, table.tricks_won = [0, 162], [0, 8]
            await table._score_deal([])
            plain = table.scores[1]
            self.assertGreater(plain, 0)
            table, _ = game(capot_cancels_contra=False)
            table.bidder, table.double = 1, 1
            table.trick_points, table.tricks_won = [0, 162], [0, 8]
            await table._score_deal([])
            self.assertEqual(table.scores[1], plain * 2)
        asyncio.run(run())


class FrenchBeloteTests(unittest.TestCase):
    def test_turnup_two_rounds_and_complete_deal(self):
        async def run():
            table, _ = game(variant="french")
            table.dealer = 3
            table.deals = 0
            await table._deal()
            self.assertEqual([len(h) for h in table.hands], [5] * 4)
            self.assertEqual(len(table.stock), 11)
            self.assertEqual(table._bid_options(), [table.upcard[1]])
            other = next(s for s in rules.SUITS if s != table.upcard[1])
            await table._bid(0, other)
            self.assertEqual((table.turn, table.bid), (0, None))
            for seat in range(4):
                await table._bid(seat, "PASS")
            self.assertEqual(table.french_round, 2)
            self.assertEqual(set(table._bid_options()), set(rules.SUITS))
            table.settings["french_second_round_same_suit"] = False
            self.assertEqual(set(table._bid_options()), set(rules.SUITS) - {table.upcard[1]})
            table.settings["french_second_round_same_suit"] = True
            turned = table.upcard
            await table._bid(0, other)
            self.assertEqual((table.bid, table.bidder, table.phase), (other, 0, "playing"))
            self.assertEqual(table.deals, 1)
            self.assertIn(turned, table.hands[0])
            self.assertEqual([len(h) for h in table.hands], [8] * 4)
            self.assertEqual(len(set(sum(table.hands, []))), 32)
            state = table._state("1")
            self.assertNotIn("stock", state)
            self.assertEqual(state["upcard"], turned)
        asyncio.run(run())

    def test_second_round_all_passes_redeals(self):
        async def run():
            table, _ = game(variant="french")
            table.dealer = 3
            table.deals = 0
            await table._deal()
            for _ in range(2):
                for seat in range(4):
                    await table._bid(seat, "PASS")
            self.assertEqual((table.dealer, table.french_round, table.deals), (0, 1, 0))
            self.assertEqual(table.phase, "bidding")
        asyncio.run(run())

    def test_french_custom_options_keep_classic_auction(self):
        settings = rules.normalize({"variant": "french", "contracts": "all", "allow_contra": True,
                                    "announcements": False, "target": 301, "rounding": "nearest"})
        self.assertEqual((settings["contracts"], settings["allow_contra"], settings["announcements"],
                          settings["target"], settings["rounding"]),
                         ("suits", False, False, 301, "nearest"))
        self.assertEqual((rules.normalize({"variant": "french"})["announcements"],
                          rules.normalize({"variant": "french"})["target"]), (False, 1000))
        table, _ = game(variant="french", belote=True)
        table.bid = "H"
        table.original_hands[0] = ["KH", "QH"]
        table.hands[0] = ["KH", "QH"]
        self.assertTrue(table._can_belote(0, "KH"))
        table.hands[0].remove("QH")
        self.assertFalse(table._can_belote(0, "KH"))

    def test_french_belote_needs_rebelote(self):
        async def run():
            table, _ = game(variant="french", belote=True)
            table.phase = "playing"
            table.turn = 0
            table.bid = "H"
            table.hands[0] = ["KH", "QH"]
            table.original_hands[0] = ["KH", "QH"]
            await table._play(0, "KH", belote=True)
            self.assertEqual(table.belote_pending[0], ["H"])
            self.assertFalse(table.belotes[0])
            table.trick = []
            table.turn = 0
            await table._play(0, "QH", belote=False)
            self.assertFalse(table.belotes[0])

            table, _ = game(variant="french", belote=True)
            table.phase = "playing"
            table.turn = 0
            table.bid = "H"
            table.hands[0] = ["KH", "QH"]
            table.original_hands[0] = ["KH", "QH"]
            await table._play(0, "KH", belote=True)
            table.trick = []
            table.turn = 0
            await table._play(0, "QH", belote=True)
            self.assertEqual(table.belotes[0], ["H"])
        asyncio.run(run())

    def test_french_belote_survives_failed_contract_and_capot(self):
        async def run():
            table, ctx = game(variant="french", belote=True)
            table._deal = AsyncMock()
            table.bid = "H"
            table.trick_points = [70, 92]
            table.tricks_won = [3, 5]
            table.belotes[0] = ["H"]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["awarded"], [20, 162])

            table, ctx = game(variant="french", belote=True)
            table._deal = AsyncMock()
            table.bid = "H"
            table.trick_points = [162, 0]
            table.tricks_won = [8, 0]
            table.belotes[1] = ["H"]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["awarded"], [252, 20])

            table, ctx = game(variant="french", target=51)
            table._deal = AsyncMock()
            table.trick_points = [162, 0]
            table.tricks_won = [8, 0]
            await table._score_deal([])
            self.assertEqual(ctx.finish_metadata, {"variant": "french"})

            table, _ = game(variant="french")
            table._deal = AsyncMock()
            table.trick_points = [81, 81]
            await table._score_deal([])
            self.assertEqual((table.scores, table.hanging), ([0, 81], 81))
        asyncio.run(run())

    def test_french_trump_announcement_wins_same_height(self):
        async def run():
            table, ctx = game(variant="french", announcements=True)
            table._deal = AsyncMock()
            table.bid = "H"
            table.trick_points = [81, 81]
            table.original_hands[0] = ["7H", "8H", "9H"]
            table.original_hands[1] = ["7C", "8C", "9C"]
            table.declared = [["run:H:0:3"], ["run:C:0:3"], [], []]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["awarded"], [101, 81])
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()


class BotBrainTests(unittest.TestCase):
    def test_void_suit_is_deduced_from_a_discard(self):
        settings = rules.normalize({})
        events = [([], 0, "7H"), ([(0, "7H")], 1, "AS")]
        forbidden = rules._forbidden_cards(events, "C", settings)
        self.assertIn("8H", forbidden[1])
        self.assertNotIn("8H", forbidden[0])

    def test_no_higher_card_is_deduced_when_raising_was_required(self):
        settings = rules.normalize({})
        events = [([], 0, "JH"), ([(0, "JH")], 1, "7H")]
        forbidden = rules._forbidden_cards(events, "AT", settings)
        self.assertEqual(forbidden[1], set())
        events = [([], 0, "9H"), ([(0, "9H")], 1, "8H")]
        forbidden = rules._forbidden_cards(events, "AT", settings)
        self.assertIn("JH", forbidden[1])

    def test_bot_plays_a_legal_card_and_a_valid_bid(self):
        table, _ = game()
        deck = [r + su for su in rules.SUITS for r in rules.RANKS]
        random_deck = deck[:]
        import random as _random
        _random.Random(4).shuffle(random_deck)
        table.hands = [sorted(random_deck[i * 8:i * 8 + 8]) for i in range(4)]
        table.phase, table.turn, table.bid, table.bidder, table.dealer = "playing", 1, "AT", 0, 3
        lead = table.hands[0].pop()
        table.trick, table.played = [(0, lead)], []
        card = rules._bot_choose_card(table, 1, .05)
        self.assertIn(card, rules.legal_for(table.hands[1], table.trick, "AT", table.settings, 1))
        table.phase, table.bid, table.bidder, table.double, table.trick = "bidding", None, None, 0, []
        table.hands = [random_deck[i * 5:i * 5 + 5] for i in range(4)]
        self.assertIn(rules._bot_choose_bid(table, 1, .05), ["PASS"] + rules.CONTRACTS)


    def test_every_call_is_listed_in_order_for_the_table(self):
        async def run():
            table, _ = game()
            table.phase, table.dealer, table.turn = "bidding", 3, 0
            table.bid = table.bidder = None
            for seat, call in ((0, "NT"), (1, "CONTRA"), (2, "AT"), (3, "CONTRA"), (0, "RECONTRA"), (1, "PASS")):
                table.turn = seat
                await table._bid(seat, call)
            self.assertEqual(table.bid_events, [[0, "NT"], [1, "CONTRA"], [2, "AT"], [3, "CONTRA"], [0, "RECONTRA"], [1, "PASS"]])
            self.assertEqual((table.bid, table.bidder, table.double), ("AT", 2, 2))
            # An invalid call (the contra-er's partner cannot recontra) is not listed.
            table2, _ = game()
            table2.phase, table2.dealer, table2.turn, table2.bid, table2.bidder = "bidding", 3, 0, None, None
            await table2._bid(0, "NT")
            table2.turn = 1
            await table2._bid(1, "CONTRA")
            table2.turn = 3
            await table2._bid(3, "RECONTRA")
            self.assertEqual(table2.bid_events, [[0, "NT"], [1, "CONTRA"]])
        asyncio.run(run())


class AiMentorTests(unittest.TestCase):
    def setUp(self):
        self._premium, self._allowed = rules._belot_premium, rules._ai_allowed

    def tearDown(self):
        rules._belot_premium, rules._ai_allowed = self._premium, self._allowed

    def table(self):
        table, ctx = game()
        ctx.host_id, ctx.room_id = "host", "room"
        table.seats = [{"id": "host", "name": "H", "bot": False}] + [{"id": None, "name": f"B{i}", "bot": True} for i in (1, 2, 3)]
        return table

    def test_ai_seats_need_premium_the_switch_and_a_bot(self):
        from types import SimpleNamespace
        table = self.table()
        rules._belot_premium = lambda: None
        rules._ai_allowed = lambda: True
        table._start_ai_seats({"ai": [True, True, False, True]})
        self.assertEqual(table.ai_seats, [])
        rules._belot_premium = lambda: SimpleNamespace(start=lambda host, seats, key: list(seats))
        rules._ai_allowed = lambda: False
        table._start_ai_seats({"ai": [True, True, False, True]})
        self.assertEqual(table.ai_seats, [])
        rules._ai_allowed = lambda: True
        table._start_ai_seats({"ai": [True, True, False, True]})
        self.assertEqual(table.ai_seats, [1, 3])   # seat 0 is a person

    def test_credits_decide_how_many_ai_bots_start(self):
        from types import SimpleNamespace
        table = self.table()
        rules._ai_allowed = lambda: True
        rules._belot_premium = lambda: SimpleNamespace(start=lambda host, seats, key: list(seats)[:1])
        table._start_ai_seats({"ai": [False, True, True, True]})
        self.assertEqual(table.ai_seats, [1])

    def test_mentor_answer_is_used_and_remark_is_kept(self):
        from types import SimpleNamespace

        async def run():
            table = self.table()
            table.phase, table.turn, table.bot_task = "playing", 1, 5
            table.bid, table.bidder = "H", 0
            table.hands = [["7C"], ["9H", "7S"], ["8C"], ["8D"]]
            table.hands = [[], ["9H", "7S"], [], []]

            async def advise(ctx, host, memory):
                return {"choice": "7S", "say": "Hop!"}

            rules._belot_premium = lambda: SimpleNamespace(advise=advise)
            choice = await table._mentor("card", 1, "9H", [("9H", 1.0), ("7S", .9)], 5)
            self.assertEqual(choice, "7S")
            self.assertEqual(table.ai_say["text"], "Hop!")
            # The game moved on while the AI was thinking: nothing is played.
            self.assertIsNone(await table._mentor("card", 1, "9H", [("9H", 1.0), ("7S", .9)], 4))
        asyncio.run(run())

    def test_premium_module_reads_answers_and_asks_only_when_close(self):
        import importlib.util
        import os
        spec = importlib.util.spec_from_file_location("belot_premium_test", os.path.join(os.path.dirname(__file__), "premium", "backend.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module._parse('ok {"move": "jh", "say": "Hi"}', ["9H", "JH"]), ("JH", "Hi"))
        self.assertEqual(module._parse('{"move": "AS"}', ["9H"]), (None, ""))
        self.assertEqual(module._parse("no json", ["9H"]), (None, ""))
        close = {"kind": "card", "options": [("9H", 1.0), ("7S", .5)]}
        clear = {"kind": "card", "options": [("9H", 9.0), ("7S", .5)]}
        self.assertTrue(module._wants_advice(close))
        self.assertFalse(module._wants_advice(clear))
        self.assertTrue(module._wants_advice({"kind": "bid", "options": [("CONTRA", 20.0), ("PASS", 0.0)]}))


class BotsKeepTheTableMovingTests(unittest.TestCase):
    """A person and three bots: after every move of the person the bots play
    straight away, so the table is always waiting for the person or finished."""

    def play_game(self, variant, seed):
        import random

        class Table(Context):
            saved_state = None
            host_id = room_id = "p"

            def all_players(self):
                return [{"id": "p", "display_name": "P", "connected": True}]

        random.seed(seed)
        ctx = Table()
        table = rules.Game(ctx)
        player = {"id": "p"}

        async def run():
            await table.on_start({"rules": {"variant": variant, "target": 151 if variant == "bulgarian" else 501}})
            for _ in range(3000):
                if ctx.finished:
                    return
                self.assertEqual(table.seats[table.turn]["id"], "p", "the table waits for a bot")
                if table.phase == "bidding":
                    options = table._bid_options()
                    pick = random.choice(options) if options and random.random() < .3 else "PASS"
                    await table.on_message(player, {"type": "bl_bid", "contract": pick})
                else:
                    legal = rules.legal_for(table.hands[table.turn], table.trick, table.bid, table.settings, table.turn)
                    await table.on_message(player, {"type": "bl_play", "card": random.choice(legal)})
            self.fail("the game never ended")
        asyncio.run(run())

    def test_bulgarian_game_never_waits_for_a_bot(self):
        self.play_game("bulgarian", 1)

    def test_french_game_never_waits_for_a_bot(self):
        self.play_game("french", 7)


class PartnerAnswerTests(unittest.TestCase):
    """The bot said diamonds, its partner said hearts over it."""

    def table(self, dealer):
        table, _ = game()
        table.bid, table.bidder, table.double = "H", 3, 0
        table.dealer = dealer
        table.bid_events = [[1, "D"], [2, "PASS"], [3, "H"]]
        return table

    def test_all_trump_when_our_team_leads(self):
        table = self.table(dealer=0)          # seat 1 leads: the bot's team
        self.assertEqual(rules._partner_answer(table, 1, ["NT", "AT"]), "AT")
        self.assertEqual(rules._bot_choose_bid(table, 1, .01), "AT")

    def test_stays_on_the_partner_suit_when_the_others_lead(self):
        table = self.table(dealer=1)          # seat 2 leads: the other team
        self.assertEqual(rules._partner_answer(table, 1, ["NT", "AT"]), "PASS")

    def test_no_all_trump_where_the_rules_forbid_it(self):
        table = self.table(dealer=0)
        self.assertEqual(rules._partner_answer(table, 1, []), "PASS")

    def test_only_when_the_partner_answered_our_suit(self):
        table = self.table(dealer=0)
        table.bid, table.bidder = "S", 2      # an opponent bid over the partner
        table.bid_events.append([2, "S"])
        self.assertIsNone(rules._partner_answer(table, 1, ["NT", "AT"]))
        table = self.table(dealer=0)
        table.bid_events = [[1, "PASS"], [3, "H"]]
        self.assertIsNone(rules._partner_answer(table, 1, ["NT", "AT"]))


class NoTrumpCapotTests(unittest.TestCase):
    def score(self, **settings):
        table, _ = game(**settings)
        table._deal = AsyncMock()
        table.bid, table.bidder = "NT", 0
        table.trick_points, table.tricks_won = [130, 0], [8, 0]
        asyncio.run(table._score_deal([]))
        return table.scores

    def test_capot_in_no_trump_is_44_by_default_and_35_when_not_doubled(self):
        self.assertEqual(self.score(), [44, 0])
        self.assertEqual(self.score(no_trump_capot_doubled=False), [35, 0])

    def test_bots_count_the_capot_the_same_way(self):
        doubled, plain = rules.normalize({}), rules.normalize({"no_trump_capot_doubled": False})
        self.assertEqual(rules._capot_bonus("NT", doubled), 180)
        self.assertEqual(rules._capot_bonus("NT", plain), 90)
        self.assertEqual(rules._capot_bonus("AT", doubled), 90)
