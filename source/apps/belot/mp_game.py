"""Server-authoritative four-seat Belot for Game Hub.

Only the acting seat's hand enters bot decisions or player messages. The room
owns the shuffled deck, legal moves, bidding, tricks and session result.
"""
import json
import os
import random
import sqlite3
import sys
import time

SUITS = "CDHS"
RANKS = "789JQKTA"  # T means ten
CARD_POINTS = {"A": 11, "T": 10, "K": 4, "Q": 3, "J": 2, "9": 0, "8": 0, "7": 0}
TRUMP_POINTS = {"J": 20, "9": 14, "A": 11, "T": 10, "K": 4, "Q": 3, "8": 0, "7": 0}
PLAIN_ORDER = "789JQKTA"  # low to high
TRUMP_ORDER = "78QKTA9J"
CONTRACTS = ["C", "D", "H", "S", "NT", "AT"]
DEFAULTS = {
    "variant": "bulgarian",
    "contracts": "all", "no_trump_raise": False, "all_trump_raise": True,
    "trump_raise": True, "plain_raise": False,
    "must_trump": True, "partner_winning_exempts": True,
    "must_overtrump": True, "allow_undertrump": False,
    "announcements": True, "belote": True, "capot_bonus": 90, "no_trump_capot_doubled": True,
    "allow_contra": True, "escape_contra": True, "capot_cancels_contra": True,
    "announcements_mode": "declare", "belote_mode": "declare",
    "all_trump_belote_follow": True, "no_trump_announcements": False,
    "announcement_competition": "highest", "equal_value_priority": "quad",
    "announcement_visibility": "named",
    "tie_mode": "caller_hangs", "contra_tie_mode": "all_hangs",
    "no_trump_multiplier": 2, "target": 151, "redeal_all_pass": True,
    "rounding": "balanced", "deals_limit": 0,
    "finish_after_capot": False, "finish_on_tie": False,
    "french_second_round_same_suit": True,
}
FRENCH_DEFAULTS = {
    **DEFAULTS, "variant": "french", "contracts": "suits",
    "allow_contra": False, "escape_contra": False,
    "allow_undertrump": True, "announcements": False,
    "rounding": "raw", "target": 1000,
    "finish_after_capot": True,
}


def strength(card, contract):
    rank, suit = card[0], card[1]
    trump = contract == "AT" or suit == contract
    return (PLAIN_ORDER.index(rank) if not trump
            else TRUMP_ORDER.index(rank))


def points(card, contract):
    return (TRUMP_POINTS if contract == "AT" or card[1] == contract else CARD_POINTS)[card[0]]


def winner(trick, contract):
    led = trick[0][1][1]
    return max(range(len(trick)), key=lambda i: (
        1 if contract in SUITS and trick[i][1][1] == contract else 0,
        strength(trick[i][1], contract) if trick[i][1][1] == led or
        (contract in SUITS and trick[i][1][1] == contract) else -1))


def legal(hand, trick, contract, settings):
    if not trick:
        return list(hand)
    led = trick[0][1][1]
    same = [c for c in hand if c[1] == led]
    if same:
        if (contract == "AT" and settings["all_trump_raise"]) or (contract in SUITS and led == contract and settings["trump_raise"]):
            high = max((strength(c, contract) for _, c in trick if c[1] == led), default=-1)
            higher = [c for c in same if strength(c, contract) > high]
            if higher:
                return higher
        if contract == "NT" and settings["no_trump_raise"]:
            high = max((strength(c, contract) for _, c in trick if c[1] == led), default=-1)
            higher = [c for c in same if strength(c, contract) > high]
            if higher:
                return higher
        if contract in SUITS and led != contract and settings["plain_raise"]:
            high = max((strength(c, contract) for _, c in trick if c[1] == led), default=-1)
            higher = [c for c in same if strength(c, contract) > high]
            if higher:
                return higher
        return same
    return list(hand)


def legal_for(hand, trick, contract, settings, seat):
    base = legal(hand, trick, contract, settings)
    if (not trick or any(c[1] == trick[0][1][1] for c in hand)
            or contract not in SUITS or not settings["must_trump"]):
        return base
    top = trick[winner(trick, contract)]
    if settings["partner_winning_exempts"] and top[0] % 2 == seat % 2:
        return base
    trumps = [c for c in hand if c[1] == contract]
    if not trumps:
        return base
    if top[1][1] == contract and settings["must_overtrump"]:
        high = [c for c in trumps if strength(c, contract) > strength(top[1], contract)]
        if high:
            return high
        return trumps if settings["allow_undertrump"] else [c for c in hand if c[1] != contract] or trumps
    return trumps


def normalize(raw):
    raw = raw if isinstance(raw, dict) else {}
    variant = "french" if raw.get("variant") == "french" else "bulgarian"
    s = dict(FRENCH_DEFAULTS if variant == "french" else DEFAULTS)
    for k, default in DEFAULTS.items():
        if isinstance(default, bool):
            if type(raw.get(k)) is bool:
                s[k] = raw[k]
        elif isinstance(default, int):
            try:
                s[k] = int(raw.get(k, s[k]))
            except (TypeError, ValueError):
                pass
    s["variant"] = variant
    s["contracts"] = raw.get("contracts") if raw.get("contracts") in ("all", "suits") else s["contracts"]
    s["rounding"] = raw.get("rounding") if raw.get("rounding") in ("balanced", "nearest", "floor", "raw") else s["rounding"]
    for key in ("announcements_mode", "belote_mode"):
        s[key] = raw.get(key) if raw.get(key) in ("declare", "automatic") else "declare"
    s["announcement_competition"] = raw.get("announcement_competition") if raw.get("announcement_competition") in ("highest", "both") else "highest"
    s["equal_value_priority"] = raw.get("equal_value_priority") if raw.get("equal_value_priority") in ("quad", "run") else "quad"
    s["announcement_visibility"] = raw.get("announcement_visibility") if raw.get("announcement_visibility") in ("named", "hidden") else "named"
    s["tie_mode"] = raw.get("tie_mode") if raw.get("tie_mode") in ("caller_hangs", "all_hangs", "split") else "caller_hangs"
    s["contra_tie_mode"] = raw.get("contra_tie_mode") if raw.get("contra_tie_mode") in ("all_hangs", "split") else "all_hangs"
    s["target"] = max(51, min(1001, s["target"]))
    s["deals_limit"] = max(0, min(100, s["deals_limit"]))
    s["capot_bonus"] = max(0, min(200, s["capot_bonus"]))
    s["no_trump_multiplier"] = max(1, min(3, s["no_trump_multiplier"]))
    if variant == "french":
        s["contracts"] = "suits"
        s["allow_contra"] = s["escape_contra"] = False
        s["redeal_all_pass"] = True
    return s


ANNOUNCEMENT_ORDER = "789TJQKA"
QUAD_ORDER = "TQKA9J"


def announcement_options(hand):
    """Every selectable run or four of a kind, including shorter sub-runs.

    Sub-runs let a player choose a sequence that does not share a card with
    a valuable four of a kind. No declaration can reuse one card.
    """
    held = set(hand)
    options = []
    for suit in SUITS:
        for start in range(len(ANNOUNCEMENT_ORDER) - 2):
            for end in range(start + 3, len(ANNOUNCEMENT_ORDER) + 1):
                cards = [rank + suit for rank in ANNOUNCEMENT_ORDER[start:end]]
                if not set(cards) <= held:
                    break
                count = len(cards)
                value = 20 if count == 3 else 50 if count == 4 else 100
                options.append({"id": "run:" + suit + ":" + str(start) + ":" + str(end),
                                "kind": "run", "cards": cards, "value": value,
                                "power": (value, 0, count, end - 1)})
    for rank in QUAD_ORDER:
        cards = [rank + suit for suit in SUITS]
        if set(cards) <= held:
            value = 200 if rank == "J" else 150 if rank == "9" else 100
            options.append({"id": "quad:" + rank, "kind": "quad", "cards": cards,
                            "value": value, "power": (value, 1, QUAD_ORDER.index(rank), 0)})
    return _without_dominated_runs(options)


