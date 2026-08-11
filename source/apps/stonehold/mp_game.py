"""
Stonehold — the server half of the game.

Loaded by Game Hub's multiplayer framework (backend/apps/gamehub/mp.py) by
convention: any app with an mp_game.py exposing `Game(ctx)` becomes playable in
Game Hub. The framework owns rooms, sockets, identity, reconnects, saving and
writing the finished session into the leaderboard; everything below is only
this game's rules.

What makes Stonehold different from a normal arcade run lives here rather than
in the browser: **the balance table**. Every cost, every per-level effect,
every rate is in BALANCE below and travels to the client inside sh_start. The
browser runs the simulation, but it does not own a single number — one place to
balance the game, and no way for the two halves to disagree about what a level
4 tower does.

The map is laid out here too, because the map is the game: one hold in the
middle of the world, four rival camps in the four corners, and the ground
between them. The camps are not a spawn point — they are four holds of their
own, with resources of their own, and they grow the same way the player's does.
The difference is what they spend it on: they build no towers and no walls,
only huts and barracks, and everything they raise walks at the player sooner or
later.

The browser simulates the live game (workers walking, towers firing, the four
camps growing) exactly the way Tower Defense does, and reports the whole world
back with sh_state. The server keeps that blob in the room, and it also writes
it down as it goes.

That last part is a safety net and nothing more. A hold does not live while
nobody is playing it: no time passes, nothing is gathered, no raid arrives, and
the run comes back on the exact frame it was left on. What the writing is for is
everything that can take a room away without the player deciding anything — a
reload, a lost connection, a backend that restarts under them. Rooms live in
memory, so without a written copy any of those ends the run outright, which is
not a rule anybody agreed to; it is just losing the evening.

The player's own decisions still decide what happens next, and they are the only
things that do:

  * "save & exit"                — the run is put down and picked up here.
  * throwing the run away in the
    hub, or answering "start over" — the written copy goes with it and the next
                                     game starts from bare ground.

So "I did not save" only ever means "I threw it away", never "the socket
dropped".
"""

# How often the live hold is written down, in seconds of play. Often enough that
# a crash costs a few seconds, rarely enough that it is one small write a minute
# and not one per frame.
AUTOSAVE_EVERY = 12.0

import math
import random

# ── Balance ──────────────────────────────────────────────────────────────────
# Shipped to the client in sh_start. Costs are for level 1 (building it); an
# upgrade to level n costs the level-1 cost times UPGRADE_MULT ** (n - 1).

# What a hold is made of. Wood is the beginning of everything: the first house,
# the first tower and the first spears are wooden. Stone comes in with the
# second level of anything, iron with the higher ones — and iron is what an army
# is armed with. There is no money: a hold has no market to sell to, so what it
# has is what it has dug out of the ground or taken off a dead raider.
RESOURCES = ("wood", "stone", "iron")

# The map version. A hold written down under an older layout is carried across
# rather than thrown away — see _migrate.
WORLD_VERSION = 2

