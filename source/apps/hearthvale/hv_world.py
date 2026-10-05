"""Hearthvale — the one shared world.

Game Hub gives every player their own solo room, and loads mp_game.py afresh
for each of them, so nothing that lives in mp_game.py is shared between two
players. This module is the shared part: mp_game.py loads it once per backend
process under a fixed name (see _world() there) and every room talks to the
same World instance. Game Hub itself knows nothing about it.

The server is deliberately light. It never ticks: it only answers what a
player does, checks that it is plausible and passes it on to everyone else who
is online. The world on disk is the seed the terrain grows from, the place
each player was last standing and what they carry, and what has been changed
in the valley: trees cut down, loose stones picked up and the piles people
left on the ground.

Trees and loose stones are grown by the client from the seed; the server never
holds a list of them. Their ids carry their position (decimetres), which is
all it needs to check that a player is standing next to what they act on.
"""

import json
import math
import os
import random
import re
import sqlite3
import time
import zlib

_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")   # runtime database, never packaged

TUNING = {
    # The playable square, in metres, centred on the origin. The client shapes
    # the island so the sea starts before this edge.
    "world_size": 1400,
    # Client speeds; the server allows a margin on top of the fastest one
    # because a lagging socket delivers two moves at once.
    "walk_speed": 3.2,
    "run_speed": 7.0,
    "speed_slack": 1.5,
    "move_rate_hz": 10,
    # How often a moving player's position reaches the database. Leaving
    # always writes it.
    "persist_every": 15.0,
    # A player whose tab is gone and who has not come back within this many
    # seconds has their solo room closed, so Game Hub offers plain Play again
    # instead of "continue the run".
    "leave_grace": 45.0,
    # How far from a player the thing they act on may be, in metres.
    "reach": 3.5,
    # Small things go in the backpack, one per slot. A log does not fit in
    # any backpack: it is carried in the hands, one at a time, at a walk.
    "pack_slots": 10,
    # Seconds of chopping a tree takes, by what is in the hand.
    "chop_seconds": {"stone": 300, "axe": 100},
    # Seconds of chopping an axe lasts before it breaks: twelve trees.
    "axe_life": 1200,
    # What can be made and of what. A log counts when it is in the hands,
    # a stone in the hands or in the backpack.
    "recipes": {"axe": {"stone": 1, "log": 1}},
    # What is built on the ground instead: the player places its frame and
    # brings the materials to it, one at a time.
    "builds": {"sled": {"log": 5}},
    # How many things a sled carries, of any kind together.
    "sled_cap": 10,
    # Length of the rope between a sled and whoever pulls it, in metres.
    "rope": 2.4,
    # Two builds never stand closer than this.
    "build_gap": 3.0,
    # The client sends one chop tick per this many seconds while chopping.
    "chop_tick": 1.0,
    # Most items one pile on the ground holds before a new one is started.
    "pile_max": {"stone": 40, "log": 12},
    # Two piles of the same thing closer than this become one.
    "pile_merge": 1.6,
}

_ANIMS = {"idle", "walk", "run", "jump", "chop"}
_LOADABLE = {"stone", "log"}   # what goes on a sled; tools stay with the player
_ITEMS = {"stone", "log"}   # plain things, stored as their name
_TOOLS = {"axe"}            # worn by use, stored as {"k": name, "w": seconds left}
_SMALL = {"stone", "axe"}   # what fits in a backpack slot
_TREE_RE = re.compile(r"^t(-?\d{1,6})_(-?\d{1,6})$")
_STONE_RE = re.compile(r"^s(-?\d{1,6})_(-?\d{1,6})$")


def _pos_of(object_id: str, pattern) -> tuple | None:
    m = pattern.match(object_id or "") if isinstance(object_id, str) else None
    return (int(m.group(1)) / 10.0, int(m.group(2)) / 10.0) if m else None