def _without_dominated_runs(options):
    """Drop a shorter run when a longer run of the same cards is offered and
    both clash with the same four of a kind: nobody would declare a tierce
    instead of the fifty made of the same cards. A shorter run stays only when
    it frees a card from a four of a kind."""
    quads = [set(o["cards"]) for o in options if o["kind"] == "quad"]
    runs = [o for o in options if o["kind"] == "run"]

    def clashes(item):
        return frozenset(i for i, q in enumerate(quads) if q & set(item["cards"]))

    dominated = set()
    for small in runs:
        for big in runs:
            if big is not small and set(small["cards"]) < set(big["cards"]) and clashes(big) == clashes(small):
                dominated.add(small["id"])
                break
    return [o for o in options if o["id"] not in dominated]


def choose_announcements(options, settings=None):
    """Choose a strong non-overlapping set without seeing another hand."""
    chosen = []
    used = set()
    for item in sorted(options, key=lambda a: announcement_power(a, settings or DEFAULTS), reverse=True):
        if not used.intersection(item["cards"]):
            chosen.append(item)
            used.update(item["cards"])
    return chosen


def declared_announcements(options, requested):
    by_id = {item["id"]: item for item in options}
    chosen = []
    used = set()
    for key in requested[:32] if isinstance(requested, list) else []:
        if not isinstance(key, str):
            continue
        item = by_id.get(key)
        if item and not used.intersection(item["cards"]):
            chosen.append(item)
            used.update(item["cards"])
    return chosen


def announcement_power(item, settings, contract=None):
    value, is_quad, count_or_rank, high = item["power"]
    return (value, is_quad if settings["equal_value_priority"] == "quad" else 1 - is_quad,
            count_or_rank, high,
            int(settings.get("variant") == "french" and contract in SUITS
                and item["kind"] == "run" and item["cards"][0][1] == contract))


# ---------------------------------------------------------------------------
# Bot brain. A bot sees only what a player at the table sees: its own hand, the
# cards already played, the bids and the trick in progress. From the plays it
# works out which suits (and which higher cards) each opponent cannot hold,
# then deals the unseen cards at random in every way consistent with that, plays
# each deal to the end with a sensible fixed policy and keeps the move that
# scores best on average.
# ---------------------------------------------------------------------------
ALL_CARDS = [r + s for s in SUITS for r in RANKS]
CARD_POWER = {}


def _power(card, contract):
    key = (card, contract)
    value = CARD_POWER.get(key)
    if value is None:
        value = CARD_POWER[key] = strength(card, contract)
    return value


def _trick_events(first_leader, played, trick, contract):
    """Every card played so far as (cards on the table before it, seat, card)."""
    events, leader = [], first_leader
    chunks = [played[i:i + 4] for i in range(0, len(played) - len(played) % 4, 4)]
    for chunk in chunks:
        table = [((leader + k) % 4, c) for k, c in enumerate(chunk)]
        for k, (seat, card) in enumerate(table):
            events.append((table[:k], seat, card))
        leader = table[winner(table, contract)][0]
    table = [(seat, card) for seat, card in trick]
    for k, (seat, card) in enumerate(table):
        events.append((table[:k], seat, card))
    return events


def _forbidden_cards(events, contract, settings):
    """forb[seat]: cards that seat provably does not hold, from the rules it obeyed."""
    forb = [set() for _ in range(4)]
    for prefix, seat, card in events:
        if not prefix:
            continue
        for other in ALL_CARDS:
            if other != card and card not in legal_for([card, other], prefix, contract, settings, seat):
                forb[seat].add(other)
    return forb


def _deal_unseen(unseen, need, forb, rng, forced=None, plausible=None):
    """One random distribution of the unseen cards that breaks no deduction.

    `plausible(hands)` counts how many things heard in the bidding the deal
    contradicts; a deal that contradicts them is kept only now and then."""
    best, best_fails = None, 99
    for _ in range(14):
        left = dict(need)
        hands = {s: [] for s in need}
        ok = True
        pool = list(unseen)
        for seat, cards in (forced or {}).items():
            for c in cards:
                if c in pool and left.get(seat, 0) > 0:
                    pool.remove(c)
                    hands[seat].append(c)
                    left[seat] -= 1
        rng.shuffle(pool)
        pool.sort(key=lambda c: sum(1 for s in left if left[s] > 0 and c not in forb[s]))
        for c in pool:
            seats = [s for s in left if left[s] > 0 and c not in forb[s]]
            if not seats:
                ok = False
                break
            seat = rng.choices(seats, weights=[left[s] for s in seats])[0]
            hands[seat].append(c)
            left[seat] -= 1
        if not ok:
            continue
        fails = plausible(hands) if plausible else 0
        if fails == 0 or rng.random() < .3 ** fails:
            return hands
        if fails < best_fails:
            best, best_fails = hands, fails
    if best is not None:
        return best
    # Deductions and the random order contradicted each other; ignore them.
    pool = list(unseen)
    rng.shuffle(pool)
    hands, i = {}, 0
    for seat in need:
        hands[seat] = pool[i:i + need[seat]]
        i += need[seat]
    return hands


def _beats_all(card, seat, hands, contract):
    """True when no opponent can take a trick led with this card."""
    for opp in ((seat + 1) % 4, (seat + 3) % 4):
        for c in hands[opp]:
            if c[1] == card[1] and _power(c, contract) > _power(card, contract):
                return False
        if (contract in SUITS and card[1] != contract
                and not any(c[1] == card[1] for c in hands[opp])
                and any(c[1] == contract for c in hands[opp])):
            return False
    return True


def _cost(card, contract):
    return (points(card, contract), _power(card, contract))


def _policy(seat, hands, trick, contract, settings):
    """The fixed way every seat plays inside a simulated deal (all hands known)."""
    options = legal_for(hands[seat], trick, contract, settings, seat)
    if len(options) == 1:
        return options[0]
    if not trick:
        sure = [c for c in options if _beats_all(c, seat, hands, contract)]
        if sure:
            trumps = [c for c in sure if contract in SUITS and c[1] == contract]
            opp_trump = contract in SUITS and any(c[1] == contract for o in ((seat + 1) % 4, (seat + 3) % 4) for c in hands[o])
            if trumps and opp_trump:
                return max(trumps, key=lambda c: _power(c, contract))
            return max(sure, key=lambda c: (points(c, contract), _power(c, contract)))
        return min(options, key=lambda c: _cost(c, contract))
    top = winner(trick, contract)
    top_seat, top_card = trick[top]
    after = [(seat + k) % 4 for k in range(1, 4 - len(trick))]

    def safe(card):
        table = trick + [(seat, card)]
        win = winner(table, contract)
        if table[win][0] != seat:
            return False
        for r in after:
            for c in legal_for(hands[r], table, contract, settings, r):
                if winner(table + [(r, c)], contract) == len(table):
                    return False
        return True

    if top_seat % 2 == seat % 2:
        if all(not any(winner(trick + [(r, c)], contract) == len(trick)
                       for c in legal_for(hands[r], trick, contract, settings, r)) for r in after):
            keep = [c for c in options if not _beats_all(c, seat, hands, contract)] or options
            return max(keep, key=lambda c: (points(c, contract), -_power(c, contract)))
        return min(options, key=lambda c: _cost(c, contract))
    wins = [c for c in options if winner(trick + [(seat, c)], contract) == len(trick)]
    if wins:
        sure = [c for c in wins if safe(c)]
        table_points = sum(points(c, contract) for _, c in trick)
        pick = min(sure or wins, key=lambda c: _cost(c, contract))
        if sure or table_points + points(pick, contract) >= 10 or points(pick, contract) <= 3:
            return pick
    return min(options, key=lambda c: _cost(c, contract))


def _finish(hands, trick, turn, contract, settings, taken, tricks):
    """Play the rest of the deal; returns [points, tricks] per team incl. last-trick 10."""
    taken, tricks = list(taken), list(tricks)
    trick = list(trick)
    while True:
        seat = turn
        card = _policy(seat, hands, trick, contract, settings)
        hands[seat].remove(card)
        trick.append((seat, card))
        if len(trick) == 4:
            win = trick[winner(trick, contract)][0]
            taken[win % 2] += sum(points(c, contract) for _, c in trick)
            tricks[win % 2] += 1
            trick = []
            turn = win
            if not hands[0] and not hands[1] and not hands[2] and not hands[3]:
                taken[win % 2] += 10
                return taken, tricks
        else:
            turn = (seat + 1) % 4