BALANCE = {
    # A world big enough to hold five holds and the ground between them. The
    # four camps sit in the corners, far enough away that a war party is seen
    # coming and near enough that it always comes; where the player settles
    # between them is the player's own decision, made before anything is built.
    # "found_clear" is how much room a camp is left: settling on their doorstep
    # is not a choice, it is a mistake nobody would make twice.
    "world":  {"size": 4200, "keep_radius": 26, "found_clear": 900},
    # The keep is the hold's storehouse, not its factory: it holds rounds, it
    # does not make them. Nothing in a hold produces ammunition except a
    # workshop, and a workshop pays iron for every round — which is what makes
    # digging iron worth the walk. "store" is the room in the keep at level 1
    # and it grows with the keep, so a bigger keep is a deeper magazine for the
    # hold. keep_people is room in the keep itself: the hold starts with one
    # person living there, and that person builds the first house. Nothing is
    # ever built by the hold on its own — work happens where a person is
    # standing.
    # No rounds at the start, and no way to make one until a workshop stands:
    # ammunition is something the hold earns — dig the iron, forge it, carry
    # it — not something it is handed. The first raids are meant to be met by
    # walls and distance, which is what the opening timber is for.
    "start":  {"wood": 240, "stone": 0, "iron": 0,
               "ammo": 0, "store": 10, "store_step": 6,
               "keep_people": 1,
               # The keep is the hold: it is built to outlast the towers around it.
               "keep_hp": 4.0},
    "upgrade_mult": 1.7,
    # No ceiling, on either side of the map. The game is not a thing to finish:
    # it is a thing to last in, and a hold that has reached the top of its own
    # tree is a hold that cannot lose any more — which is the same as a hold
    # with nothing left to play for. The only ceiling anybody has is what they
    # can pay for, and every level costs "upgrade_mult" times the one before it,
    # so levels are earned more and more slowly and never stop being possible.
    # 0 means no limit; the number is kept so an installation can put one back.
    "max_level": 0,

    # How a level is paid for. The listed cost is always the wood; from the
    # level named in a building's "tier" it also wants stone, and higher up iron,
    # each a share of that same wood cost. So a hold's history is written in its
    # materials: wooden at first, stone once it is quarrying, iron once it has
    # been digging for a while.
    "tier_share": {"stone": 0.55, "iron": 0.35},

    "buildings": {
        # hp/effects below are level 1; each level multiplies hp by hp_step.
        "tower": {
            "cost": {"wood": 75}, "tier": {"stone": 2, "iron": 4},
            "build": 14, "hp": 220, "hp_step": 1.25,
            "size": 22, "range": 300, "range_step": 14,
            "damage": 34, "damage_step": 10,
            "reload": 1.10, "reload_step": -0.085, "reload_min": 0.35,
            # The magazine starts at a single round: a tower is only as useful
            # as the people willing to walk ammunition to it.
            "mag": 1, "mag_step": 2,
            "weapons_per": 3,           # +1 barrel every 3 levels
        },
        # A house is bought once and then it is done paying: the people who move
        # into it cost the hold nothing after it stands. That is what the price
        # is for. A per-head charge on top of it, taken every half minute out of
        # the same timber the player is trying to build with, meant a growing
        # hold could never put anything aside — the wood went as fast as it came
        # in and nobody could see where.
        "house": {
            "cost": {"wood": 80}, "tier": {"stone": 2, "iron": 5},
            "build": 10, "hp": 170, "hp_step": 1.2,
            "size": 21, "workers": 2, "workers_step": 1, "spawn": 26,
        },
        "workshop": {
            "cost": {"wood": 95}, "tier": {"stone": 2, "iron": 4},
            "build": 16, "hp": 180, "hp_step": 1.2,
            # Rounds are forged, not found: every one costs the hold iron, so a
            # workshop is only ever as busy as the iron coming in. With no iron
            # left it stands idle, and the towers go quiet a raid later.
            "size": 22, "rate": 0.10, "rate_step": 0.06,   # ammunition per second
            "iron_per_ammo": 0.5,
            # Finished rounds pile up at the workshop until somebody carries
            # them to the keep. Nothing teleports: a workshop across the map is
            # a longer supply line, and that is the cost of putting it there.
            "stock": 8, "stock_step": 6,
        },
        "barracks": {
            "cost": {"wood": 120}, "tier": {"stone": 2, "iron": 3},
            "build": 18, "hp": 210, "hp_step": 1.25,
            "size": 23, "interval": 40, "interval_step": -4, "interval_min": 14,
            "soldiers": 2, "soldiers_step": 1,
            "hp_soldier": 60, "hp_soldier_step": 18,
            "damage": 12, "damage_step": 5,
            # A level 1 barracks arms its people with wooden spears; from level 3
            # it is sending out iron, and every sortie costs the hold that iron.
            "arm": {"wood": 3}, "arm_iron_from": 3, "arm_iron": 2,
        },
        # A wall is the one building that changes material as it grows. Level 1
        # is a timber palisade — cheap, quick, and what a young hold can afford;
        # from level 2 it is being rebuilt in stone, so it stops asking for wood
        # altogether and asks for stone instead. "stone_from" is where the
        # rebuild happens: below it the cost is the wood line, at and above it
        # the wood is dropped and the stone line is used, which is why the jump
        # in integrity there is so much larger than a normal step.
        "wall": {
            "cost": {"wood": 16}, "tier": {"iron": 7},
            "stone_from": 2, "stone_cost": {"stone": 22}, "stone_hp": 2.2,
            "build": 3, "hp": 260, "hp_step": 1.35,
            "size": 15,
        },
    },

    "worker": {
        # People are not bought. They move into a house that is already paid
        # for, one every "spawn" seconds until it is full, and from then on they
        # only ever cost the hold work.
        "speed": 66,
        # Rounds are carried one at a time, workshop to keep and keep to tower
        # alike, so every number the player can see moves by exactly what
        # somebody is holding. There is no carry_ammo: it would only ever be 1.
        "build_rate": 1.0,
        "hp": 40,
    },

    # Digging, felling and quarrying, done straight out of the ground. There is
    # no building that stands on a deposit any more: a person walks to whichever
    # patch the hold is shortest of, works it where it lies and carries the load
    # home. What that costs is the walk, which is the whole of why where a hold
    # stands matters — and it is why iron, lying furthest out, is dear.
    "gather": {
        "wood":  {"load": 8, "time": 4.0},
        "stone": {"load": 6, "time": 5.0},
        "iron":  {"load": 4, "time": 6.5},
    },

    # What the map is made of. Every material can land anywhere, and how many of
    # each there are is drawn fresh for every hold — so no two maps open on the
    # same problem. Every hold on the map, the player's and the four camps
    # alike, is given ground of its own to work; the richest patches lie in the
    # middle ground between them, where nobody is safe.
    "deposit": {
        # A hold's own ground: the ring around it its people can work without
        # walking into somebody else's country.
        "near": 200,
        "far":  700,
        # The middle ground, measured from the centre of the world.
        "wild_near": 950,
        "wild_far":  1700,
        "per_site_min": 2, "per_site_max": 3,   # of each kind, around each hold
        "wild_min": 8, "wild_max": 14,
        # How much ground one holds. A deposit is a wood or a field of rock, not
        # a mark on the map: this is the radius a deposit of average richness
        # covers when it is untouched, scaled by how rich it rolled and closing
        # in as it is worked out. Nothing may be built on that ground, so the
        # number is a rule as much as a picture.
        "radius": 46,
        "min_radius": 12,
        "kinds": {
            "wood":  {"amount": 2400},
            "stone": {"amount": 2800},
            "iron":  {"amount": 1900},
        },
    },

    # ── The four camps ───────────────────────────────────────────────────────
    # They are holds, not waves. Each one sits in its own corner with its own
    # store, its own people digging its own ground, and its own buildings going
    # up one at a time — and the player can watch all of it happen. What they
    # never build is a tower or a wall: everything they earn goes into huts and
    # barracks, and everything a barracks musters eventually walks at the
    # player. Beating a war party off is therefore not just survival, it is a
    # bill: those arms were paid for out of that camp's store and have to be
    # earned again.
    "faction": {
        "inset": 520,                     # how far from the corner each camp sits
        "colors": ["#f38ba8", "#fab387", "#cba6f7", "#94e2d5"],
        "start": {"wood": 160, "stone": 40, "iron": 0},

        # Their keep is their level: everything else they may build, and every
        # soldier they arm, is measured off it.
        "keep": {"hp": 900, "hp_step": 1.35, "size": 26,
                 "cost": {"wood": 240, "stone": 130, "iron": 25}, "mult": 1.7},
        "hut": {"hp": 150, "size": 20, "build": 14,
                "cost": {"wood": 75, "stone": 15}, "workers": 2, "spawn": 22},
        "barracks": {"hp": 230, "size": 22, "build": 18,
                     "cost": {"wood": 140, "stone": 65},
                     "soldiers": 3, "soldiers_step": 1},
        # No ceiling here either, and this is the side of it that matters: a
        # camp that has finished growing is a camp the hold eventually outgrows
        # for good, and from that moment the game cannot be lost. They keep
        # levelling for as long as they can pay, and everything they may keep
        # standing is measured off that level with nothing capping it.
        "max_level": 0,
        "huts_base": 2, "huts_per_level": 1,
        "barracks_base": 1, "barracks_per_level": 0.5,

        "worker": {"speed": 58, "load": 7, "time": 4.5, "hp": 34},

        # Four camps that all want the same hold and none of which wants the
        # others: not one of them ever marches at a rival, because a party spent
        # on a neighbour is a party the player never has to meet. They do not
        # walk through each other either. Two of different colours who end up
        # within "reach" stop and fight it out where they stand, and the
        # survivors carry on to the hold. "body" is the room everybody else
        # keeps around them, so a crowd looks like a crowd instead of one man
        # drawn five times — see _meet in mp.js.
        "clash": {"reach": 18, "body": 15},

        # Arming one more soldier: how often, and what it costs the camp. The
        # wait is what one barracks takes, and every barracks arms its own men —
        # a camp with four of them arms four times as fast. Without that a camp
        # could raise barracks for ever and still send men at the rate of one
        # hut, so its parties would grow while its raids grew further and
        # further apart, which is the opposite of what a growing camp should
        # feel like.
        "muster": 30, "muster_step": -2.4, "muster_min": 9,
        "arm": {"wood": 6}, "arm_iron_from": 3, "arm_iron": 1.5,
        "soldier": {"hp": 42, "hp_step": 14,
                    "damage": 2.6, "damage_step": 0.9,
                    "speed": 44, "speed_step": 1.6},

        # A camp does not attack with what it happens to have: it fills every
        # barracks it owns and then sends the lot at once. The party is the
        # camp's whole standing army, so it grows with the barracks and with the
        # level of each of them at the same time — the one thing on the map that
        # grows faster than a hold's towers can be upgraded, and therefore the
        # reason a hold that stands long enough is a hold that eventually falls.
        # A camp used to keep most of its men at home behind a party limit,
        # which read as an army standing about watching its own raid lose.
        "ready_wait": 10,
        # Nobody comes in the first couple of minutes: a hold has to be allowed
        # to stand up before it is knocked down.
        "grace": 165,
        # Raiders do not carry money, because there is nothing to spend it on.
        # They carry what their camp armed them with. Kill one and the hold
        # keeps it.
        "loot": {
            "wood":  {"base": 3.0, "step": 1.0, "from": 1},
            "stone": {"base": 1.8, "step": 0.8, "from": 2},
            "iron":  {"base": 0.7, "step": 0.4, "from": 4},
        },
    },
}


