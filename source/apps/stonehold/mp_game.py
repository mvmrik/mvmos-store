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
    # hold. keep_people is room in the keep itself, and it is zero: nobody lives
    # in a storehouse. Every person in the game comes out of a house, on both
    # sides of the map — which is why the first house of a hold, and the first
    # hut of a camp, cost nothing. That is the whole opening: the keep goes
    # down, the free house goes down beside it, somebody moves in, and from
    # there everything is worked for.
    # Nothing in the store, no rounds and nobody standing: ammunition is
    # something the hold earns — dig the iron, forge it, carry it — never
    # something it is handed, and the first raids are meant to be met by walls
    # and distance, which come out of the ground as well.
    "start":  {"wood": 0, "stone": 0, "iron": 0,
               "ammo": 0, "store": 10, "store_mult": 1.5,
               "keep_people": 0,
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

    # What the second one of anything costs. Every building type carries a
    # "repeat": the next one of that kind is priced at repeat ** (how many the
    # hold already has), so a fourth house is not a first house.
    #
    # This is the other half of the same rule the multiplied stats are: a level
    # costs upgrade_mult more and is worth about that much more, while another
    # building of the same kind repeats what is already standing and is charged
    # for repeating it. Without it, twenty level 1 houses beat one level 5 house
    # on every number that matters, which made every upgrade in the game a
    # mistake. Upgrading is never charged the repeat — the level is the thing
    # the hold is meant to buy.
    #
    # Wide is still a real choice, and it is meant to be: towers cover ground
    # that a taller tower cannot reach, and walls have no repeat charge at all.
    # It is simply no longer the cheap one.

    "buildings": {
        # hp/effects below are level 1; each level multiplies hp by hp_step.
        "tower": {
            "cost": {"wood": 75}, "tier": {"stone": 2, "iron": 4},
            "repeat": 1.60,
            "build": 14, "hp": 220, "hp_step": 1.28,
            "size": 22, "range": 300, "range_step": 14,
            # Multiplied, not stepped, and this is the whole reason: a level
            # costs 1.7 times the level below it, so anything a level is bought
            # for has to grow at about that rate or the level is never worth
            # buying. A tower that gained a flat +10 was always beaten by simply
            # putting up another tower for the price of the first.
            "damage": 34, "damage_mult": 1.45,
            "reload": 1.10, "reload_step": -0.085, "reload_min": 0.35,
            # The magazine starts at a single round: a tower is only as useful
            # as the people willing to walk ammunition to it. It is also the
            # quietest reason to build tall — one deep tower is one place to
            # carry rounds to, five shallow ones are five.
            "mag": 1, "mag_step": 3,
            # And what one volley takes out of it. A bigger tower throws a
            # heavier round, so the magazine is not simply deeper as it grows —
            # this is what keeps ammunition, and the people carrying it, the
            # thing a hold actually lives or dies on. Without it a tower that
            # had outgrown the camps killed a whole war party out of a magazine
            # it barely dented, and nothing the four corners did afterwards
            # mattered.
            "ammo_per": 1, "ammo_per_step": 0.45,
            "weapons_per": 3,           # +1 barrel every 3 levels
        },
        # A house is bought once and then it is done paying: the people who move
        # into it cost the hold nothing after it stands. That is what the price
        # is for. A per-head charge on top of it, taken every half minute out of
        # the same timber the player is trying to build with, meant a growing
        # hold could never put anything aside — the wood went as fast as it came
        # in and nobody could see where.
        # Room, and the only thing on the map that makes people. Every level
        # adds as many tenants as the level it is: 1, then +2, then +3, then
        # +4 — so a house holds 1, 3, 6, 10, 15. A second house is a repeat of
        # the first and is priced as one; the level is the thing that is
        # actually worth buying, which is what "build wide" used to be.
        "house": {
            "cost": {"wood": 80}, "tier": {"stone": 2, "iron": 4},
            "repeat": 1.50,
            # The first one is free, and stands the moment it is placed: there
            # is nobody in the hold yet to raise it, and nobody arrives until it
            # is up. It is the other half of the keep, not a building decision —
            # the decisions start with the second house.
            "first_free": True,
            "build": 10, "hp": 170, "hp_step": 1.25,
            "size": 21,
            # People do not move in the instant the roof is on. The wait is the
            # hold's, not the house's, and the best house in it sets the pace:
            # somewhere good to live is somewhere people come to sooner.
            "spawn": 26, "spawn_step": -2, "spawn_min": 12,
        },
        "workshop": {
            "cost": {"wood": 95}, "tier": {"stone": 2, "iron": 3},
            "repeat": 2.00,
            "build": 16, "hp": 180, "hp_step": 1.25,
            # Rounds are forged, not found: every one costs the hold iron, so a
            # workshop is only ever as busy as the iron coming in. With no iron
            # left it stands idle, and the towers go quiet a raid later.
            "size": 22, "rate": 0.10, "rate_mult": 1.75,   # ammunition per second
            # A better forge wastes less of what it is given, so iron is one of
            # the things a level buys outright. This is also the answer to a
            # hold whose towers have outgrown its mine: forge deeper, not wider.
            "iron_per_ammo": 0.5, "iron_per_ammo_step": -0.03,
            "iron_per_ammo_min": 0.25,
            # Finished rounds pile up at the workshop until somebody carries
            # them to the keep. Nothing teleports: a workshop across the map is
            # a longer supply line, and that is the cost of putting it there.
            "stock": 8, "stock_step": 8,
        },
        # A garrison grows two ways at once: one more man per level, and each
        # man worth more than the last. Multiplied damage and integrity are what
        # keep a level ahead of a second barracks, which only ever repeats the
        # men the first one already has.
        "barracks": {
            "cost": {"wood": 120}, "tier": {"stone": 2, "iron": 3},
            "repeat": 1.50,
            "build": 18, "hp": 210, "hp_step": 1.28,
            "size": 23, "interval": 40, "interval_step": -4, "interval_min": 14,
            "soldiers": 2, "soldiers_step": 1,
            "hp_soldier": 60, "hp_soldier_mult": 1.22,
            "damage": 12, "damage_mult": 1.22,
            # Wooden spears at first; stone-headed from level 2, and iron from
            # level 3 — every sortie is paid for out of what the hold has dug,
            # so a deep barracks is a standing bill as well as a garrison.
            "arm": {"wood": 3}, "arm_stone_from": 2, "arm_stone": 1.5,
            "arm_iron_from": 3, "arm_iron": 2,
        },
        # A wall is the one building that changes material as it grows. Level 1
        # is a timber palisade — cheap, quick, and what a young hold can afford;
        # from level 2 it is being rebuilt in stone, so it stops asking for wood
        # altogether and asks for stone instead. "stone_from" is where the
        # rebuild happens: below it the cost is the wood line, at and above it
        # the wood is dropped and the stone line is used, which is why the jump
        # in integrity there is so much larger than a normal step.
        "wall": {
            "cost": {"wood": 16}, "tier": {"iron": 5},
            "stone_from": 2, "stone_cost": {"stone": 22}, "stone_hp": 2.2,
            # Iron comes in later here than anywhere else, and on purpose: a
            # wall is built by the length, so every level is paid for once per
            # piece. Asking for iron as early as a tower does would make a
            # ring of stone a thing nobody could afford to raise at all.
            "build": 3, "hp": 260, "hp_step": 1.60,
            "size": 15,
            # The one building with no repeat charge on it. A wall is meant to
            # be built in numbers — a line of them is the point — so the second
            # length costs what the first did, and only the level is dear.
            "repeat": 1.0,
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
        # What standing on somebody else's patch is worth in walking. Picking
        # ground is a price — there and back, plus this for every person
        # already digging it — so a crowded patch nearby still beats empty
        # ground across the map, and stops beating it once the crowd is real.
        # Raise it to spread the hold out, lower it to keep everyone close.
        "share_penalty": 300,
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

    # What the map is made of, and it is thrown rather than laid. Every patch
    # lands where it lands: a material picked at random, dropped anywhere in the
    # world, kept if there is room for it. Nobody is given ground of their own —
    # not the camps, and not the player — so a map can open on a corner buried
    # in timber and a corner with nothing near it, and both of those are the
    # map you were dealt.
    #
    # It used to be laid out instead: a cluster of every material around each of
    # the four corners and another in the middle, then the rest scattered in a
    # ring between them. It read exactly like what it was — five neat piles and
    # a fair share for everybody — and it made every map the same map. Where a
    # hold settles is the first decision of the game, and it is only a decision
    # if the ground is worth reading. Nothing here knows where anybody lives.
    "deposit": {
        # How many patches the world is given. Rolled fresh per map, so even the
        # amount of ground out there is something to be found out.
        "count_min": 38, "count_max": 58,
        # The one thing position still respects: nobody wakes up with a forest
        # growing through their keep. This is the room left around each camp,
        # and it is the only reason a throw is ever rejected for where it fell.
        "clear": 120,
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
    # They are holds, not waves — and that is meant literally: a camp is priced,
    # housed, manned and armed off the very tables above, the ones the player
    # plays by. Their roof is a house, their barracks is a barracks, their men
    # are that barracks' men, and their keep costs what the hold's keep costs.
    # There is not a number in this block that undercuts or outbids the player.
    #
    # ONE thing is theirs alone, and it is "pace": the fraction of the player's
    # speed everything a camp does over time runs at. It is 1.0 — they are not
    # slowed at all — and if the opening ever feels wrong, this is the number to
    # move, because there is nothing else left to move.
    #
    # What they never build is a tower, a wall or a workshop: everything they
    # earn goes into roofs and barracks, and everything a barracks musters
    # eventually walks at the player. Beating a war party off is therefore not
    # only survival, it is a bill: those arms were paid for out of that camp's
    # store and have to be earned again.
    "faction": {
        "inset": 520,                     # how far from the corner each camp sits
        "colors": ["#f38ba8", "#fab387", "#cba6f7", "#94e2d5"],
        # Nothing in the store, the same as the hold. They used to open with
        # enough to pay for a second hut outright, which meant the second hut
        # was standing before anybody had dug a single load — a camp was two
        # roofs and two people deep while the player was still saving for the
        # first decision of the game. Their head start is not a gift any more:
        # it is the free hut they are given, exactly as the hold is, and
        # everything past it is worked for at "pace".
        "start": {"wood": 0, "stone": 0, "iron": 0},

        # Their keep is their level, and it is bought the way the hold buys the
        # level of its own keep — off "tower", which is what a keep is under the
        # skin. Their roof is "house" and their barracks is "barracks", read
        # straight out of the tables above: same price, same repeat charge, same
        # tier of stone and iron, same room under the roof, same men. There is
        # nothing to list here because there is nothing of their own left.
        #
        # No ceiling either, and this is the side of it that matters: a camp
        # that has finished growing is a camp the hold eventually outgrows for
        # good, and from that moment the game cannot be lost. They keep
        # levelling for as long as they can pay.
        "max_level": 0,

        # The one number that is theirs. Everything a camp does over time runs
        # at this fraction of the hold's speed: what its people carry home per
        # trip, how fast a building goes up, how long a roof takes to fill, how
        # long it takes to arm one more man. Nothing about them is cheaper,
        # stronger or roomier than the player's — only slower, and by exactly
        # this much.
        #
        # It is NOT 0.25, and the reason is worth writing down, because a
        # quarter is the number anybody reaches for when there are four of
        # them. A hold does not grow at a steady rate: people dig, digging buys
        # roofs, roofs make people. Slow that loop to a quarter and a camp does
        # not end up a quarter of a hold — it ends up where the hold was a
        # quarter of the way through the game, and the gap between those two
        # goes on widening for as long as anybody is playing. At 0.25 the four
        # corners together hold about a third of the hold's people by the two
        # hour mark and fall further behind every minute after it, which is a
        # game that cannot be lost and therefore is not a game.
        #
        # 0.4 was the rate at which the four of them together tracked one hold
        # instead of falling off it. It is 1.0 now, on purpose: a camp works at
        # exactly the player's speed, and the four corners are four holds. This
        # is the state to measure from — the hold still keeps every advantage
        # the map gives it and the camps do not have (towers that shoot back,
        # walls, a workshop, and the choice of where to stand), so whatever
        # handicap they end up needing should be read off a game where the
        # numbers themselves are level, not guessed at. When the time comes to
        # slow them down again, the paragraph above is why the number to reach
        # for is not a quarter.
        "pace": 1.0,

        # How far out of its corner a camp will look for a load first. It is a
        # preference, not a fence: on a map where the ground falls where it
        # falls, a camp with nothing inside this circle walks further rather
        # than sitting still — the same choice the player makes when the near
        # ground runs out.
        "range": 1500,

        # Four camps that all want the same hold and none of which wants the
        # others: not one of them ever marches at a rival, because a party spent
        # on a neighbour is a party the player never has to meet. They do not
        # walk through each other either. Two of different colours who end up
        # within "reach" stop and fight it out where they stand, and the
        # survivors carry on to the hold. "body" is the room everybody else
        # keeps around them, so a crowd looks like a crowd instead of one man
        # drawn five times — see _meet in mp.js.
        "clash": {"reach": 18, "body": 15},

        # Arming one more man is the hold's own barracks line, slowed by "pace":
        # the wait is "interval" at the camp's level, every barracks arms its
        # own men so a camp with four of them arms four times as fast, and what
        # a man costs is "arm" — wooden spears low down, stone from the second
        # level and iron from the third. A camp's soldier is a hold's soldier:
        # the same integrity and the same damage at the same level, out of the
        # same table. They are not weaker men fielded in numbers; they are the
        # player's men, mustered at a quarter of the player's speed.
        #
        # The one thing a hold's garrison never needs is a way to cross a map,
        # because it never leaves the ring it patrols. A raider does, so this is
        # the walk out to the hold and nothing else.
        "march": {"speed": 44, "speed_step": 1.6},

        # A camp does not attack with what it happens to have: it fills every
        # barracks it owns and then sends the lot at once. The party is the
        # camp's whole standing army, so it grows with the barracks and with the
        # level of each of them at the same time — the one thing on the map that
        # grows faster than a hold's towers can be upgraded, and therefore the
        # reason a hold that stands long enough is a hold that eventually falls.
        # A camp used to keep most of its men at home behind a party limit,
        # which read as an army standing about watching its own raid lose.
        "ready_wait": 10,
        # Nobody marches on a hold nobody has looked at. A camp sends one man
        # over — unarmed, and untouchable, because nothing a hold owns shoots
        # at somebody who is not attacking it. He walks to the hold, goes round
        # it, counts the towers he can see and walks home, and only then does
        # the camp decide anything.
        #
        # What it decides on is what he counted, and nothing else. A tower
        # fires once per level, so a tower is worth its level in men: two at
        # level 1 and one at level 3 come to five, and a camp holding four men
        # stays at home and keeps growing. This is the whole of their
        # aggression — there is no timer any more, and no raid that was decided
        # before anyone looked.
        #
        # The report is a snapshot and it goes stale on purpose. A tower
        # finished after the scout turned for home is a tower nobody counted,
        # and the party that arrives was sized for the hold as it was. That
        # window is the player's, and it is why the minutes after a scout walks
        # away are the wrong minutes to stop building. What they knew is spent
        # with the party: the next raid needs a new pair of eyes.
        "scout": {
            "every": 120,   # from one scout coming home to the next setting out
            "speed": 70,    # quicker than a soldier: he is carrying nothing
            "sight": 340,   # how far he can count towers from where he walks
            "ring": 210,    # how close to the keep he goes round it
            "look": 14,     # seconds spent walking round before he turns back
        },

        # Nobody sets out under four, however few a camp happens to hold. This
        # is the whole of the early game: a camp's first barracks holds three,
        # so its first raid waits for the second level of its keep — which
        # wants iron it is not digging for anything else yet. Without it a camp
        # marched the moment its first three men were armed, which arrived
        # while the hold was still one tower and a workshop. It stops mattering
        # from level 2 on and is never felt again.
        "party_min": 4,
        # Nobody comes in the first minutes: a hold has to be allowed to stand
        # up before it is knocked down. And the corners do not come at once —
        # each camp waits "grace_step" longer than the one before it, so the
        # map opens as a series of raids rather than four at the same instant.
        # Being caught between two is then a thing that happens because of
        # where you settled, not because all four share a clock.
        "grace": 240, "grace_step": 40,
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
    """The four camps. Nothing is ever built on top of one, and nothing is ever
    thrown on top of one — which is now the whole of what this is for. The
    middle of the map is not one of them any more: it is ground like any other,
    and it is worth settling on only if the throw happened to favour it."""
    return _corners()


def _lay_deposits(rnd) -> list:
    """The ground, thrown at the map.

    Every patch is a material picked at random, dropped anywhere in the world,
    and kept if it lands clear of a camp and clear of everything already down.
    That is the whole of it. Nothing counts what each corner ended up with,
    nothing evens it out, and nothing is reserved for anybody — so a map can
    open on iron piled in the north and none in the south, and the player who
    reads that before putting the keep down is playing the game the map is for.
    """
    dep   = BALANCE["deposit"]
    w     = BALANCE["world"]["size"]
    kinds = list(dep["kinds"])
    sites = _sites()
    out   = []

    want = rnd.randint(dep["count_min"], dep["count_max"])
    # Tries, not places: a throw that lands badly is simply lost, so a crowded
    # map ends up with fewer patches than a roomy one rather than with the same
    # number squeezed together.
    for _ in range(want * 6):
        if len(out) >= want:
            break
        kind   = rnd.choice(kinds)
        amount = dep["kinds"][kind]["amount"] * (0.7 + rnd.random() * 0.8)
        r      = _dep_radius(kind, amount)
        x = r + 30 + rnd.random() * (w - 2 * (r + 30))
        y = r + 30 + rnd.random() * (w - 2 * (r + 30))
        # Never on top of a hold: a camp with a forest growing through its keep
        # is not a thing the map can mean.
        if any(math.hypot(x - sx, y - sy) < r + dep["clear"] for sx, sy in sites):
            continue
        # Ground, not markers: two of them may lie side by side but never one
        # inside the other.
        if any(math.hypot(x - o["x"], y - o["y"])
               < r + _dep_radius(o["kind"], o["max"]) + 34 for o in out):
            continue
        out.append({"id": len(out) + 1, "x": round(x, 1), "y": round(y, 1),
                    "kind": kind, "amount": round(amount), "max": round(amount)})
    return out


def _new_factions() -> list:
    """Four camps, one to a corner, each starting exactly where the player does:
    a keep, one free roof and nobody yet. People come out of the roof on both
    sides of the map — a camp is handed no more diggers than the hold is handed
    builders. Nothing in the store either: the first load a camp spends is a
    load one of its own people carried home, so the second roof in a corner is
    earned at "pace" the same way the hold earns its second house."""
    f = BALANCE["faction"]
    size = BALANCE["world"]["size"]
    # A camp's keep is the hold's keep and a camp's roof is the hold's house,
    # so both are measured off the player's own table rather than a second one.
    keep_hp = _max_hp("tower", 1, keep=True)
    hut = BALANCE["buildings"]["house"]
    hut_hp = _max_hp("house", 1)
    out = []
    for i, (cx, cy) in enumerate(_corners()):
        # The free hut stands beside the keep, offset towards the middle of the
        # map: the corners are the one direction where there is no room.
        hx = cx + (62 if cx < size / 2 else -62)
        hy = cy + (46 if cy < size / 2 else -46)
        out.append({
            "id": i,
            "x": cx, "y": cy,
            "color": f["colors"][i % len(f["colors"])],
            "wood": f["start"]["wood"], "stone": f["start"]["stone"],
            "iron": f["start"]["iron"],
            "lvl": 1,
            "buildings": [{"id": 1, "type": "keep", "x": cx, "y": cy, "lvl": 1,
                           "hp": keep_hp, "maxHp": keep_hp, "built": 1.0},
                          {"id": 2, "type": "hut", "x": round(hx), "y": round(hy),
                           "lvl": 1, "built": 1.0, "build": hut["build"],
                           "hp": hut_hp, "maxHp": hut_hp}],
            "next_id": 3,
            "workers": [],
            "army": [],
            "spawn": 0.0, "muster": 0.0, "ready": 0.0,
            "grace": f["grace"] + i * f.get("grace_step", 0),
            "stats": {"sent": 0, "lost": 0, "built": 0},
        })
    return out


def _new_hold(settings) -> dict:
    """Four camps in the corners, the ground lying wherever the map put it — and
    no hold yet, and nothing in the store.

    Nothing is placed for the player any more. The deposits are the map, and
    everything a hold becomes is decided by where they landed, so where the keep
    goes is the first decision of the game rather than the one decision it was
    never given: the map is handed over with "founding" set, and the browser
    puts the keep and its people down wherever the player says. Until then
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
        # and whose loss ends the run — and the hold's first people are both put
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
    # An older map was laid out around five sites; this one is thrown. Topping
    # up cannot fix that — it would only add a sixth pile to a map that is
    # already five piles — so what an old map gets is more of the same throw,
    # and only if it is thin enough to be unplayable.
    _top_up_deposits(st)
    st["world"] = WORLD_VERSION
    return st


def _top_up_deposits(st: dict) -> None:
    """Throw more ground at a map that has too little of it.

    Nothing here looks at where anybody lives, so a corner that was dealt a bad
    map stays dealt a bad map — that is the point of throwing rather than
    laying. This only catches a world so bare that nobody could work it.
    """
    dep = BALANCE["deposit"]
    w   = BALANCE["world"]["size"]
    rnd = random.Random(int(st.get("seed") or 1) ^ 0x5730)
    out = st.get("deposits") or []
    want = dep["count_min"]
    if len(out) >= want:
        return
    kinds = list(dep["kinds"])
    sites = _sites()
    nid = max([int(d.get("id") or 0) for d in out] or [0])
    for _ in range((want - len(out)) * 6):
        if len(out) >= want:
            break
        kind   = rnd.choice(kinds)
        amount = dep["kinds"][kind]["amount"] * (0.7 + rnd.random() * 0.8)
        r      = _dep_radius(kind, amount)
        x = r + 30 + rnd.random() * (w - 2 * (r + 30))
        y = r + 30 + rnd.random() * (w - 2 * (r + 30))
        if any(math.hypot(x - sx, y - sy) < r + dep["clear"] for sx, sy in sites):
            continue
        if any(math.hypot(x - o["x"], y - o["y"])
               < r + _dep_radius(o["kind"], o.get("max", amount)) + 34
               for o in out):
            continue
        nid += 1
        out.append({"id": nid, "x": round(x, 1), "y": round(y, 1),
                    "kind": kind, "amount": round(amount), "max": round(amount)})
    st["deposits"] = out


def _cost(kind: str, lvl: int) -> dict:
    """What one level of a building costs. Mirrors _cost in mp.js.

    The level price only. What a *new* building of a kind the hold already has
    costs on top of this — "repeat" — is a decision made where the building is
    put down, so it lives in _newCost in the browser. This is used here for the
    refund a migrated hold is given back, and a refund is deliberately priced
    off the level rather than off what the crowding happened to cost.
    """
    b = BALANCE["buildings"].get(kind)
    if not b:
        # A building this version no longer has: price it as the timber it was.
        return {"wood": 60 * max(1, int(lvl))}
    lvl = max(1, int(lvl))
    m = BALANCE["upgrade_mult"] ** (lvl - 1)
    base = b["stone_cost"] if (b.get("stone_from") and lvl >= b["stone_from"]) else b["cost"]
    out = {res: round(base[res] * m) for res in RESOURCES if base.get(res)}
    # The tiers are a share of whatever the level is actually priced in, not of
    # its timber. For everything but the wall that is the same thing; the wall
    # is rebuilt in stone from level 2 and has no timber line to take a share
    # of, so measuring off wood meant its iron tier could never come due and
    # the one building that grows without limit was also the one that never
    # asked for the dearest material.
    lead = next((res for res in RESOURCES if base.get(res)), None)
    lead_amt = base.get(lead, 0) * m if lead else 0
    for res, at in (b.get("tier") or {}).items():
        if res != lead and lvl >= at and lead_amt:
            out[res] = out.get(res, 0) + round(lead_amt * BALANCE["tier_share"][res])
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