def _round_points(n, settings):
    rounding = settings["rounding"]
    if rounding == "raw":
        return n
    if rounding == "floor":
        return n // 10
    return (n + 5) // 10


def _capot_bonus(contract, settings):
    """The capot bonus; in no trump it is doubled with the rest of the deal unless the table plays it plain."""
    bonus = settings["capot_bonus"]
    if contract == "NT" and settings.get("no_trump_capot_doubled", True):
        bonus *= settings["no_trump_multiplier"]
    return bonus


def _deal_value(scores, taken, tricks, contract, caller, double, settings, my_team, belote=(0, 0)):
    """What a finished deal is worth to my_team, in game points.

    It scores the deal the way the table does (a failed contract hands the
    defenders everything, a contra gives it all to the better team, doubled or
    quadrupled) and adds a large bonus or penalty when the deal ends the match,
    so a bot near the target plays for the win, not for the points.
    """
    raw = [taken[0] + belote[0], taken[1] + belote[1]]
    if contract == "NT":
        raw = [n * settings["no_trump_multiplier"] for n in raw]
    capot_cancels = False
    for team in (0, 1):
        if tricks[team] == 8:
            raw[team] += _capot_bonus(contract, settings)
            capot_cancels = bool(settings["capot_cancels_contra"])
    scored = [0, 0]
    if capot_cancels:
        double = 0
    if raw[0] != raw[1]:
        if double:
            scored[0 if raw[0] > raw[1] else 1] = _round_points(sum(raw) * (2 if double == 1 else 4), settings)
        elif raw[caller] < raw[1 - caller]:
            scored[1 - caller] = _round_points(sum(raw), settings)
        else:
            scored = [_round_points(raw[0], settings), _round_points(raw[1], settings)]
    total = [scores[0] + scored[0], scores[1] + scored[1]]
    value = scored[my_team] - scored[1 - my_team]
    if max(total) >= settings["target"] and total[0] != total[1]:
        value += 80 if total[my_team] > total[1 - my_team] else -80
    return value


def _same_value(a, b, contract, mine, gone):
    """Two cards of one suit with the same points and nothing unseen between them play alike."""
    if a[1] != b[1] or points(a, contract) != points(b, contract):
        return False
    lo, hi = sorted((_power(a, contract), _power(b, contract)))
    for c in ALL_CARDS:
        if c[1] == a[1] and lo < _power(c, contract) < hi and c not in mine and c not in gone:
            return False
    return True


def _belote_points(game):
    return tuple(20 * (len(game.belotes[0]) + len(game.belotes[2])) if t == 0 else 20 * (len(game.belotes[1]) + len(game.belotes[3]))
                 for t in (0, 1)) if game.settings["belote"] else (0, 0)


def _bid_claims(game, seat):
    """What each other seat said in the bidding: its last suit, no trump or all trump call."""
    claims = {}
    for seat_, call in (getattr(game, "bid_events", None) or []):
        if seat_ != seat and call in CONTRACTS:
            claims[seat_] = call
    return claims


def _plausible_for(claims):
    """Counts how many calls a deal contradicts: a seat that called a suit has
    strength in it, one that called all trump has jacks, no trump has aces."""
    def plausible(hands):
        fails = 0
        for who, call in claims.items():
            h = hands.get(who) if isinstance(hands, dict) else hands[who]
            if not h:
                continue
            if call in SUITS:
                trumps = [c for c in h if c[1] == call]
                # Strong enough that someone would really call it (the J and 9
                # count most, then length).
                fails += not (sum(TRUMP_POINTS[c[0]] for c in trumps) + 4 * len(trumps) >= 30)
            elif call == "AT":
                fails += not (sum(1 for c in h if c[0] == "J") >= 1 or sum(1 for c in h if c[0] == "9") >= 2)
            else:
                fails += not sum(1 for c in h if c[0] == "A") >= 1
        return fails
    return plausible


def _bot_samples(game, seat, budget, minimum=10, maximum=90):
    """Random full deals the bot cannot tell apart from the real one."""
    rng = random.Random()
    contract, settings = game.bid, game.settings
    trick = [(s, c) for s, c in game.trick]
    events = _trick_events((game.dealer + 1) % 4, game.played, trick, contract)
    forb = _forbidden_cards(events, contract, settings)
    seen = set(game.hands[seat]) | set(game.played) | {c for _, c in trick}
    unseen = [c for c in ALL_CARDS if c not in seen]
    need = {s: len(game.hands[s]) for s in range(4) if s != seat}
    forced = None
    if settings["variant"] == "french" and game.upcard and game.bidder != seat and game.upcard in unseen:
        forced = {game.bidder: [game.upcard]}
    # What each other seat said in the bidding shows what it holds.
    claims = _bid_claims(game, seat)
    if game.bidder is not None and game.bidder != seat and contract in CONTRACTS:
        claims[game.bidder] = contract
    plausible = _plausible_for(claims)

    stop = time.perf_counter() + budget
    count = 0
    while count < maximum and (count < minimum or time.perf_counter() < stop):
        sample = _deal_unseen(unseen, need, forb, rng, forced, plausible)
        base = [list(h) for h in game.hands]
        for s, cards in sample.items():
            base[s] = cards
        count += 1
        yield base


def _play_out(game, seat, card, base, belote_extra=(0, 0)):
    """Value to the bot's team of playing `card` on this sample and playing on."""
    contract, settings = game.bid, game.settings
    hands = [list(h) for h in base]
    hands[seat].remove(card)
    table = [(s, c) for s, c in game.trick] + [(seat, card)]
    taken, tricks = list(game.trick_points), list(game.tricks_won)
    if len(table) == 4:
        win = table[winner(table, contract)][0]
        taken[win % 2] += sum(points(x, contract) for _, x in table)
        tricks[win % 2] += 1
        if not any(hands):
            taken[win % 2] += 10
        else:
            taken, tricks = _finish(hands, [], win, contract, settings, taken, tricks)
    else:
        taken, tricks = _finish(hands, table, (seat + 1) % 4, contract, settings, taken, tricks)
    known = _belote_points(game)
    belote = (known[0] + belote_extra[0], known[1] + belote_extra[1])
    return _deal_value(game.scores, taken, tricks, contract, game.bidder % 2, game.double, settings, seat % 2, belote)


def _bot_choose_card(game, seat, budget=.22, detail=False):
    contract, settings = game.bid, game.settings
    hand = list(game.hands[seat])
    options = legal_for(hand, game.trick, contract, settings, seat)
    if len(options) == 1:
        return (options[0], [(options[0], 0.0)]) if detail else options[0]
    gone = set(game.played) | {c for _, c in game.trick}
    reps = []
    for c in options:
        if not any(_same_value(c, r, contract, hand, gone) for r in reps):
            reps.append(c)
    if len(reps) == 1:
        return (reps[0], [(reps[0], 0.0)]) if detail else reps[0]
    totals = {c: 0.0 for c in reps}
    count = 0
    for base in _bot_samples(game, seat, budget):
        count += 1
        for c in reps:
            totals[c] += _play_out(game, seat, c, base)
    best = max(reps, key=lambda c: (totals[c], -points(c, contract)))
    if not detail:
        return best
    ranking = sorted(((c, totals[c] / max(1, count)) for c in reps), key=lambda item: -item[1])
    return best, ranking


def _bot_declare_belote(game, seat, card, budget=.1):
    """Say belote only when it pays: with the deal lost, the 20 points go to the other side."""
    extra = [0, 0]
    extra[seat % 2] = 20
    with_it = without = 0.0
    n = 0
    for base in _bot_samples(game, seat, budget, minimum=8, maximum=40):
        with_it += _play_out(game, seat, card, base, tuple(extra))
        without += _play_out(game, seat, card, base)
        n += 1
    return with_it >= without


# How much better than standing still a bid, contra or recontra must look.
BID_EDGE = {"C": 1.0, "contra": 5.0, "recontra": 10.0}
# A contra must also be a clearly winning bet in itself, not just a better one.
BID_MINIMUM = {"contra": 18.0}
# Added to the margin a contract call must win by, depending on who leads.
LEAD_ADJUST = {"first": -1.0, "other": 1.0, "partner_first": 2.0}