class Game:
    def __init__(self, ctx):
        self.ctx        = ctx
        self.state      = None     # the whole world, as the browser last reported it
        self.over       = False
        self._written   = None     # play time at the last write-down, if any

    # ── Framework callbacks ──────────────────────────────────────────────────

    async def on_start(self, settings):
        # A saved hold is taken exactly as it was put down — same rounds in the
        # same magazines, same people standing where they stood. No time passes
        # for a hold nobody is playing.
        saved = self.ctx.saved_state
        if saved and isinstance(saved.get("state"), dict):
            self.state = _migrate(saved["state"])
        else:
            self.state = _new_hold(settings)
        await self.ctx.broadcast(self._start_msg())

    def snapshot(self):
        """Save & exit, asked for by the framework (solo only).

        The browser pushes the hold one last time immediately before asking to
        save, so the newest report is already here and this is the frame the
        player was looking at.
        """
        if self.over or not self.state:
            return None
        return {"state": self.state}

    async def on_join(self, player):
        # Reconnect: the room outlives a dropped socket, so a player coming
        # back gets the hold as it stood, not a fresh one.
        if self.state is not None:
            await self.ctx.send(player["id"], self._start_msg())

    async def on_message(self, player, msg):
        kind = msg.get("type", "")

        if kind == "sh_state":
            state = msg.get("state")
            if isinstance(state, dict) and not self.over:
                self.state = state
                self._keep_a_copy()
            return

        if kind == "sh_over":
            if self.over:
                return
            self.over = True
            state = msg.get("state")
            if isinstance(state, dict):
                self.state = state
            # The hold fell: there is nothing left to continue, so the save goes
            # with it and the run becomes a session on the leaderboard.
            self.ctx.clear_save(self.ctx.host_id)
            await self._finish()
            return

    # ── Internals ────────────────────────────────────────────────────────────

    def _keep_a_copy(self):
        """Write the hold down where a lost room cannot take it.

        Rooms are in memory. A browser reload is survivable without this — the
        room is still there and on_join hands the hold back — but a backend that
        restarts takes every room with it, and the player did nothing to deserve
        that. So the newest report is written every AUTOSAVE_EVERY seconds of
        play, into the same one row "save & exit" writes: the run has exactly one
        place it can be picked up from, whichever way it was put down.

        Play time is what paces it, not the clock, so a paused game does not keep
        writing the same hold over and over.
        """
        if self.over:
            return
        elapsed = float(self.state.get("elapsed") or 0)
        # A resumed hold carries its elapsed on, and a fresh one starts at zero:
        # either way, only going forwards by the interval is a new write.
        if self._written is not None and 0 <= elapsed - self._written < AUTOSAVE_EVERY:
            return
        self._written = elapsed
        self.ctx.save_state(self.ctx.host_id, {"state": self.state})

    def _start_msg(self) -> dict:
        return {
            "type":    "sh_start",
            "tuning":  BALANCE,
            "state":   self.state,
            "resumed": bool(self.ctx.resume),
        }

    async def _finish(self):
        s = self.state or {}
        stats = s.get("stats") or {}
        score = int(stats.get("score", 0))
        facs = s.get("factions") or []
        await self.ctx.finish(
            [{"player_id": self.ctx.host_id, "score": score, "rank": 1,
              # A solo run has nobody to beat, so it is not a "win".
              "is_winner": False}],
            metadata={
                # How long the hold stood, which is the same thing as how long
                # it was played: it only exists while somebody is holding it.
                "hours":    round(float(s.get("elapsed", 0)) / 3600, 1),
                "kills":    int(stats.get("kills", 0)),
                "raids":    int(stats.get("raids", 0)),
                "enemy":    max([int(f.get("lvl", 1)) for f in facs] or [1]),
                "buildings": len(s.get("buildings") or []),
            },
        )