def _tree_size(tree_id: str) -> float:
    # 0..1, fixed per tree. The client sizes the tree from the same number,
    # so a bigger tree on screen is a bigger tree here.
    return (zlib.crc32(tree_id.encode()) % 1000) / 1000.0


def _logs_of(tree_id: str) -> int:
    return 2 + int(_tree_size(tree_id) * 5)    # 2 to 6


def _kind(item):
    if isinstance(item, dict):
        return item.get("k")
    return item


def _clean_item(item):
    if isinstance(item, str):
        return item if item in _ITEMS else None
    if isinstance(item, dict) and item.get("k") in _TOOLS:
        w = _num(item.get("w"), 0, TUNING["axe_life"], 0)
        return {"k": item["k"], "w": w} if w > 0 else None
    return None


def _new_inventory() -> dict:
    # A newcomer starts with one stone in the backpack — the first tool.
    pack = [None] * TUNING["pack_slots"]
    pack[0] = "stone"
    return {"hand": None, "pack": pack}


def _clean_inventory(raw) -> dict:
    inv = _new_inventory()
    if not isinstance(raw, dict):
        return inv
    inv["hand"] = _clean_item(raw.get("hand"))
    pack = raw.get("pack") if isinstance(raw.get("pack"), list) else []
    inv["pack"] = [(x if _kind(x) in _SMALL else None) for x in map(_clean_item, pack[:TUNING["pack_slots"]])]
    inv["pack"] += [None] * (TUNING["pack_slots"] - len(inv["pack"]))
    return inv