def _bonus_points(hands, contract, settings):
    """Announcement and belote points each team would score with these hands.

    Announcements are the bots' own choice (the strongest set that does not
    overlap); only the team with the better one counts unless both do."""
    bonus = [0, 0]
    if settings["announcements"] and (contract != "NT" or settings["no_trump_announcements"]):
        total, best = [0, 0], [None, None]
        for seat in range(4):
            for item in choose_announcements(announcement_options(hands[seat]), settings):
                team = seat % 2
                total[team] += item["value"]
                power = announcement_power(item, settings, contract)
                if best[team] is None or power > best[team]:
                    best[team] = power
        if settings["announcement_competition"] == "both":
            bonus = total[:]
        elif best[0] != best[1]:
            won = 1 if best[1] is not None and (best[0] is None or best[1] > best[0]) else 0
            bonus[won] = total[won]
    if settings["belote"] and contract != "NT":
        suits = [contract] if contract in SUITS else SUITS
        for seat in range(4):
            for su in suits:
                if "K" + su in hands[seat] and "Q" + su in hands[seat]:
                    bonus[seat % 2] += 20
    return bonus


def _strong_for_contra(hand, contract):
    """Only a hand that holds the heart of the called game may contra it."""
    if contract in SUITS:
        trumps = [c for c in hand if c[1] == contract]
        has = {c[0] for c in trumps}
        return ("J" in has and "9" in has) or ("J" in has and len(trumps) >= 4)
    jacks = sum(1 for c in hand if c[0] == "J")
    aces = sum(1 for c in hand if c[0] == "A")
    if contract == "AT":
        return jacks >= 2 and jacks + sum(1 for c in hand if c[0] == "9") + aces >= 5
    tens = sum(1 for c in hand if c[0] == "T")
    return aces >= 4 or (aces >= 3 and tens >= 1)


def _partner_answer(game, seat, available):
    """The partner called another suit over this bot's suit: both are strong.
    When our team leads the first trick that is all trump; otherwise the bot
    leaves the partner on their suit, since they cut it knowing we do not lead."""
    partner = (seat + 2) % 4
    mine = next((call for s, call in reversed(getattr(game, "bid_events", None) or []) if s == seat), None)
    if mine not in tuple(SUITS) or game.bidder != partner or game.bid not in tuple(SUITS) or game.bid == mine or game.double:
        return None
    leads = (game.dealer + 1) % 4 % 2 == seat % 2
    if leads and "AT" in available:
        return "AT"
    return "PASS"


def _bot_choose_bid(game, seat, budget=.3, detail=False):
    """Bulgarian bidding on five cards: try every contract, contra and recontra
    on random completions of the hand, and pick what is worth most."""
    rng = random.Random()
    settings = game.settings
    hand = list(game.hands[seat])
    available = [c for c in game._bid_options() if c in CONTRACTS]
    unseen = [c for c in ALL_CARDS if c not in hand]
    my_team = seat % 2
    bidder_team = None if game.bidder is None else game.bidder % 2
    first = (game.dealer + 1) % 4
    answer = _partner_answer(game, seat, available)
    if answer is not None:
        return (answer, [(answer, 0.0)]) if detail else answer
    # Other seats' calls tell what they hold: the imagined deals respect them.
    plausible = _plausible_for(_bid_claims(game, seat))
    need = {s: (3 if s == seat else 8) for s in range(4)}
    no_forb = {s: set() for s in range(4)}
    contra = bool(game.bid is not None and game._bid_valid(seat, "CONTRA"))
    recontra = bool(game.bid is not None and game._bid_valid(seat, "RECONTRA"))
    keys = [("C", c) for c in available]
    if game.bid is not None:
        keys.append(("hold", game.bid))
        if contra and _strong_for_contra(hand, game.bid):
            keys.append(("contra", game.bid))
        if recontra:
            keys.append(("recontra", game.bid))
    totals = {k: 0.0 for k in keys}
    count = 0
    # A contra is a big bet: look at more deals before making one.
    risky = any(k[0] in ("contra", "recontra") for k in keys)
    stop = time.perf_counter() + budget * (2 if risky else 1)
    while count < (80 if risky else 40) and (count < (24 if risky else 8) or time.perf_counter() < stop):
        sample = _deal_unseen(unseen, need, no_forb, rng, None, plausible)
        mine = hand + sample[seat]
        others = {s: sample[s] for s in range(4) if s != seat}
        results = {}
        original = [list(others[s]) if s != seat else list(mine) for s in range(4)]
        for contract in {k[1] for k in keys}:
            hands = [list(h) for h in original]
            results[contract] = _finish(hands, [], first, contract, settings, [0, 0], [0, 0]) + (
                _bonus_points(original, contract, settings),)
        for kind, contract in keys:
            taken, tricks, bonus = results[contract]
            if kind == "C":
                totals[(kind, contract)] += _deal_value(game.scores, taken, tricks, contract, my_team, 0, settings, my_team, bonus)
            else:
                double = {"hold": game.double, "contra": 1, "recontra": 2}[kind]
                totals[(kind, contract)] += _deal_value(game.scores, taken, tricks, contract, bidder_team, double, settings, my_team, bonus)
        count += 1
    ev = {k: v / count for k, v in totals.items()}
    base = ev.get(("hold", game.bid), 0.0)
    best = None
    for key in keys:
        if key[0] == "hold":
            continue
        # A raise must beat standing on the current bid; contra and recontra
        # are all-or-nothing bets, so they need a clear edge.
        edge = BID_EDGE[key[0]]
        if key[0] == "C":
            # The first to bid also leads the first trick, which favours a bold
            # call; anyone else, and above all the partner of whoever leads,
            # holds back.
            edge += LEAD_ADJUST["first"] if seat == first else LEAD_ADJUST["partner_first"] if seat == (first + 2) % 4 else LEAD_ADJUST["other"]
        if ev[key] > base + edge and ev[key] >= BID_MINIMUM.get(key[0], -1e9) and (best is None or ev[key] > ev[best]):
            best = key
    choice = "PASS" if best is None else best[1] if best[0] == "C" else best[0].upper()
    if not detail:
        return choice
    names = {("C", c): c for c in available}
    names.update({("contra", game.bid): "CONTRA", ("recontra", game.bid): "RECONTRA"})
    others = sorted(((names[k], ev[k]) for k in keys if k in names and names[k] != choice),
                    key=lambda item: -item[1])
    ranking = [(choice, ev[best] if best is not None else base)]
    if choice != "PASS":
        ranking.append(("PASS", base))
    ranking += [item for item in others if item[0] != "PASS"][:3]
    return choice, ranking

def _completed_tricks(first_leader, played, contract):
    tricks, leader = [], first_leader
    for i in range(0, len(played) - len(played) % 4, 4):
        table = [((leader + k) % 4, c) for k, c in enumerate(played[i:i + 4])]
        tricks.append(table)
        leader = table[winner(table, contract)][0]
    return tricks


def _belot_premium():
    """Belot's premium build, or None when this installation has none."""
    prem = sys.modules.get("backend.premium")
    try:
        return prem.load_premium_backend("belot") if prem else None
    except Exception:
        return None