# ── Laying out a world ───────────────────────────────────────────────────────

def _dep_radius(kind: str, amount: float) -> float:
    """How much ground an untouched deposit of this size covers.

    The same sum the client draws it by, kept here because the map is laid out
    here: a wood has to be given room for the wood it is going to be, not for
    the dot the map used to draw.
    """
    dep  = BALANCE["deposit"]
    base = dep["kinds"][kind]["amount"]
    rich = max(0.6, min(1.6, amount / base))
    return dep["radius"] * rich


def _corners():
    """Where the four camps stand, in reading order: NW, NE, SW, SE."""
    s = BALANCE["world"]["size"]
    i = BALANCE["faction"]["inset"]
    return [(i, i), (s - i, i), (i, s - i), (s - i, s - i)]


def _sites():
    """The four camps and the middle of the map. Deposits are laid around these,
    and nothing is ever built on top of one.

    The middle is nobody's any more — the player settles where they like — but it
    is still seeded with a cluster of every material, so that the centre is one
    honest answer to "where do I go" among the ones scattered around it rather
    than a bare patch the map is telling you to avoid."""
    s = BALANCE["world"]["size"]
    return [(s / 2, s / 2)] + _corners()


def _lay_deposits(rnd) -> list:
    """The ground, scattered so that every camp has some and the rest is out
    there to be found.

    Each site — the four camps and the middle of the map — gets its own small
    cluster of every material. Everything else is dropped across the middle
    ground, which is both what the player reads before choosing where to settle
    and where a hold that wants to grow has to go looking afterwards.
    """
    dep = BALANCE["deposit"]
    w   = BALANCE["world"]["size"]
    out = []
    sites = _sites()

    def place(cx, cy, kind, near, far, tries=50):
        for _ in range(tries):
            ang  = rnd.random() * math.tau
            dist = near + rnd.random() * (far - near)
            x, y = cx + math.cos(ang) * dist, cy + math.sin(ang) * dist
            amount = dep["kinds"][kind]["amount"] * (0.7 + rnd.random() * 0.8)
            r = _dep_radius(kind, amount)
            if not (r + 30 < x < w - r - 30 and r + 30 < y < w - r - 30):
                continue
            # Never on top of a hold: a camp with a forest growing through its
            # keep is not a thing the map can mean.
            if any(math.hypot(x - sx, y - sy) < r + 120 for sx, sy in sites):
                continue
            # Ground, not markers: two of them may lie side by side but never
            # one inside the other.
            if any(math.hypot(x - o["x"], y - o["y"])
                   < r + _dep_radius(o["kind"], o["max"]) + 34 for o in out):
                continue
            out.append({"id": len(out) + 1, "x": round(x, 1), "y": round(y, 1),
                        "kind": kind, "amount": round(amount), "max": round(amount)})
            return True
        return False

    for cx, cy in sites:
        for kind in dep["kinds"]:
            for _ in range(rnd.randint(dep["per_site_min"], dep["per_site_max"])):
                place(cx, cy, kind, dep["near"], dep["far"])

    kinds = list(dep["kinds"])
    for _ in range(rnd.randint(dep["wild_min"], dep["wild_max"])):
        place(w / 2, w / 2, rnd.choice(kinds), dep["wild_near"], dep["wild_far"])
    return out


