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
            table.bidder = 1
            table.trick_points = [34, 224]
            await table._score_deal([])
            self.assertEqual(table.scores, [4, 22])
            table, _ = game()
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
        table.trick = [(1, "7C")]
        self.assertFalse(table._can_belote(0, "KH"))
        table.trick = [(1, "7H")]
        self.assertTrue(table._can_belote(0, "KH"))
        table.settings["all_trump_belote_follow"] = False
        table.trick = [(1, "7C")]
        self.assertTrue(table._can_belote(0, "KH"))

    def test_only_declared_announcements_score_and_higher_run_wins(self):
        async def run():
            table, ctx = game(announcements=True)
            table.bidder = 1
            table.trick_points = [81, 81]
            table.original_hands[0] = ["7C", "8C", "9C"]
            table.original_hands[1] = ["8D", "9D", "TD"]
            table.declared = [["run:C:0:3"], ["run:D:1:4"], [], []]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["raw"], [81, 101])
            table, ctx = game(announcements=True)
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
            table.bid = "H"
            table.trick_points = [70, 92]
            table.tricks_won = [3, 5]
            table.belotes[0] = ["H"]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["awarded"], [20, 162])

            table, ctx = game(variant="french", belote=True)
            table.bid = "H"
            table.trick_points = [162, 0]
            table.tricks_won = [8, 0]
            table.belotes[1] = ["H"]
            await table._score_deal([])
            self.assertEqual(ctx.messages[-1]["result"]["awarded"], [252, 20])

            table, ctx = game(variant="french", target=51)
            table.trick_points = [162, 0]
            table.tricks_won = [8, 0]
            await table._score_deal([])
            self.assertEqual(ctx.finish_metadata, {"variant": "french"})

            table, _ = game(variant="french")
            table.trick_points = [81, 81]
            await table._score_deal([])
            self.assertEqual((table.scores, table.hanging), ([0, 81], 81))
        asyncio.run(run())

    def test_french_trump_announcement_wins_same_height(self):
        async def run():
            table, ctx = game(variant="french", announcements=True)
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