def _ai_allowed():
    """The administrator's switch for AI bots (Belot's desktop settings)."""
    try:
        conn = sqlite3.connect(os.path.join(os.path.dirname(__file__), "data.db"))
        try:
            row = conn.execute("SELECT value FROM cfg WHERE key='ai_enabled'").fetchone()
        finally:
            conn.close()
        return bool(row and json.loads(row[0]))
    except Exception:
        return False


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.settings = dict(DEFAULTS)
        self.seats = []
        self.hands = [[] for _ in range(4)]
        self.extra_hands = [[] for _ in range(4)]
        self.original_hands = [[] for _ in range(4)]
        self.scores = [0, 0]
        self.hanging = 0
        self.dealer = random.randrange(4)
        self.deals = 0
        self.phase = "waiting"
        self.bid = None
        self.bidder = None
        self.double = 0
        self.passes = 0
        self.turn = 0
        self.trick = []
        self.played = []
        self.trick_points = [0, 0]
        self.tricks_won = [0, 0]
        self.declared = [None] * 4
        self.belotes = [[] for _ in range(4)]
        self.belote_pending = [[] for _ in range(4)]
        self.last_capot = False
        self.last_reveal = []
        self.bot_task = 0
        self.upcard = None
        self.stock = []
        self.french_round = 0
        self.bid_log = [None] * 4
        # Every call of this deal in order, so a table never has to guess who said what.
        self.bid_events = []
        self.history = []
        # Seats whose bot has an AI mentor (Premium), the mentor's latest remark
        # and what it needs to remember between questions.
        self.ai_seats = []
        self.ai_say = None
        self.ai_memory = {}
        self._bots_running = False

    async def on_start(self, settings):
        self.settings = normalize(settings.get("rules"))
        people = [p for p in self.ctx.all_players() if p["connected"]][:4]
        # Accept only a complete, unique assignment of the current players.
        saved = self.ctx.saved_state
        requested = (saved.get("seat_ids") if isinstance(saved, dict) and "seat_ids" in saved
                     else settings.get("seats"))
        ids = {str(p["id"]) for p in people}
        valid = (isinstance(requested, list) and len(requested) == 4
                 and all(p is None or isinstance(p, str) for p in requested)
                 and len([p for p in requested if p is not None]) == len(ids)
                 and set(p for p in requested if p is not None) == ids)
        if valid:
            positions = {pid: i for i, pid in enumerate(requested) if pid is not None}
        else:
            # Older clients still get a playable table.
            defaults = ([0], [0, 1], [0, 1, 2], [0, 1, 2, 3])[len(people)-1]
            positions = {str(p["id"]): i for p, i in zip(people, defaults)}
        self.seats = [{"id": None, "name": f"Bot {i+1}", "bot": True} for i in range(4)]
        for p in people:
            pos = positions[str(p["id"])]
            self.seats[pos] = {"id": str(p["id"]), "name": p["display_name"], "bot": False}
        if not isinstance(saved, dict):
            self._start_ai_seats(settings)
        if isinstance(saved, dict):
            data = saved
            try:
                for key in ("hands", "extra_hands", "original_hands", "scores", "hanging", "dealer", "deals", "phase", "bid", "bidder", "double", "passes", "turn", "trick", "played", "trick_points", "tricks_won"):
                    setattr(self, key, data[key])
                self.upcard = data.get("upcard")
                self.stock = data.get("stock", [])
                self.french_round = data.get("french_round", 0)
                self.bid_log = data.get("bid_log", [None] * 4)
                self.bid_events = data.get("bid_events", [])
                self.history = data.get("history", [])
                self.ai_seats = [x for x in data.get("ai_seats", []) if x in range(4)]
                self.settings = normalize(data["settings"])
                self.declared = data.get("declared", [None] * 4)
                self.belotes = data.get("belotes", [[] for _ in range(4)])
                self.belote_pending = data.get("belote_pending", [[] for _ in range(4)])
                self.last_capot = data.get("last_capot", False)
                self.last_reveal = data.get("last_reveal", [])
                await self._broadcast_state()
                await self._run_bots()
                return
            except (KeyError, TypeError, ValueError):
                pass
        await self._deal()
        await self._run_bots()

    async def on_join(self, player):
        await self._send_state(str(player["id"]))

    async def on_leave(self, player):
        pass

    async def on_message(self, player, msg):
        pid = str(player["id"])
        seat = next((i for i, p in enumerate(self.seats) if p["id"] == pid), None)
        if msg.get("type") == "bl_diag":
            # A table noticed it was waiting too long; what it saw goes to the log next to what the server has.
            info = msg.get("info") if isinstance(msg.get("info"), dict) else {}
            print(f"[belot] diag room={self.ctx.room_id} seat={seat} reason={str(msg.get('reason'))[:40]} "
                  f"server=(phase={self.phase} turn={self.turn} deals={self.deals} played={len(self.played)} trick={len(self.trick)}) "
                  f"table={json.dumps(info)[:600]}")
            return
        if msg.get("type") == "bl_sync":
            # A table that has heard nothing for a while asks for the current state.
            if seat is not None:
                await self._send_state(pid)
            return
        if seat is None:
            return
        if seat != self.turn:
            # This table acted on a picture that is out of date: show it the real one.
            await self._send_state(pid)
            return
        if msg.get("type") == "bl_bid" and self.phase == "bidding":
            await self._bid(seat, str(msg.get("contract", "")))
        elif msg.get("type") == "bl_play" and self.phase == "playing":
            await self._play(seat, str(msg.get("card", "")),
                             msg.get("announcements"), msg.get("belote") is True)
        else:
            await self._send_state(pid)
            return
        await self._run_bots()

    def _start_ai_seats(self, settings):
        """Give the bots the host asked for an AI mentor, if this server offers one."""
        requested = settings.get("ai")
        if not isinstance(requested, list) or len(requested) != 4:
            return
        want = [i for i in range(4) if requested[i] is True and self.seats[i]["bot"]]
        prem = _belot_premium() if want and _ai_allowed() else None
        if not prem:
            return
        try:
            self.ai_seats = list(prem.start(self.ctx.host_id, want, f"{self.ctx.room_id}:{int(time.time())}"))
        except Exception:
            self.ai_seats = []

    def _ai_context(self, kind, seat, ranking):
        """What the mentor may know: this seat's own view of the table."""
        team = seat % 2
        ctx = {"kind": kind, "seat": seat, "target": self.settings["target"],
               "scores": [self.scores[team], self.scores[1 - team]],
               "contract": self.bid, "bidder": self.bidder, "double": self.double,
               "hand": list(self.hands[seat]), "options": ranking}
        if kind == "bid":
            ctx["bids"] = [(s, b) for s, b in enumerate(self.bid_log) if b]
            return ctx
        trick = [(s, c) for s, c in self.trick]
        events = _trick_events((self.dealer + 1) % 4, self.played, trick, self.bid)
        forb = _forbidden_cards(events, self.bid, self.settings)
        seen = set(self.hands[seat]) | set(self.played) | {c for _, c in trick}
        unseen = [c for c in ALL_CARDS if c not in seen]
        voids = {}
        for s in range(4):
            if s == seat:
                continue
            gone = [su for su in SUITS if any(c[1] == su for c in unseen)
                    and all(c in forb[s] for c in unseen if c[1] == su)]
            if gone:
                voids[s] = gone
        ctx.update({
            "points": [self.trick_points[team], self.trick_points[1 - team]],
            "tricks": [self.tricks_won[team], self.tricks_won[1 - team]],
            "table": trick,
            "tricks_played": _completed_tricks((self.dealer + 1) % 4, self.played, self.bid),
            "voids": voids,
            "unseen": {su: [c[0] for c in sorted((c for c in unseen if c[1] == su), key=lambda c: -PLAIN_ORDER.index(c[0]))]
                       for su in SUITS},
        })
        return ctx

    async def _mentor(self, kind, seat, proposal, ranking, token):
        """Let the AI mentor change the bot's move. None when the game moved on meanwhile."""
        prem = _belot_premium()
        if not prem:
            return proposal
        try:
            answer = await prem.advise(self._ai_context(kind, seat, ranking), self.ctx.host_id, self.ai_memory)
        except Exception:
            answer = {}
        if token != self.bot_task or self.turn != seat or self.phase != ("bidding" if kind == "bid" else "playing"):
            return None
        if answer.get("say"):
            self.ai_say = {"seat": seat, "text": answer["say"], "n": (self.ai_say or {}).get("n", 0) + 1}
        return answer.get("choice") or proposal

    def snapshot(self):
        if self.phase == "finished":
            return None
        return {"settings": self.settings, "seat_ids": [p["id"] for p in self.seats], "hands": self.hands, "extra_hands": self.extra_hands, "original_hands": self.original_hands, "scores": self.scores, "hanging": self.hanging,
                "upcard": self.upcard, "stock": self.stock, "french_round": self.french_round, "bid_log": self.bid_log, "bid_events": self.bid_events, "history": self.history,
                "dealer": self.dealer, "deals": self.deals, "phase": self.phase,
                "bid": self.bid, "bidder": self.bidder, "double": self.double, "passes": self.passes,
                "turn": self.turn, "trick": self.trick, "played": self.played,
                "trick_points": self.trick_points, "tricks_won": self.tricks_won,
                "declared": self.declared, "belotes": self.belotes, "belote_pending": self.belote_pending,
                "last_capot": self.last_capot, "last_reveal": self.last_reveal, "ai_seats": self.ai_seats}

    async def _deal(self):
        deck = [r+s for s in SUITS for r in RANKS]
        random.SystemRandom().shuffle(deck)
        self.hands = [sorted(deck[i*5:i*5+5], key=lambda c: (SUITS.index(c[1]), RANKS.index(c[0]))) for i in range(4)]
        if self.settings["variant"] == "french":
            self.upcard, self.stock = deck[20], deck[21:]
            self.extra_hands = [[] for _ in range(4)]
            self.french_round = 1
        else:
            self.extra_hands = [deck[20+i*3:20+i*3+3] for i in range(4)]
            self.upcard, self.stock, self.french_round = None, [], 0
        self.original_hands = [[] for _ in range(4)]
        self.phase = "bidding"
        self.bid = self.bidder = None
        self.double = 0
        self.passes = 0
        self.turn = (self.dealer + 1) % 4
        self.trick = []
        self.played = []
        self.trick_points = [0, 0]
        self.tricks_won = [0, 0]
        self.declared = [None] * 4
        self.belotes = [[] for _ in range(4)]
        self.belote_pending = [[] for _ in range(4)]
        self.bid_log = [None] * 4
        self.bid_events = []
        if self.settings["variant"] != "french":
            self.deals += 1
        await self._broadcast_state()

    def _contracts(self):
        return CONTRACTS if self.settings["contracts"] == "all" else CONTRACTS[:4]

    def _bid_options(self):
        if self.settings["variant"] == "french":
            return ([self.upcard[1]] if self.french_round == 1 else
                    [s for s in SUITS if self.settings["french_second_round_same_suit"] or s != self.upcard[1]])
        return [c for c in self._contracts() if (self.bid is None or self._contracts().index(c) > self._contracts().index(self.bid))
                and (self.double == 0 or self.settings["escape_contra"])]

    def _bid_valid(self, seat, contract):
        if contract == "PASS":
            return True
        if self.settings["variant"] == "french":
            return contract in self._bid_options()
        if contract == "CONTRA":
            return bool(self.settings["allow_contra"] and self.bid is not None and self.double == 0 and seat % 2 != self.bidder % 2)
        if contract == "RECONTRA":
            return bool(self.settings["allow_contra"] and self.double == 1 and seat % 2 == self.bidder % 2)
        return contract in self._bid_options()

    async def _bid(self, seat, contract):
        if self._bid_valid(seat, contract):
            self.bid_log[seat] = contract
            self.bid_events.append([seat, contract])
        if self.settings["variant"] == "french":
            if contract == "PASS":
                self.passes += 1
                if self.passes == 4:
                    if self.french_round == 1:
                        self.french_round, self.passes = 2, 0
                        self.bid_log = [None] * 4
                        self.turn = (self.dealer + 1) % 4
                        await self._broadcast_state()
                    else:
                        self.dealer = (self.dealer + 1) % 4
                        await self._deal()
                    return
                self.turn = (seat + 1) % 4
                await self._broadcast_state()
            elif contract in self._bid_options():
                self.bid, self.bidder = contract, seat
                self.deals += 1
                await self._start_play()
            else:
                await self._send_state(self.seats[seat]["id"])
            return
        if contract == "PASS":
            self.passes += 1
            if self.passes >= (4 if self.bid is None else 3):
                if self.bid is None:
                    if not self.settings["redeal_all_pass"]:
                        self.bid, self.bidder = "C", self.dealer
                        await self._start_play()
                        return
                    self.dealer = (self.dealer + 1) % 4
                    await self._deal()
                    return
                await self._start_play()
                return
        elif contract == "CONTRA" and self.settings["allow_contra"] and self.bid is not None and self.double == 0 and seat%2 != self.bidder%2:
            self.double, self.passes = 1, 0
        elif contract == "RECONTRA" and self.settings["allow_contra"] and self.double == 1 and seat%2 == self.bidder%2:
            self.double, self.passes = 2, 0
        elif contract in self._contracts() and (self.bid is None or self._contracts().index(contract) > self._contracts().index(self.bid)) and (self.double == 0 or self.settings["escape_contra"]):
            self.bid, self.bidder, self.double, self.passes = contract, seat, 0, 0
        else:
            await self._send_state(self.seats[seat]["id"])
            return
        self.turn = (seat + 1) % 4
        await self._broadcast_state()

    async def _start_play(self):
        if self.settings["variant"] == "french":
            offset = 0
            for i in range(4):
                count = 2 if i == self.bidder else 3
                self.extra_hands[i] = self.stock[offset:offset+count]
                if i == self.bidder:
                    self.extra_hands[i].append(self.upcard)
                offset += count
            self.stock = []
        for i in range(4):
            self.hands[i] = sorted(self.hands[i] + self.extra_hands[i], key=lambda c: (SUITS.index(c[1]), RANKS.index(c[0])))
        self.original_hands = [list(h) for h in self.hands]
        self.extra_hands = [[] for _ in range(4)]
        self.phase = "playing"
        self.turn = (self.dealer + 1) % 4
        await self._broadcast_state()

    def _can_belote(self, seat, card):
        if not self.settings["belote"] or self.bid == "NT" or card[0] not in "KQ":
            return False
        suit = card[1]
        if self.bid != "AT" and suit != self.bid:
            return False
        if suit in self.belotes[seat] or not {"K" + suit, "Q" + suit} <= set(self.original_hands[seat]):
            return False
        other = "Q" + suit if card[0] == "K" else "K" + suit
        if self.settings["variant"] == "french":
            return suit in self.belote_pending[seat] or other in self.hands[seat]
        # Belote is said with the first of the pair; once its partner card is gone, the chance is gone with it.
        if other not in self.hands[seat]:
            return False
        return self.bid != "AT" or not self.settings["all_trump_belote_follow"] or not self.trick or self.trick[0][1][1] == suit

    async def _play(self, seat, card, announcements=None, belote=False):
        if card not in self.hands[seat] or card not in legal_for(self.hands[seat], self.trick, self.bid, self.settings, seat):
            await self._send_state(self.seats[seat]["id"])
            return
        if self.declared[seat] is None:
            options = announcement_options(self.original_hands[seat]) if self.settings["announcements"] and (self.bid != "NT" or self.settings["no_trump_announcements"]) else []
            selected = (choose_announcements(options, self.settings) if self.seats[seat]["bot"] or self.settings["announcements_mode"] == "automatic"
                        else declared_announcements(options, announcements))
            self.declared[seat] = [item["id"] for item in selected]
        can_belote = self._can_belote(seat, card)
        if self.settings["variant"] == "french" and card[0] in "KQ" and card[1] in self.belote_pending[seat]:
            self.belote_pending[seat].remove(card[1])
            if can_belote and (belote or self.settings["belote_mode"] == "automatic"):
                self.belotes[seat].append(card[1])
        elif can_belote and (belote or self.settings["belote_mode"] == "automatic"):
            if self.settings["variant"] == "french":
                self.belote_pending[seat].append(card[1])
            else:
                self.belotes[seat].append(card[1])
        self.hands[seat].remove(card)
        self.trick.append((seat, card))
        if len(self.trick) < 4:
            self.turn = (seat + 1) % 4
            await self._broadcast_state()
            return
        win_seat = self.trick[winner(self.trick, self.bid)][0]
        team = win_seat % 2
        self.trick_points[team] += sum(points(c, self.bid) for _, c in self.trick)
        self.tricks_won[team] += 1
        self.played += [c for _, c in self.trick]
        last = list(self.trick)
        self.trick = []
        self.turn = win_seat
        if len(self.played) == 32:
            self.trick_points[team] += 10
            await self._score_deal(last)
        else:
            await self._broadcast_state(last)

    def _score_value(self, n):
        if self.settings["rounding"] == "raw":
            return n
        if self.settings["rounding"] == "floor":
            return n // 10
        return (n + 5) // 10

    def _score_pair(self, raw):
        result = [self._score_value(n) for n in raw]
        if self.settings["rounding"] == "balanced":
            difference = self._score_value(sum(raw)) - sum(result)
            if difference:
                # With 34:224, both ordinary rounds go down. Give the
                # missing point to the team with fewer raw points: 4:22.
                lower = 0 if raw[0] <= raw[1] else 1
                result[lower] += difference
        return result

    def _announcements_by_seat(self):
        if not self.settings["announcements"] or (self.bid == "NT" and not self.settings["no_trump_announcements"]):
            return [[] for _ in range(4)]
        return [declared_announcements(announcement_options(self.original_hands[i]), self.declared[i])
                for i in range(4)]

    def _public_announcements(self):
        visible = []
        for items in self._announcements_by_seat():
            if not items:
                visible.append(None)
            elif self.settings["announcement_visibility"] == "hidden":
                visible.append({"has": True})
            else:
                visible.append({"has": True, "items": [
                    {"kind": item["kind"], "value": item["value"], "length": len(item["cards"])}
                    for item in items]})
        return visible

    def _current_reveal(self):
        if (self.settings["variant"] != "french" or not self.settings["announcements"]
                or self.settings["announcement_visibility"] == "hidden"
                or len(self.played) < 4 or not self.trick):
            return [[] for _ in range(4)]
        declaration = self._announcements_by_seat()
        best = [max((announcement_power(a, self.settings, self.bid) for i in team for a in declaration[i]), default=None)
                for team in ((0, 2), (1, 3))]
        if self.settings["announcement_competition"] == "both":
            winners = (0, 1)
        elif best[0] == best[1]:
            winners = ()
        else:
            winners = (int(best[1] is not None and (best[0] is None or best[1] > best[0])),)
        return [[{"kind": a["kind"], "value": a["value"], "cards": a["cards"]} for a in declaration[i]]
                if i % 2 in winners else [] for i in range(4)]

    async def _score_deal(self, last):
        if self.settings["variant"] == "french":
            await self._score_deal_french(last)
            return
        raw = list(self.trick_points)
        capot = next((team for team in (0, 1) if self.tricks_won[team] == 8), None)
        declaration = self._announcements_by_seat()
        # Reveal the claimed combinations only after all 32 cards were played.
        self.last_reveal = [[{"kind": item["kind"], "value": item["value"], "cards": item["cards"]}
                             for item in seat_items] for seat_items in declaration]
        if self.settings["announcements"] and (self.bid != "NT" or self.settings["no_trump_announcements"]):
            best = [max((announcement_power(a, self.settings) for i in team for a in declaration[i]), default=None)
                    for team in ((0, 2), (1, 3))]
            if self.settings["announcement_competition"] == "both":
                for team in (0, 1):
                    raw[team] += sum(a["value"] for i in (team, team + 2) for a in declaration[i])
            elif best[0] != best[1]:
                won = int(best[1] is not None and (best[0] is None or best[1] > best[0]))
                raw[won] += sum(a["value"] for i in (won, won + 2) for a in declaration[i])
        if self.settings["belote"] and self.bid != "NT":
            for i, suits in enumerate(self.belotes):
                raw[i%2] += 20 * len(suits)
        if self.bid == "NT":
            raw = [n * self.settings["no_trump_multiplier"] for n in raw]
        if capot is not None:
            raw[capot] += _capot_bonus(self.bid, self.settings)
        self.last_capot = capot is not None
        caller = self.bidder % 2
        scored = [0, 0]
        double = 0 if capot is not None and self.settings["capot_cancels_contra"] else self.double
        if raw[0] == raw[1]:
            if double:
                if self.settings["contra_tie_mode"] == "split":
                    scored = self._score_pair([n * (2 if double == 1 else 4) for n in raw])
                else:
                    self.hanging += self._score_value(sum(raw) * (2 if double == 1 else 4))
            else:
                if self.settings["tie_mode"] == "split":
                    scored = self._score_pair(raw)
                elif self.settings["tie_mode"] == "all_hangs":
                    self.hanging += self._score_value(sum(raw))
                else:
                    opponent = 1 - caller
                    if self.settings["rounding"] in ("balanced", "floor"):
                        scored[opponent] = raw[opponent] // 10
                    else:
                        scored[opponent] = self._score_value(raw[opponent])
                    self.hanging += self._score_value(sum(raw)) - scored[opponent]
        elif double:
            won = 0 if raw[0] > raw[1] else 1
            scored[won] = self._score_value(sum(raw) * (2 if double == 1 else 4))
        elif raw[caller] < raw[1-caller]:
            scored[1-caller] = self._score_value(sum(raw))
        else:
            scored = self._score_pair(raw)
        if raw[0] != raw[1] and self.hanging:
            scored[0 if raw[0] > raw[1] else 1] += self.hanging
            self.hanging = 0
        self.scores = [self.scores[i] + scored[i] for i in (0, 1)]
        self._log_deal(raw, scored)
        await self._broadcast_state(last, {"raw": raw, "awarded": scored, "scores": self.scores})
        await self._complete_deal(capot)

    async def _score_deal_french(self, last):
        card_points = list(self.trick_points)
        capot = next((team for team in (0, 1) if self.tricks_won[team] == 8), None)
        declaration = self._announcements_by_seat()
        self.last_reveal = [[{"kind": a["kind"], "value": a["value"], "cards": a["cards"]}
                             for a in items] for items in declaration]
        announced = [0, 0]
        if self.settings["announcements"]:
            best = [max((announcement_power(a, self.settings, self.bid) for i in team for a in declaration[i]), default=None)
                    for team in ((0, 2), (1, 3))]
            if self.settings["announcement_competition"] == "both":
                winners = (0, 1)
            elif best[0] == best[1]:
                winners = ()
            else:
                winners = (int(best[1] is not None and (best[0] is None or best[1] > best[0])),)
            for team in winners:
                announced[team] = sum(a["value"] for i in (team, team + 2) for a in declaration[i])
        belote = [0, 0]
        if self.settings["belote"]:
            for i, suits in enumerate(self.belotes):
                belote[i % 2] += 20 * len(suits)
        if capot is not None:
            card_points[capot] += self.settings["capot_bonus"]
        raw = [card_points[i] + announced[i] + belote[i] for i in (0, 1)]
        caller, defender = self.bidder % 2, 1 - self.bidder % 2
        scored = [0, 0]
        if capot is not None:
            scored[capot] = self._score_value(162 + self.settings["capot_bonus"] + sum(announced) + belote[capot])
            scored[1 - capot] = self._score_value(belote[1 - capot])
        elif raw[0] == raw[1]:
            if self.settings["tie_mode"] == "split":
                scored = self._score_pair(raw)
            elif self.settings["tie_mode"] == "all_hangs":
                self.hanging += self._score_value(sum(raw))
            else:
                scored[defender] = self._score_value(raw[defender])
                self.hanging += self._score_value(raw[caller])
        elif raw[caller] < raw[defender]:
            scored[defender] = self._score_value(162 + sum(announced) + belote[defender])
            scored[caller] = self._score_value(belote[caller])
        else:
            scored = self._score_pair(raw)
        if raw[0] != raw[1] and self.hanging:
            scored[0 if raw[0] > raw[1] else 1] += self.hanging
            self.hanging = 0
        self.last_capot = capot is not None
        self.scores = [self.scores[i] + scored[i] for i in (0, 1)]
        self._log_deal(raw, scored)
        await self._broadcast_state(last, {"raw": raw, "awarded": scored, "scores": self.scores})
        await self._complete_deal(capot)

    def _seat_stats(self, seat):
        """What the statistics page shows for the person sitting here, taken
        from the deal log: how many deals the team won, how many it bid, and how
        many of those bids it made."""
        team = seat % 2
        deals = [h for h in self.history if h.get("awarded")]
        won = bid = made = 0
        belotes = 0
        for h in deals:
            a = h["awarded"]
            won += 1 if a[team] > a[1 - team] else 0
            if h.get("bidder") is not None and h["bidder"] % 2 == team:
                bid += 1
                made += 1 if a[team] > a[1 - team] else 0
            b = h.get("belotes") or []
            belotes += b[seat] if seat < len(b) else 0
        n = len(deals)
        stats = {"deals": n, "deals_won": won, "contracts": bid, "contracts_made": made, "belotes": belotes}
        if n:
            stats["points_per_deal"] = self.scores[team] / n
        if bid:
            stats["contract_rate"] = 100.0 * made / bid
        return stats

    def _log_deal(self, raw, scored):
        self.history.append({"bid": self.bid, "bidder": self.bidder, "double": self.double,
                             "raw": list(raw), "awarded": list(scored),
                             "reveal": self.last_reveal, "belotes": [len(b) for b in self.belotes]})

    async def _complete_deal(self, capot):
        reached = max(self.scores) >= self.settings["target"]
        reached = reached and (self.settings["finish_after_capot"] or capot is None)
        reached = reached and (self.settings["finish_on_tie"] or self.scores[0] != self.scores[1])
        if reached or (self.settings["deals_limit"] and self.deals >= self.settings["deals_limit"]):
            self.phase = "finished"
            records = []
            for i, p in enumerate(self.seats):
                if p["bot"]:
                    continue
                team = i % 2
                records.append({"player_id": p["id"], "score": self.scores[team],
                                "rank": 1 if self.scores[team] >= self.scores[1-team] else 2,
                                "is_winner": self.scores[team] > self.scores[1-team],
                                "stats": self._seat_stats(i)})
            await self.ctx.finish(records, metadata={"variant": self.settings["variant"]})
        else:
            self.dealer = (self.dealer + 1) % 4
            await self._deal()

    def _state(self, pid, last=None, result=None):
        seat = next((i for i, p in enumerate(self.seats) if p["id"] == pid), None)
        return {"type": "bl_state", "seat": seat, "seats": self.seats,
                "hand": list(self.hands[seat]) if seat is not None else [],
                "counts": [len(h) for h in self.hands], "scores": self.scores, "hanging": self.hanging,
                "dealer": self.dealer, "deals": self.deals, "phase": self.phase,
                "upcard": self.upcard, "french_round": self.french_round,
                "bid": self.bid, "bidder": self.bidder, "double": self.double, "turn": self.turn,
                "trick": self.trick, "last": last, "result": result, "bids": self.bid_log, "bid_events": self.bid_events,
                "history": self.history, "belote_pub": {"done": [list(b) for b in self.belotes], "pending": [list(b) for b in self.belote_pending]},
                "last_winner": last[winner(last, self.bid)][0] if last else None,
                "announced": self._public_announcements(), "current_reveal": self._current_reveal(), "last_reveal": self.last_reveal,
                "legal": legal_for(self.hands[seat], self.trick, self.bid, self.settings, seat)
                if seat == self.turn and self.phase == "playing" else [],
                "contracts": self._bid_options() if self.phase == "bidding" else [],
                "can_contra": bool(seat == self.turn and self.settings["allow_contra"] and self.bid is not None and self.double == 0 and seat%2 != self.bidder%2),
                "can_recontra": bool(seat == self.turn and self.settings["allow_contra"] and self.double == 1 and seat%2 == self.bidder%2),
                "announcement_options": [{"id": a["id"], "kind": a["kind"], "cards": a["cards"], "value": a["value"]}
                    for a in announcement_options(self.original_hands[seat])]
                    if seat == self.turn and self.phase == "playing" and self.declared[seat] is None and self.settings["announcements"] and self.settings["announcements_mode"] == "declare" and (self.bid != "NT" or self.settings["no_trump_announcements"]) else [],
                "belote_cards": [c for c in self.hands[seat] if self._can_belote(seat, c)]
                    if seat == self.turn and self.phase == "playing" and self.settings["belote_mode"] == "declare" else [],
                "rebelote_cards": [c for c in self.hands[seat] if c[1] in self.belote_pending[seat] and c[0] in "KQ"]
                    if seat == self.turn and self.phase == "playing" and self.settings["variant"] == "french" else [],
                "ai_seats": self.ai_seats, "ai_say": self.ai_say,
                "rules": self.settings}

    async def _send_state(self, pid, last=None, result=None):
        if pid:
            await self.ctx.send(pid, self._state(pid, last, result))

    async def _broadcast_state(self, last=None, result=None):
        for p in self.seats:
            if not p["bot"]:
                await self._send_state(p["id"], last, result)

    def _progress(self):
        return (self.phase, self.turn, self.dealer, self.deals, self.french_round,
                len(self.bid_events), len(self.played), len(self.trick))

    async def _run_bots(self):
        """Play every bot whose turn it is, one after another, until a person
        has to act or the game is over. Nothing waits on a clock here: each
        table shows the moves in order, at its own pace."""
        if self._bots_running:
            return
        self._bots_running = True
        try:
            for _ in range(1000):
                if self.phase not in ("bidding", "playing") or not self.seats[self.turn]["bot"]:
                    return
                before = self._progress()
                self.bot_task += 1
                try:
                    await self._bot_move(self.bot_task)
                except Exception as e:
                    print(f"[belot] bot move error: {e!r}")
                if self._progress() == before:
                    # A bot that did not move must still not hold up the table.
                    try:
                        await self._bot_fallback()
                    except Exception as e:
                        print(f"[belot] bot fallback error: {e!r}")
                    if self._progress() == before:
                        print(f"[belot] bot at seat {self.turn} cannot move in phase {self.phase}")
                        return
        finally:
            self._bots_running = False

    async def _bot_fallback(self):
        seat = self.turn
        if not self.seats[seat]["bot"]:
            return
        if self.phase == "bidding":
            await self._bid(seat, "PASS")
        elif self.phase == "playing":
            options = legal_for(self.hands[seat], self.trick, self.bid, self.settings, seat)
            if options:
                await self._play(seat, options[0], None, True)

    async def _bot_move(self, token):
        seat = self.turn
        hand = self.hands[seat]
        if self.phase == "bidding":
            available = self._bid_options()
            if not available and not (self._bid_valid(seat, "CONTRA") or self._bid_valid(seat, "RECONTRA")):
                await self._bid(seat, "PASS")
                return
            choice, ranking = None, []
            if self.settings["variant"] != "french":
                try:
                    choice, ranking = _bot_choose_bid(self, seat, .2, detail=True)
                except Exception:
                    choice = None
            if choice is not None:
                if seat in self.ai_seats and len(ranking) > 1:
                    proposal = choice
                    choice = await self._mentor("bid", seat, choice, ranking, token)
                    if choice is None:
                        return
                    if not self._bid_valid(seat, choice):
                        choice = proposal
                await self._bid(seat, choice)
                return
            candidates = []
            for suit in available:
                if suit in SUITS:
                    cards = [c for c in hand if c[1] == suit]
                    value = sum(TRUMP_POINTS[c[0]] for c in cards) + len(cards)*4
                    if self.settings["variant"] == "french" and self.upcard[1] == suit:
                        value += TRUMP_POINTS[self.upcard[0]] + 4
                elif suit == "NT":
                    value = sum(CARD_POINTS[c[0]] for c in hand) * .65
                else:
                    value = sum(TRUMP_POINTS[c[0]] for c in hand) * .65
                candidates.append((value, suit))
            if not candidates:
                await self._bid(seat, "PASS")
                return
            value, choice = max(candidates)
            if value < 37:
                choice = "PASS"
            await self._bid(seat, choice)
        elif self.phase == "playing":
            options = legal_for(hand, self.trick, self.bid, self.settings, seat)
            if not options:
                return
            try:
                choice, ranking = _bot_choose_card(self, seat, .15, detail=True)
            except Exception:
                choice, ranking = None, []
            if choice is not None:
                if seat in self.ai_seats and len(ranking) > 1:
                    proposal = choice
                    choice = await self._mentor("card", seat, choice, ranking, token)
                    if choice is None:
                        return
                    if choice not in options:
                        choice = proposal
                belote = True
                if self._can_belote(seat, choice) and self.settings["variant"] != "french":
                    try:
                        belote = _bot_declare_belote(self, seat, choice)
                    except Exception:
                        belote = True
                await self._play(seat, choice, None, belote)
                return
            # Fallback: this bot's hand and the public trick only. Preserve
            # valuable high cards when a partner already wins; otherwise seek
            # the cheapest win.
            if self.trick:
                current = self.trick[winner(self.trick, self.bid)][0]
                wins = [c for c in options if winner(self.trick+[(seat,c)], self.bid) == len(self.trick)]
                if current % 2 == seat % 2:
                    choice = max(options, key=lambda c: (points(c, self.bid), -strength(c, self.bid)))
                elif wins:
                    choice = min(wins, key=lambda c: (points(c, self.bid), strength(c, self.bid)))
                else:
                    choice = min(options, key=lambda c: (points(c, self.bid), strength(c, self.bid)))
            else:
                choice = max(options, key=lambda c: (strength(c, self.bid) + points(c, self.bid)/5))
            await self._play(seat, choice, None, True)