def _new_factions() -> list:
    """Four camps, one to a corner, each starting exactly where the player does:
    a keep, a couple of people and a pile of timber. What they do with it is
    the game."""
    f = BALANCE["faction"]
    out = []
    for i, (cx, cy) in enumerate(_corners()):
        out.append({
            "id": i,
            "x": cx, "y": cy,
            "color": f["colors"][i % len(f["colors"])],
            "wood": f["start"]["wood"], "stone": f["start"]["stone"],
            "iron": f["start"]["iron"],
            "lvl": 1,
            "buildings": [{"id": 1, "type": "keep", "x": cx, "y": cy, "lvl": 1,
                           "hp": f["keep"]["hp"], "built": 1.0}],
            "next_id": 2,
            "workers": [{"x": cx + 20, "y": cy + 22}, {"x": cx - 22, "y": cy + 18}],
            "army": [],
            "spawn": 0.0, "muster": 0.0, "ready": 0.0,
            "grace": f["grace"],
            "stats": {"sent": 0, "lost": 0, "built": 0},
        })
    return out


def _new_hold(settings) -> dict:
    """A pile of timber, four camps in the corners, the ground lying wherever the
    map put it — and no hold yet.

    Nothing is placed for the player any more. The deposits are the map, and
    everything a hold becomes is decided by where they landed, so where the keep
    goes is the first decision of the game rather than the one decision it was
    never given: the map is handed over with "founding" set, and the browser
    puts the keep and the first person down wherever the player says. Until then
    no time passes and the camps do not stir — see _update in mp.js.

    The deposits are drawn once, kept in the state and never redrawn.
    """
    seed = random.randint(1, 2 ** 31 - 1)
    rnd  = random.Random(seed)
    w    = BALANCE["world"]

    st = BALANCE["start"]
    return {
        "seed":       seed,
        "world":      WORLD_VERSION,
        "world_size": w["size"],
        "elapsed":  0.0,      # time played, which is what the score is made of
        "wood":     st["wood"],
        "stone":    st["stone"],
        "iron":     st["iron"],
        "ammo":     st["ammo"],
        # A hold opens on "balanced": everyone judges for themselves what the
        # hold is short of. The three narrow priorities are what a player
        # reaches for when they want one thing done and nothing else.
        "priority": "balanced",
        "deposits": _lay_deposits(rnd),
        # Nothing stands anywhere yet. The keep — a tower that cannot be sold
        # and whose loss ends the run — and the hold's first person are both put
        # down by the player, in one go, wherever they choose to settle.
        "founding": True,
        "buildings": [],
        "next_id":  1,
        "workers":  [],
        "soldiers": [],
        # Whoever is on the field on their way to the hold. They belong to the
        # camp that armed them and they are carried in the save, so a war party
        # halfway across the map is still halfway across it tomorrow.
        "raiders":  [],
        "factions": _new_factions(),
        "stats":    {"score": 0, "kills": 0, "raids": 0, "lost": 0, "built": 0},
    }