def _conn():
    conn = sqlite3.connect(_DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _num(v, lo, hi, default=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:   # NaN
        return default
    return max(lo, min(hi, f))


class World:
    def __init__(self):
        with _conn() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY, value TEXT NOT NULL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS players (
                player_id TEXT PRIMARY KEY,
                x REAL, y REAL, z REAL, ry REAL,
                updated_at REAL)""")
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(players)")}
            if "inv" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN inv TEXT")
            conn.execute("""CREATE TABLE IF NOT EXISTS felled (
                tree_id TEXT PRIMARY KEY, at REAL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS chopping (
                tree_id TEXT PRIMARY KEY, progress REAL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS taken_stones (
                stone_id TEXT PRIMARY KEY, at REAL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS piles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL, n INTEGER NOT NULL,
                x REAL NOT NULL, z REAL NOT NULL)""")
            # Things built on the ground. A frame is kind "site" until its
            # materials are in; data holds what is made, what was brought, and
            # for a sled what it carries.
            conn.execute("""CREATE TABLE IF NOT EXISTS builds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL,
                ry REAL NOT NULL, data TEXT NOT NULL)""")
            row = conn.execute("SELECT value FROM meta WHERE key='seed'").fetchone()
            if row is None:
                seed = random.randint(1, 2_000_000_000)
                conn.execute("INSERT INTO meta(key,value) VALUES('seed',?)", (str(seed),))
            else:
                seed = int(row["value"])
            conn.commit()
            self.felled = {r["tree_id"] for r in conn.execute("SELECT tree_id FROM felled")}
            self.chopped = {r["tree_id"]: r["progress"] for r in conn.execute("SELECT * FROM chopping")}
            self.taken = {r["stone_id"] for r in conn.execute("SELECT stone_id FROM taken_stones")}
            self.piles = {r["id"]: dict(r) for r in conn.execute("SELECT id,kind,n,x,z FROM piles")}
            self.builds = {}
            for r in conn.execute("SELECT * FROM builds"):
                b = {"id": r["id"], "kind": r["kind"], "x": r["x"], "z": r["z"], "ry": r["ry"], "by": None}
                b.update(json.loads(r["data"]))
                self.builds[b["id"]] = b
        self.seed = seed
        # player_id -> live state of everyone online right now
        self.online: dict[str, dict] = {}

    # ── persistence ─────────────────────────────────────────────────────────
    def _load_pos(self, pid: str):
        with _conn() as conn:
            r = conn.execute("SELECT x,y,z,ry,inv FROM players WHERE player_id=?", (pid,)).fetchone()
        return dict(r) if r else None

    def _store_inv(self, p: dict):
        with _conn() as conn:
            conn.execute(
                """INSERT INTO players(player_id,inv,updated_at) VALUES(?,?,?)
                   ON CONFLICT(player_id) DO UPDATE SET inv=excluded.inv""",
                (p["id"], json.dumps(p["inv"]), time.time()),
            )
            conn.commit()

    def _store_build(self, b: dict):
        data = {k: v for k, v in b.items() if k not in ("id", "kind", "x", "z", "ry", "by")}
        with _conn() as conn:
            if b.get("gone"):
                conn.execute("DELETE FROM builds WHERE id=?", (b["id"],))
            elif b["id"] is None:
                cur = conn.execute("INSERT INTO builds(kind,x,z,ry,data) VALUES(?,?,?,?,?)",
                                   (b["kind"], b["x"], b["z"], b["ry"], json.dumps(data)))
                b["id"] = cur.lastrowid
            else:
                conn.execute("UPDATE builds SET kind=?,x=?,z=?,ry=?,data=? WHERE id=?",
                             (b["kind"], b["x"], b["z"], b["ry"], json.dumps(data), b["id"]))
            conn.commit()

    def _store_pile(self, pile: dict):
        with _conn() as conn:
            if pile["n"] <= 0:
                conn.execute("DELETE FROM piles WHERE id=?", (pile["id"],))
            else:
                conn.execute("UPDATE piles SET n=? WHERE id=?", (pile["n"], pile["id"]))
            conn.commit()

    def _new_pile(self, kind: str, n: int, x: float, z: float) -> dict:
        with _conn() as conn:
            cur = conn.execute("INSERT INTO piles(kind,n,x,z) VALUES(?,?,?,?)", (kind, n, x, z))
            conn.commit()
            pile = {"id": cur.lastrowid, "kind": kind, "n": n, "x": x, "z": z}
        self.piles[pile["id"]] = pile
        return pile

    def _store_pos(self, p: dict):
        with _conn() as conn:
            conn.execute(
                """INSERT INTO players(player_id,x,y,z,ry,updated_at) VALUES(?,?,?,?,?,?)
                   ON CONFLICT(player_id) DO UPDATE SET
                     x=excluded.x, y=excluded.y, z=excluded.z, ry=excluded.ry,
                     updated_at=excluded.updated_at""",
                (p["id"], p["x"], p["y"], p["z"], p["ry"], time.time()),
            )
            conn.commit()
        p["saved_at"] = time.time()

    # ── helpers ─────────────────────────────────────────────────────────────
    @staticmethod
    def _public(p: dict) -> dict:
        return {
            "id": p["id"], "name": p["name"], "color": p["color"],
            "x": p["x"], "y": p["y"], "z": p["z"], "ry": p["ry"], "a": p["anim"],
            "h": _kind(p["inv"]["hand"]),
        }

    async def _to_others(self, pid: str, msg: dict):
        for other in list(self.online.values()):
            if other["id"] != pid:
                await other["ctx"].send(other["id"], msg)

    async def _to_all(self, msg: dict):
        for other in list(self.online.values()):
            await other["ctx"].send(other["id"], msg)

    async def _nope(self, p: dict, reason: str):
        await p["ctx"].send(p["id"], {"type": "hv_nope", "reason": reason})

    async def _inv_changed(self, p: dict, hand_before):
        self._store_inv(p)
        await p["ctx"].send(p["id"], {"type": "hv_inv", "inv": p["inv"]})
        if _kind(p["inv"]["hand"]) != _kind(hand_before):
            await self._to_others(p["id"], {"type": "hv_held", "id": p["id"], "h": _kind(p["inv"]["hand"])})

    @staticmethod
    def _near(p: dict, x: float, z: float, extra: float = 0.0) -> bool:
        if p["x"] is None:
            return False
        return ((p["x"] - x) ** 2 + (p["z"] - z) ** 2) ** 0.5 <= TUNING["reach"] + extra

    def _world_state(self) -> dict:
        return {
            "felled": sorted(self.felled),
            "taken": sorted(self.taken),
            "piles": list(self.piles.values()),
            "builds": list(self.builds.values()),
        }

    # ── what players do ─────────────────────────────────────────────────────
    async def enter(self, ctx, player: dict, three_url: str):
        """A player's socket is in the world (first time or after reconnect)."""
        pid = str(player["id"])
        prev = self.online.get(pid)
        pos = prev or self._load_pos(pid)
        p = {
            "id": pid,
            "name": player.get("display_name") or "?",
            "color": player.get("avatar_color") or "#89b4fa",
            "ctx": ctx,
            "x": pos["x"] if pos else None,
            "y": pos["y"] if pos else 0.0,
            "z": pos["z"] if pos else None,
            "ry": pos["ry"] if pos else 0.0,
            "anim": "idle",
            "t": time.time(),
            "saved_at": time.time(),
            "inv": prev["inv"] if prev else _clean_inventory(
                json.loads(pos["inv"]) if pos and pos.get("inv") else None),
            "chop": None,   # {"tree", "at"} while this player is chopping
            "pull": prev["pull"] if prev else None,   # id of the sled they pull
        }
        if prev is None and not (pos and pos.get("inv")):
            self._store_inv(p)
        self.online[pid] = p
        await ctx.send(pid, {
            "type": "hv_welcome",
            "seed": self.seed,
            "tuning": TUNING,
            "three": three_url,
            "you": self._public(p),
            "spawn": p["x"] is None,
            "peers": [self._public(o) for o in self.online.values() if o["id"] != pid],
            "inv": p["inv"],
            "world": self._world_state(),
        })
        if prev is None:
            await self._to_others(pid, {"type": "hv_join", "peer": self._public(p)})

    async def leave(self, ctx, pid: str):
        """The socket of this room went away. A newer room of the same player
        may already have taken their place; only the owner of the entry may
        remove it."""
        p = self.online.get(pid)
        if p is None or p["ctx"] is not ctx:
            return
        if p["x"] is not None:
            self._store_pos(p)
        self._store_chop()
        await self._let_go(p)
        self.online.pop(pid, None)
        await self._to_others(pid, {"type": "hv_leave", "id": pid})

    def is_online_via(self, ctx, pid: str) -> bool:
        p = self.online.get(pid)
        return p is not None and p["ctx"] is ctx

    async def move(self, pid: str, msg: dict):
        p = self.online.get(pid)
        if p is None:
            return
        half = TUNING["world_size"] / 2
        x = _num(msg.get("x"), -half, half)
        z = _num(msg.get("z"), -half, half)
        y = _num(msg.get("y"), -20, 80)
        ry = _num(msg.get("ry"), -1000, 1000) % 6.283185307179586
        anim = msg.get("a") if msg.get("a") in _ANIMS else "idle"
        now = time.time()

        if p["x"] is not None:
            # A move faster than anyone can run is refused, and the player is
            # put back where the server last saw them.
            dt = max(now - p["t"], 1.0 / TUNING["move_rate_hz"])
            limit = TUNING["run_speed"] * TUNING["speed_slack"] * dt + 1.0
            if ((x - p["x"]) ** 2 + (z - p["z"]) ** 2) ** 0.5 > limit:
                await p["ctx"].send(pid, {"type": "hv_snap", "x": p["x"], "y": p["y"], "z": p["z"]})
                p["t"] = now
                return

        p.update(x=x, y=y, z=z, ry=ry, anim=anim, t=now)
        sled = self.builds.get(p["pull"]) if p["pull"] is not None else None
        if sled is not None:
            # The rope: the sled stays where it is until the rope is taut,
            # then it slides after the player. Every client does the same.
            dx, dz = sled["x"] - x, sled["z"] - z
            d = (dx * dx + dz * dz) ** 0.5
            if d > TUNING["rope"]:
                sled["x"] = round(x + dx / d * TUNING["rope"], 2)
                sled["z"] = round(z + dz / d * TUNING["rope"], 2)
                sled["ry"] = round(math.atan2(-dx, -dz), 3)
        await self._to_others(pid, {"type": "hv_move", "id": pid,
                                    "x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
                                    "ry": round(ry, 3), "a": anim})
        if now - p["saved_at"] > TUNING["persist_every"]:
            self._store_pos(p)
            if sled is not None:
                self._store_build(sled)

    # ── gathering ───────────────────────────────────────────────────────────
    def _store_chop(self):
        with _conn() as conn:
            conn.executemany(
                """INSERT INTO chopping(tree_id,progress) VALUES(?,?)
                   ON CONFLICT(tree_id) DO UPDATE SET progress=excluded.progress""",
                list(self.chopped.items()),
            )
            conn.commit()

    async def chop(self, pid: str, msg: dict):
        """One tick of chopping. Time counts only between two ticks of the
        same player on the same tree, never more than a tick and a bit, so a
        client cannot claim more chopping than it spent next to the tree."""
        p = self.online.get(pid)
        if p is None:
            return
        tree = msg.get("tree")
        pos = _pos_of(tree, _TREE_RE)
        if pos is None or tree in self.felled:
            return
        if not self._near(p, *pos):
            p["chop"] = None
            return await self._nope(p, "far")
        hand = p["inv"]["hand"]
        tool = _kind(hand)
        need = TUNING["chop_seconds"].get(tool)
        if need is None:
            p["chop"] = None
            return await self._nope(p, "need_stone")
        now = time.time()
        last = p["chop"]
        gained = 0.0
        if last and last["tree"] == tree:
            gained = min(now - last["at"], TUNING["chop_tick"] * 1.5)
        p["chop"] = {"tree": tree, "at": now}
        before = self.chopped.get(tree, 0.0)
        # Progress is kept in seconds of stone; a better tool adds more per second.
        done = before + gained * (TUNING["chop_seconds"]["stone"] / need)
        full = TUNING["chop_seconds"]["stone"]
        if isinstance(hand, dict) and gained > 0:
            # A tool wears by the seconds it is used and breaks at zero.
            hand["w"] = round(hand["w"] - gained, 2)
            if hand["w"] <= 0:
                p["inv"]["hand"] = None
                p["chop"] = None
                self.chopped[tree] = min(done, full - 0.01)
                self._store_chop()
                await p["ctx"].send(pid, {"type": "hv_broke", "item": tool})
                return await self._inv_changed(p, hand)
            await p["ctx"].send(pid, {"type": "hv_inv", "inv": p["inv"]})
            if int(hand["w"]) // 10 != int(hand["w"] + gained) // 10:
                self._store_inv(p)
        if done < full:
            self.chopped[tree] = done
            if int(done // 10) != int(before // 10):
                self._store_chop()
            await p["ctx"].send(pid, {"type": "hv_chop_p", "tree": tree, "p": done / full})
            return

        # The tree comes down: its wood lands beside the stump as one pile.
        self.chopped.pop(tree, None)
        self.felled.add(tree)
        p["chop"] = None
        with _conn() as conn:
            conn.execute("INSERT OR IGNORE INTO felled(tree_id,at) VALUES(?,?)", (tree, now))
            conn.execute("DELETE FROM chopping WHERE tree_id=?", (tree,))
            conn.commit()
        if isinstance(hand, dict):
            self._store_inv(p)
        n = _logs_of(tree)
        pile = self._new_pile("log", n, round(pos[0] + 1.3, 2), round(pos[1], 2))
        await self._to_all({"type": "hv_felled", "tree": tree, "by": pid, "pile": pile})

    async def pick(self, pid: str, msg: dict):
        """Pick up one thing: a loose stone, or the top item of a pile."""
        p = self.online.get(pid)
        if p is None:
            return
        if msg.get("build") is not None:
            b = self._build_of(p, msg)
            return await (self.take_off(p, b) if b else self._nope(p, "far"))
        inv = p["inv"]
        hand_before = inv["hand"]
        if msg.get("stone") is not None:
            stone = msg.get("stone")
            pos = _pos_of(stone, _STONE_RE)
            if pos is None or stone in self.taken:
                return
            if not self._near(p, *pos):
                return await self._nope(p, "far")
            if not self._put(inv, "stone"):
                return await self._nope(p, "full")
            self.taken.add(stone)
            with _conn() as conn:
                conn.execute("INSERT OR IGNORE INTO taken_stones(stone_id,at) VALUES(?,?)", (stone, time.time()))
                conn.commit()
            await self._to_all({"type": "hv_stone_taken", "id": stone})
            return await self._inv_changed(p, hand_before)

        pile = self.piles.get(msg.get("pile")) if isinstance(msg.get("pile"), int) else None
        if pile is None:
            return
        if not self._near(p, pile["x"], pile["z"]):
            return await self._nope(p, "far")
        if not self._put(inv, pile["kind"]):
            return await self._nope(p, "hands_full" if pile["kind"] not in _SMALL else "full")
        pile["n"] -= 1
        self._store_pile(pile)
        if pile["n"] <= 0:
            self.piles.pop(pile["id"], None)
            await self._to_all({"type": "hv_pile_gone", "id": pile["id"]})
        else:
            await self._to_all({"type": "hv_pile", "pile": pile})
        await self._inv_changed(p, hand_before)

    @staticmethod
    def _put(inv: dict, item: str) -> bool:
        # A small thing goes to the backpack first and to the hands only when
        # the backpack is full; anything else needs empty hands.
        if item in _SMALL and None in inv["pack"]:
            inv["pack"][inv["pack"].index(None)] = item
            return True
        if inv["hand"] is None:
            inv["hand"] = item
            return True
        return False

    def _build_of(self, p: dict, msg: dict):
        b = self.builds.get(msg.get("build")) if isinstance(msg.get("build"), int) else None
        return b if b is not None and self._near_build(p, b) else None

    async def drop(self, pid: str, msg: dict):
        """Put down what is in the hands, or with empty hands one stone from
        the backpack, at the spot in front of the player. It joins a pile of
        the same thing there or starts a new one."""
        p = self.online.get(pid)
        if p is None:
            return
        if msg.get("build") is not None:
            b = self._build_of(p, msg)
            return await (self.put_on(p, b) if b else self._nope(p, "far"))
        inv = p["inv"]
        hand_before = inv["hand"]
        if _kind(inv["hand"]) in _TOOLS:
            return await self._nope(p, "keep_tool")
        if inv["hand"] is not None:
            item = inv["hand"]
        elif "stone" in inv["pack"]:
            item = "stone"
        else:
            return
        half = TUNING["world_size"] / 2
        x = _num(msg.get("x"), -half, half, p["x"] or 0.0)
        z = _num(msg.get("z"), -half, half, p["z"] or 0.0)
        if not self._near(p, x, z):
            return await self._nope(p, "far")

        target = None
        best = TUNING["pile_merge"]
        for pile in self.piles.values():
            if pile["kind"] != item or pile["n"] >= TUNING["pile_max"][item]:
                continue
            d = ((pile["x"] - x) ** 2 + (pile["z"] - z) ** 2) ** 0.5
            if d <= best:
                target, best = pile, d
        if inv["hand"] is not None:
            inv["hand"] = None
        else:
            inv["pack"][len(inv["pack"]) - 1 - inv["pack"][::-1].index("stone")] = None
        if target:
            target["n"] += 1
            self._store_pile(target)
        else:
            target = self._new_pile(item, 1, round(x, 2), round(z, 2))
        await self._to_all({"type": "hv_pile", "pile": target})
        await self._inv_changed(p, hand_before)

    async def hold(self, pid: str, msg: dict):
        """Swap the hands with one backpack slot. A log never goes into the
        backpack, so with a log in the hands nothing happens."""
        p = self.online.get(pid)
        if p is None:
            return
        inv = p["inv"]
        hand_before = inv["hand"]
        slot = msg.get("slot")
        if slot == "stash":
            # Hands into the first free slot.
            if inv["hand"] is None:
                return
            if _kind(inv["hand"]) not in _SMALL:
                return await self._nope(p, "too_big")
            if None not in inv["pack"]:
                return await self._nope(p, "full")
            inv["pack"][inv["pack"].index(None)] = inv["hand"]
            inv["hand"] = None
            return await self._inv_changed(p, hand_before)
        if not isinstance(slot, int) or not 0 <= slot < len(inv["pack"]):
            return
        if inv["hand"] is not None and _kind(inv["hand"]) not in _SMALL:
            return await self._nope(p, "too_big")
        if inv["hand"] is None and inv["pack"][slot] is None:
            return
        inv["hand"], inv["pack"][slot] = inv["pack"][slot], inv["hand"]
        p["chop"] = None
        await self._inv_changed(p, hand_before)

    async def craft(self, pid: str, msg: dict):
        """Make something from a recipe out of what the player carries. The
        made thing goes into the hands, or into the backpack when the hands
        are still busy."""
        p = self.online.get(pid)
        if p is None:
            return
        name = msg.get("item")
        recipe = TUNING["recipes"].get(name) if isinstance(name, str) else None
        if recipe is None:
            return
        hand_before = p["inv"]["hand"]
        inv = {"hand": hand_before, "pack": list(p["inv"]["pack"])}   # applied only if it all works
        have = {"log": 1 if inv["hand"] == "log" else 0,
                "stone": inv["pack"].count("stone") + (1 if inv["hand"] == "stone" else 0)}
        if any(have.get(k, 0) < n for k, n in recipe.items()):
            return await self._nope(p, "missing")
        for k, n in recipe.items():
            for _ in range(n):
                # The backpack gives first, so a stone in the hands stays there.
                if k in inv["pack"]:
                    inv["pack"][len(inv["pack"]) - 1 - inv["pack"][::-1].index(k)] = None
                else:
                    inv["hand"] = None
        made = {"k": name, "w": TUNING["axe_life"]} if name in _TOOLS else name
        if inv["hand"] is None:
            inv["hand"] = made
        elif None in inv["pack"]:
            inv["pack"][inv["pack"].index(None)] = made
        else:
            return await self._nope(p, "full")
        p["inv"] = inv
        p["chop"] = None
        await p["ctx"].send(pid, {"type": "hv_made", "item": name})
        await self._inv_changed(p, hand_before)

    # ── builds: frames, sleds ───────────────────────────────────────────────
    async def place(self, pid: str, msg: dict):
        """Lay down the frame of something built on the ground."""
        p = self.online.get(pid)
        if p is None:
            return
        make = msg.get("make")
        need = TUNING["builds"].get(make) if isinstance(make, str) else None
        if need is None:
            return
        half = TUNING["world_size"] / 2
        x = _num(msg.get("x"), -half, half, p["x"] or 0.0)
        z = _num(msg.get("z"), -half, half, p["z"] or 0.0)
        if not self._near(p, x, z):
            return await self._nope(p, "far")
        for o in self.builds.values():
            if ((o["x"] - x) ** 2 + (o["z"] - z) ** 2) ** 0.5 < TUNING["build_gap"]:
                return await self._nope(p, "crowded")
        b = {"id": None, "kind": "site", "x": round(x, 2), "z": round(z, 2),
             "ry": round(_num(msg.get("ry"), -1000, 1000) % 6.283185307179586, 3),
             "make": make, "have": {k: 0 for k in need}}
        self._store_build(b)
        b["by"] = None
        self.builds[b["id"]] = b
        await self._to_all({"type": "hv_build", "build": b})

    def _near_build(self, p: dict, b: dict) -> bool:
        # A sled is a couple of metres long; reach it anywhere along its side.
        return self._near(p, b["x"], b["z"], 1.2)

    async def _build_changed(self, b: dict):
        self._store_build(b)
        if b.get("gone"):
            self.builds.pop(b["id"], None)
            await self._to_all({"type": "hv_build_gone", "id": b["id"]})
        else:
            await self._to_all({"type": "hv_build", "build": b})

    async def put_on(self, p: dict, b: dict):
        """Bring one thing to a frame, or load one thing on a sled."""
        inv = p["inv"]
        hand_before = inv["hand"]
        if b["kind"] == "site":
            need = TUNING["builds"][b["make"]]
            item = _kind(inv["hand"])
            if item not in need and inv["hand"] is None:
                item = next((k for k in need if k in inv["pack"]), None)
            if item not in need:
                return await self._nope(p, "not_needed")
            if b["have"].get(item, 0) >= need[item]:
                return await self._nope(p, "not_needed")
        else:
            item = _kind(inv["hand"])
            if item in _TOOLS:
                return await self._nope(p, "keep_tool")
            if item is None:
                item = "stone" if "stone" in inv["pack"] else None
            if item not in _LOADABLE:
                return
            if len(b["load"]) >= TUNING["sled_cap"]:
                return await self._nope(p, "sled_full")
        if _kind(inv["hand"]) == item:
            inv["hand"] = None
        else:
            inv["pack"][len(inv["pack"]) - 1 - inv["pack"][::-1].index(item)] = None

        if b["kind"] == "site":
            b["have"][item] = b["have"].get(item, 0) + 1
            need = TUNING["builds"][b["make"]]
            if all(b["have"].get(k, 0) >= n for k, n in need.items()):
                # Everything is in: the frame becomes the thing itself.
                b["kind"] = b.pop("make")
                b.pop("have", None)
                b["load"] = []
                await p["ctx"].send(p["id"], {"type": "hv_made", "item": b["kind"]})
        else:
            b["load"].append(item)
        await self._build_changed(b)
        await self._inv_changed(p, hand_before)

    async def take_off(self, p: dict, b: dict):
        """Take one thing back from a frame or off a sled. An empty frame is
        taken away altogether."""
        inv = p["inv"]
        hand_before = inv["hand"]
        if b["kind"] == "site":
            item = next((k for k, n in b["have"].items() if n > 0), None)
            if item is None:
                b["gone"] = True
                return await self._build_changed(b)
        else:
            if not b["load"]:
                return
            item = b["load"][-1]
        if not self._put(inv, item):
            return await self._nope(p, "hands_full" if item not in _SMALL else "full")
        if b["kind"] == "site":
            b["have"][item] -= 1
        else:
            b["load"].pop()
        await self._build_changed(b)
        await self._inv_changed(p, hand_before)

    async def pull(self, pid: str, msg: dict):
        """Take a sled's rope, or let go of the one in hand."""
        p = self.online.get(pid)
        if p is None:
            return
        if p["pull"] is not None:
            return await self._let_go(p)
        b = self.builds.get(msg.get("build")) if isinstance(msg.get("build"), int) else None
        if b is None or b["kind"] != "sled":
            return
        if not self._near_build(p, b):
            return await self._nope(p, "far")
        if b["by"] is not None and b["by"] in self.online:
            return await self._nope(p, "taken")
        b["by"] = pid
        p["pull"] = b["id"]
        await self._to_all({"type": "hv_build", "build": b})

    async def _let_go(self, p: dict):
        b = self.builds.get(p["pull"]) if p.get("pull") is not None else None
        p["pull"] = None
        if b is None:
            return
        b["by"] = None
        await self._build_changed(b)


WORLD = World()