def _migrate(st: dict) -> dict:
    """Carry a hold written down under an older map across to this one.

    A save is somebody's evening, so nothing is thrown away that can be moved
    instead. The world grew and gained four camps, and the buildings that used
    to stand on a deposit are gone — their people now work the ground where it
    lies. So: everything on the map is shifted to the middle of the bigger
    world, deposits are given the identity they now need, the removed buildings
    are refunded, and the camps are put in the corners of the world the hold
    now finds itself in.
    """
    if not isinstance(st, dict):
        return st
    if int(st.get("world") or 0) >= WORLD_VERSION:
        return st

    size = BALANCE["world"]["size"]
    old  = float(st.get("world_size") or 2200)
    if old != size:
        d = (size - old) / 2.0
        for b in (st.get("buildings") or []):
            b["x"] = b.get("x", 0) + d
            b["y"] = b.get("y", 0) + d
        for key in ("workers", "soldiers", "deposits"):
            for u in (st.get(key) or []):
                u["x"] = u.get("x", 0) + d
                u["y"] = u.get("y", 0) + d
    st["world_size"] = size

    # Deposits are worked directly now, so each one has to be nameable.
    for i, d in enumerate(st.get("deposits") or []):
        d.setdefault("id", i + 1)
        d.setdefault("max", d.get("amount", 1))

    # The extractors are gone. Half of what they cost comes back, exactly as
    # though the player had pulled them down themselves.
    keep_types = set(BALANCE["buildings"])
    kept = []
    for b in (st.get("buildings") or []):
        if b.get("keep") or b.get("type") in keep_types:
            kept.append(b)
            continue
        for res, n in _spent(b.get("type"), int(b.get("lvl") or 1)).items():
            st[res] = (st.get(res) or 0) + round(n / 2)
    st["buildings"] = kept

    st.setdefault("raiders", [])
    # A hold written down before the player was asked where to settle already
    # has its keep, so it is not founding anything.
    st.setdefault("founding", False)
    if not st.get("factions"):
        st["factions"] = _new_factions()
    # The old single enemy clock has nobody to keep time for any more.
    st.pop("enemy", None)
    # Ground for the camps to work, since the old map was laid out for one hold.
    _top_up_deposits(st)
    st["world"] = WORLD_VERSION
    return st


def _top_up_deposits(st: dict) -> None:
    """Give every camp on an older map some ground of its own to work."""
    dep = BALANCE["deposit"]
    w   = BALANCE["world"]["size"]
    rnd = random.Random(int(st.get("seed") or 1) ^ 0x5730)
    out = st.get("deposits") or []
    nid = max([int(d.get("id") or 0) for d in out] or [0])
    for cx, cy in _corners():
        for kind in dep["kinds"]:
            near = [d for d in out if d.get("kind") == kind
                    and math.hypot(d["x"] - cx, d["y"] - cy) < dep["far"] + 200]
            for _ in range(max(0, dep["per_site_min"] - len(near))):
                for _try in range(50):
                    ang  = rnd.random() * math.tau
                    dist = dep["near"] + rnd.random() * (dep["far"] - dep["near"])
                    x, y = cx + math.cos(ang) * dist, cy + math.sin(ang) * dist
                    amount = dep["kinds"][kind]["amount"] * (0.7 + rnd.random() * 0.8)
                    r = _dep_radius(kind, amount)
                    if not (r + 30 < x < w - r - 30 and r + 30 < y < w - r - 30):
                        continue
                    if any(math.hypot(x - sx, y - sy) < r + 120 for sx, sy in _sites()):
                        continue
                    if any(math.hypot(x - o["x"], y - o["y"])
                           < r + _dep_radius(o["kind"], o.get("max", amount)) + 34
                           for o in out):
                        continue
                    nid += 1
                    out.append({"id": nid, "x": round(x, 1), "y": round(y, 1),
                                "kind": kind, "amount": round(amount),
                                "max": round(amount)})
                    break
    st["deposits"] = out


def _cost(kind: str, lvl: int) -> dict:
    """What one level of a building costs. Mirrors _cost in mp.js."""
    b = BALANCE["buildings"].get(kind)
    if not b:
        # A building this version no longer has: price it as the timber it was.
        return {"wood": 60 * max(1, int(lvl))}
    lvl = max(1, int(lvl))
    m = BALANCE["upgrade_mult"] ** (lvl - 1)
    base = b["stone_cost"] if (b.get("stone_from") and lvl >= b["stone_from"]) else b["cost"]
    out = {res: round(base[res] * m) for res in RESOURCES if base.get(res)}
    wood = base.get("wood", 0) * m
    for res, at in (b.get("tier") or {}).items():
        if lvl >= at and wood:
            out[res] = out.get(res, 0) + round(wood * BALANCE["tier_share"][res])
    return out


def _spent(kind: str, lvl: int) -> dict:
    """Everything ever put into a building, level 1 up to this one."""
    total: dict = {}
    for l in range(1, max(1, int(lvl)) + 1):
        for res, n in _cost(kind, l).items():
            total[res] = total.get(res, 0) + n
    return total


def _max_hp(kind: str, lvl: int, keep: bool = False) -> float:
    """Integrity at this level. Mirrors _maxHp in mp.js.

    Stone is not a bigger palisade, it is a different wall: the level the
    rebuild happens at multiplies what everything above it is worth.
    """
    b = BALANCE["buildings"][kind]
    lvl = max(1, int(lvl))
    hp = b["hp"] * (b.get("hp_step", 1) ** (lvl - 1))
    if b.get("stone_from") and lvl >= b["stone_from"]:
        hp *= b.get("stone_hp", 1)
    return hp * (BALANCE["start"]["keep_hp"] if keep else 1)
