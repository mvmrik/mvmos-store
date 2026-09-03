"""mvmCrypto — encrypted seed vault + Bitcoin portfolio tracker for mvmOS.

Two independent features share this one app:

  * Seed vault: zero-knowledge, envelope-encrypted storage of crypto wallet
    seed phrases. All cryptography happens in the browser (PBKDF2 -> AES-GCM
    via crypto.subtle) exactly like mvmPasswords. This service never sees a
    master password, an entry password, a dataKey or a plaintext seed phrase
    — it only stores opaque base64 salts/IVs/ciphertexts, scoped by the
    authenticated Apps Hub profile (owner_id).

    Sharing an entry is a one-time secure TRANSFER, not standing access.
    Every entry — the owner's and, after a transfer, the recipient's — stays
    fully personal and dual-protected (owner/recipient's own vaultKey +
    that entry's own password); there is never a row that only a shared
    password alone can open on a long-term basis.

    The flow: the owner already has the plaintext (they just created it, or
    decrypted their own copy). Their browser bundles
    {label,notes,word_count,phrase,passphrase} into one JSON payload and
    encrypts it with a PASSWORD-ONLY key — transferKey =
    PBKDF2(sharedPassword, transfer_salt) — where sharedPassword is simply
    this entry's own password, something both people already know. That
    ciphertext is POSTed to /shares and held server-side as a `pending_shares`
    row addressed to the recipient; a `share_links` row remembers the
    (source entry, recipient) pair so later owner actions (edit, stop
    sharing) can find the recipient's derived copy. The recipient fetches
    the pending share, decrypts it with the same password-only key, and
    immediately re-encrypts the plaintext through the EXACT SAME
    entry-creation path used for any personal entry — their own dataKey +
    the shared password — producing a brand new, fully independent,
    dual-protected row in their own vault (POST /seed-entries as always).
    Accepting deletes the pending_shares row and records the new entry's id
    on share_links.recipient_entry_id. Only a brief password-only window
    exists, during the transfer itself; both endpoints afterward are
    ordinary personal entries.

    "Stop sharing" (owner action) deletes the recipient's derived copy
    outright (a plain row delete, no recipient key needed) plus the
    share_links/pending_shares rows — this is the ONLY revocation
    mechanism, there is no separate live-access grant to revoke. Editing an
    owner's entry that has active share_links automatically deletes each
    recipient's current copy and any still-pending transfer, then re-sends
    a fresh pending_shares row with the new content — every edit to a
    shared entry triggers a full re-share cycle, no partial-update case.

    An earlier version of this feature kept a `entry_shares` join table
    granting live, password-only-forever read access to one shared row.
    That table is no longer used (kept only so an existing database file
    doesn't need a destructive migration) — nothing here reads or writes it
    anymore.

  * Portfolio: addresses across seven networks (Bitcoin, Ethereum, BNB Smart
    Chain, Polygon, Litecoin, Dogecoin, TRON), plus arbitrary ERC-20-family
    tokens on the EVM ones. Same zero-knowledge stance as the vault above —
    address, label, network, token info and the last known balance are one
    vaultKey-encrypted blob per row; this service only ever sees id/iv/
    ciphertext. "Refresh" therefore can't happen here either: the browser
    decrypts its own rows, calls each network's public API directly (so the
    request comes from the visitor's own IP, not this shared server's — see
    mvmcrypto-widget.js), and PUTs the row back re-encrypted with its new
    balance. The one thing this server still computes is native-asset USD
    price (BTC/ETH/etc, cached ~60s) — not a secret, and worth sharing one
    lookup across every visitor instead of each browser hitting CoinGecko
    itself.

  * Custom assets (premium, apps/mvmcrypto/premium/): a manually-tracked
    asset outside the seven networks — gold, a flat, anything — as a running
    ledger of signed USD transactions rather than one overwritten total.
    Same encrypted-blob treatment as portfolio addresses; see
    premium/backend.py for the licence gate.
"""

import base64
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()
APP_ID = "mvmcrypto"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_B64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
_UA = "mvmOS mvmCrypto/1.0"


def _hub():
    return sys.modules.get("backend.apphub")


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db():
    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS vaults (
                owner_id        TEXT PRIMARY KEY,
                salt            TEXT NOT NULL,
                iterations      INTEGER NOT NULL DEFAULT 600000,
                wrap_iv         TEXT NOT NULL,
                wrap_ciphertext TEXT NOT NULL,
                created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS seed_entries (
                id                TEXT PRIMARY KEY,
                owner_id          TEXT NOT NULL,
                iv_meta           TEXT NOT NULL,
                ciphertext_meta   TEXT NOT NULL,
                entry_salt        TEXT NOT NULL,
                iv_secret         TEXT NOT NULL,
                ciphertext_secret TEXT NOT NULL,
                shared            INTEGER NOT NULL DEFAULT 0,
                created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_seed_entries_owner ON seed_entries(owner_id, updated_at DESC);
            -- Legacy from a previous "live shared visibility" design: granted
            -- an additional owner_id permanent, password-only read access to
            -- one row's secret. Replaced by the one-time-transfer scheme
            -- below (pending_shares + share_links) — nothing reads or writes
            -- this table anymore. Left in place (unused) rather than risking
            -- a destructive DROP TABLE migration on an existing database.
            CREATE TABLE IF NOT EXISTS entry_shares (
                entry_id             TEXT NOT NULL,
                shared_with_owner_id TEXT NOT NULL,
                shared_by_owner_id   TEXT NOT NULL,
                created_at           INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                PRIMARY KEY(entry_id, shared_with_owner_id)
            );
            -- One pending, password-only-encrypted transfer of a single
            -- entry's full plaintext ({label,notes,word_count,phrase,
            -- passphrase}) to one recipient. Deleted the moment it is
            -- accepted (see /shares/pending/{id}/accept) or superseded by a
            -- fresh re-share (edit) or cut off (stop sharing) — this table
            -- only ever holds *unconsumed* transfers in flight.
            CREATE TABLE IF NOT EXISTS pending_shares (
                id                  TEXT PRIMARY KEY,
                source_entry_id     TEXT NOT NULL,
                source_owner_id     TEXT NOT NULL,
                recipient_owner_id  TEXT NOT NULL,
                transfer_salt       TEXT NOT NULL,
                iv                  TEXT NOT NULL,
                ciphertext          TEXT NOT NULL,
                created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                consumed_at         INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_pending_shares_recipient ON pending_shares(recipient_owner_id);
            -- Durable record of "this entry was shared with this person",
            -- independent of any one transfer. recipient_entry_id is NULL
            -- while a transfer is pending and set to the id of the
            -- recipient's own derived row once they accept — that is how
            -- edit-triggered re-shares and "stop sharing" find (and delete)
            -- the recipient's copy without ever needing their key.
            CREATE TABLE IF NOT EXISTS share_links (
                source_entry_id     TEXT NOT NULL,
                recipient_owner_id  TEXT NOT NULL,
                recipient_entry_id  TEXT,
                created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                PRIMARY KEY(source_entry_id, recipient_owner_id)
            );
            CREATE INDEX IF NOT EXISTS idx_share_links_recipient ON share_links(recipient_owner_id);
            CREATE TABLE IF NOT EXISTS addresses (
                id           TEXT PRIMARY KEY,
                owner_id     TEXT NOT NULL,
                address      TEXT NOT NULL DEFAULT '',
                label        TEXT NOT NULL DEFAULT '',
                balance_sat  INTEGER,
                last_updated INTEGER,
                iv           TEXT,
                ciphertext   TEXT,
                created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_addresses_owner ON addresses(owner_id, created_at);
            -- Premium (apps/mvmcrypto/premium/): a manually-tracked asset
            -- outside the supported networks (gold, a flat, anything), kept
            -- as a running ledger of signed USD transactions rather than one
            -- overwritten total — see premium/backend.py, which is the only
            -- code that reads or writes these two tables. The schema lives
            -- here in the base app so it always exists, licensed or not;
            -- only the premium module (present exclusively on a licensed
            -- install) is ever allowed to touch the data.
            CREATE TABLE IF NOT EXISTS custom_assets (
                id         TEXT PRIMARY KEY,
                owner_id   TEXT NOT NULL,
                name       TEXT NOT NULL DEFAULT '',
                iv         TEXT,
                ciphertext TEXT,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_custom_assets_owner ON custom_assets(owner_id, created_at);
            CREATE TABLE IF NOT EXISTS custom_asset_txns (
                id         TEXT PRIMARY KEY,
                asset_id   TEXT NOT NULL,
                owner_id   TEXT NOT NULL,
                amount_usd REAL NOT NULL DEFAULT 0,
                note       TEXT NOT NULL DEFAULT '',
                iv         TEXT,
                ciphertext TEXT,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_custom_asset_txns_asset ON custom_asset_txns(asset_id, created_at);
        """)
        # seed_entries predates the "shared" column — add it for databases
        # created before this feature existed. executescript's CREATE TABLE
        # IF NOT EXISTS above is a no-op on those, so the column needs its
        # own explicit migration.
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(seed_entries)").fetchall()}
        if "shared" not in cols:
            conn.execute("ALTER TABLE seed_entries ADD COLUMN shared INTEGER NOT NULL DEFAULT 0")
        # addresses predates multi-network support — every existing row is a
        # Bitcoin address, so DEFAULT 'BTC' makes them valid as-is with no
        # backfill needed. token_contract/token_symbol/token_decimals stay
        # NULL for a network's native asset; set only for an ERC-20-family
        # token added on an EVM network. All of this is now legacy-only
        # (kept for rows from before encryption landed, see "iv" below).
        addr_cols = {row["name"] for row in conn.execute("PRAGMA table_info(addresses)").fetchall()}
        if "coin" not in addr_cols:
            conn.execute("ALTER TABLE addresses ADD COLUMN coin TEXT NOT NULL DEFAULT 'BTC'")
        if "token_contract" not in addr_cols:
            conn.execute("ALTER TABLE addresses ADD COLUMN token_contract TEXT")
            conn.execute("ALTER TABLE addresses ADD COLUMN token_symbol TEXT")
            conn.execute("ALTER TABLE addresses ADD COLUMN token_decimals INTEGER")
            # Historical: widened uniqueness so a native balance and a token
            # balance on the same wallet address could coexist. Dropped below
            # once encryption lands, since every encrypted row shares the same
            # placeholder address='' and would collide on it otherwise.
            conn.execute("DROP INDEX IF EXISTS idx_addresses_owner_addr")
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_owner_addr_asset "
                "ON addresses(owner_id, address, coin, COALESCE(token_contract, ''))"
            )
        if "iv" not in addr_cols:
            # Zero-knowledge portfolio: address/label/coin/token info and the
            # last known balance now live inside one vaultKey-encrypted blob,
            # same as a seed entry's ciphertext_meta — the server only ever
            # sees id/iv/ciphertext. A row from before this change keeps its
            # old plaintext columns (iv/ciphertext NULL) until the client
            # notices and migrates it on next load (see list_addresses).
            conn.execute("ALTER TABLE addresses ADD COLUMN iv TEXT")
            conn.execute("ALTER TABLE addresses ADD COLUMN ciphertext TEXT")
        # No uniqueness constraint on addresses survives encryption — the
        # server can no longer tell two rows' contents apart to enforce one,
        # and every new encrypted row shares the same placeholder address=''
        # (see add_address). Unconditional and IF EXISTS on purpose: an
        # older build's now-removed CREATE TABLE still had one of these baked
        # into its executescript, which silently recreated it on every
        # restart even after this migration once dropped it — dropping both
        # on every startup, not just the first time iv/ciphertext is added,
        # is what actually makes that stick.
        conn.execute("DROP INDEX IF EXISTS idx_addresses_owner_addr")
        conn.execute("DROP INDEX IF EXISTS idx_addresses_owner_addr_asset")
        ca_cols = {row["name"] for row in conn.execute("PRAGMA table_info(custom_assets)").fetchall()}
        if "iv" not in ca_cols:
            conn.execute("ALTER TABLE custom_assets ADD COLUMN iv TEXT")
            conn.execute("ALTER TABLE custom_assets ADD COLUMN ciphertext TEXT")
        cat_cols = {row["name"] for row in conn.execute("PRAGMA table_info(custom_asset_txns)").fetchall()}
        if "iv" not in cat_cols:
            conn.execute("ALTER TABLE custom_asset_txns ADD COLUMN iv TEXT")
            conn.execute("ALTER TABLE custom_asset_txns ADD COLUMN ciphertext TEXT")
        conn.commit()


_init_db()


# --- request bodies ---------------------------------------------------------

class VaultSetupIn(BaseModel):
    salt: str
    iterations: int = 600000
    wrap_iv: str
    wrap_ciphertext: str


class RekeyEntryIn(BaseModel):
    id: str
    iv_meta: str
    ciphertext_meta: str


class VaultRekeyIn(BaseModel):
    salt: str
    iterations: int = 600000
    wrap_iv: str
    wrap_ciphertext: str
    entries: List[RekeyEntryIn] = []


class SeedEntryCreateIn(BaseModel):
    iv_meta: str
    ciphertext_meta: str
    entry_salt: str
    iv_secret: str
    ciphertext_secret: str


class SeedEntryUpdateIn(BaseModel):
    # Editing just the label/notes only touches the meta pair (needs vaultKey
    # only). Editing the phrase/passphrase also sends a fresh secret triple
    # (needs the entry's own password to re-derive entryKey). Either group
    # may be omitted, in which case the stored value is left untouched — but
    # a group that is present must be present in full.
    iv_meta: Optional[str] = None
    ciphertext_meta: Optional[str] = None
    entry_salt: Optional[str] = None
    iv_secret: Optional[str] = None
    ciphertext_secret: Optional[str] = None


class ShareCreateIn(BaseModel):
    # One password-only-encrypted transfer of source_entry_id's full
    # plaintext to recipient_owner_id. See the module docstring for the
    # full flow — this is the ONLY way a share is created, both for a brand
    # new share and for the automatic re-share that follows editing an
    # already-shared entry (the caller just posts again for the same pair).
    recipient_owner_id: str
    source_entry_id: str
    transfer_salt: str
    iv: str
    ciphertext: str


class ShareAcceptIn(BaseModel):
    # The id of the entry the recipient's browser just created via the
    # normal POST /seed-entries, from the decrypted+re-encrypted transfer
    # payload. Recorded on share_links so a later edit or "stop sharing" by
    # the owner can find (and delete) this exact row.
    created_entry_id: str


# Portfolio (address/label/network/token/balance) and every custom-asset
# field now travel as one vaultKey-encrypted blob each — the server only
# ever handles opaque iv/ciphertext pairs, never the plaintext they hold.
class EncryptedBlobIn(BaseModel):
    iv: str
    ciphertext: str


def _user(token: Optional[str]):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None


def _valid_b64(value: Optional[str], minimum: int, maximum: int) -> bool:
    value = (value or "").strip()
    if not value or not _B64_RE.fullmatch(value) or len(value) > maximum:
        return False
    try:
        return len(base64.b64decode(value, validate=True)) >= minimum
    except Exception:
        return False


def _private_response():
    return JSONResponse({"error": "unauthorized"}, status_code=401)


def _private_page():
    return HTMLResponse(
        """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mvmCrypto</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style></head><body>
<div class="icon">🪙</div><div class="msg">mvmCrypto is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""",
        status_code=403,
    )


_SCRIPTS = ("i18n.js", "mvmcrypto-widget.js")


def _asset_version():
    """Cache-buster for the page's scripts: the newest mtime among them.

    See mvmpasswords/api.py for the full reasoning — tying the number to the
    files themselves (rather than the app version) means the URL changes
    exactly when their contents do.
    """
    newest = 0
    for name in _SCRIPTS:
        try:
            newest = max(newest, int(os.path.getmtime(os.path.join(_PUBLIC_DIR, name))))
        except OSError:
            pass
    return str(newest or 0)


@router.get("/assets")
async def assets():
    """Current asset version, for the desktop app (which loads main.js
    statically and cannot be rewritten on the way out)."""
    return {"version": _asset_version()}


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    with open(os.path.join(_PUBLIC_DIR, "index.html")) as file:
        html = file.read().replace("__APP_VERSION__", _asset_version())
    return HTMLResponse(html)


# --- vault -------------------------------------------------------------------

@router.get("/vault-status")
async def vault_status(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        row = conn.execute(
            "SELECT salt,iterations,wrap_iv,wrap_ciphertext FROM vaults WHERE owner_id=?",
            (me["id"],),
        ).fetchone()
    if not row:
        return {"exists": False}
    return {
        "exists": True,
        "salt": row["salt"],
        "iterations": row["iterations"],
        "wrap_iv": row["wrap_iv"],
        "wrap_ciphertext": row["wrap_ciphertext"],
    }


@router.post("/vault-setup")
async def vault_setup(data: VaultSetupIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if (
        not _valid_b64(data.salt, 16, 128)
        or not 200000 <= data.iterations <= 1000000
        or not _valid_b64(data.wrap_iv, 12, 64)
        or not _valid_b64(data.wrap_ciphertext, 17, 256)
    ):
        return JSONResponse({"error": "invalid_vault_parameters"}, status_code=400)
    with _conn() as conn:
        exists = conn.execute("SELECT 1 FROM vaults WHERE owner_id=?", (me["id"],)).fetchone()
        if exists:
            return JSONResponse({"error": "vault_exists"}, status_code=409)
        conn.execute(
            "INSERT INTO vaults(owner_id,salt,iterations,wrap_iv,wrap_ciphertext) VALUES(?,?,?,?,?)",
            (me["id"], data.salt.strip(), data.iterations, data.wrap_iv.strip(), data.wrap_ciphertext.strip()),
        )
        conn.commit()
    return {"ok": True}


@router.post("/vault-rekey")
async def vault_rekey(data: VaultRekeyIn, x_pub_token: str = Header(default=None)):
    """Rewraps dataKey under a new master password and re-encrypts every
    entry's meta blob with the new vaultKey. Never touches an entry's own
    secret — that is the entire point of the envelope design.

    The caller must list every entry it currently owns, exactly. That is
    enforced here (not merely hoped for) so a client bug can never silently
    orphan an entry with meta encrypted under a vaultKey that no longer
    exists anywhere.
    """
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if (
        not _valid_b64(data.salt, 16, 128)
        or not 200000 <= data.iterations <= 1000000
        or not _valid_b64(data.wrap_iv, 12, 64)
        or not _valid_b64(data.wrap_ciphertext, 17, 256)
    ):
        return JSONResponse({"error": "invalid_vault_parameters"}, status_code=400)
    for entry in data.entries:
        if not _valid_b64(entry.iv_meta, 12, 64) or not _valid_b64(entry.ciphertext_meta, 17, 65536):
            return JSONResponse({"error": "invalid_entry"}, status_code=400)
    with _conn() as conn:
        if not conn.execute("SELECT 1 FROM vaults WHERE owner_id=?", (me["id"],)).fetchone():
            return JSONResponse({"error": "vault_missing"}, status_code=409)
        owned_ids = {r["id"] for r in conn.execute(
            "SELECT id FROM seed_entries WHERE owner_id=?", (me["id"],)
        ).fetchall()}
        sent_ids = {e.id for e in data.entries}
        if owned_ids != sent_ids:
            return JSONResponse({"error": "entry_set_mismatch"}, status_code=400)
        conn.execute(
            "UPDATE vaults SET salt=?,iterations=?,wrap_iv=?,wrap_ciphertext=?,updated_at=strftime('%s','now') WHERE owner_id=?",
            (data.salt.strip(), data.iterations, data.wrap_iv.strip(), data.wrap_ciphertext.strip(), me["id"]),
        )
        for entry in data.entries:
            conn.execute(
                "UPDATE seed_entries SET iv_meta=?,ciphertext_meta=?,updated_at=strftime('%s','now') WHERE id=? AND owner_id=?",
                (entry.iv_meta.strip(), entry.ciphertext_meta.strip(), entry.id, me["id"]),
            )
        conn.commit()
    return {"ok": True}


# --- seed entries --------------------------------------------------------------

@router.get("/seed-entries")
async def list_seed_entries(x_pub_token: str = Header(default=None)):
    """Every entry this caller owns — full stop. There is no separate
    "shared with me" branch any more: once a recipient accepts a transfer
    they get a perfectly normal owned row (see /shares/pending/{id}/accept),
    decryptable with their own vaultKey exactly like anything else here.

    Each row is annotated with `shares`: who the OWNER has shared it with
    (for the "shared with: ..." indicator and the manage-sharing dialog),
    each flagged `accepted` (has a derived copy) or still pending.
    """
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        own_rows = conn.execute(
            "SELECT id,iv_meta,ciphertext_meta,created_at,updated_at FROM seed_entries "
            "WHERE owner_id=? ORDER BY updated_at DESC",
            (me["id"],),
        ).fetchall()
        share_rows = []
        if own_rows:
            ids = [r["id"] for r in own_rows]
            placeholders = ",".join("?" for _ in ids)
            share_rows = conn.execute(
                f"SELECT source_entry_id,recipient_owner_id,recipient_entry_id FROM share_links "
                f"WHERE source_entry_id IN ({placeholders})",
                ids,
            ).fetchall()
    hub = _hub()
    recipient_ids = list({r["recipient_owner_id"] for r in share_rows})
    profiles = {p["id"]: p for p in hub.get_users_by_ids(recipient_ids)} if hub and recipient_ids else {}
    shares_by_entry = {}
    for r in share_rows:
        p = profiles.get(r["recipient_owner_id"], {})
        shares_by_entry.setdefault(r["source_entry_id"], []).append({
            "user_id": r["recipient_owner_id"],
            "username": p.get("username"),
            "display_name": p.get("display_name"),
            "accepted": r["recipient_entry_id"] is not None,
        })
    result = []
    for row in own_rows:
        d = dict(row)
        d["is_owner"] = True
        d["shares"] = shares_by_entry.get(row["id"], [])
        result.append(d)
    return result


@router.get("/seed-entries/{entry_id}/secret")
async def get_seed_entry_secret(entry_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        row = conn.execute(
            "SELECT owner_id,entry_salt,iv_secret,ciphertext_secret FROM seed_entries WHERE id=? AND owner_id=?",
            (entry_id, me["id"]),
        ).fetchone()
    if not row:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"entry_salt": row["entry_salt"], "iv_secret": row["iv_secret"], "ciphertext_secret": row["ciphertext_secret"]}


@router.post("/seed-entries")
async def add_seed_entry(data: SeedEntryCreateIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if (
        not _valid_b64(data.iv_meta, 12, 64)
        or not _valid_b64(data.ciphertext_meta, 17, 65536)
        or not _valid_b64(data.entry_salt, 16, 128)
        or not _valid_b64(data.iv_secret, 12, 64)
        or not _valid_b64(data.ciphertext_secret, 17, 65536)
    ):
        return JSONResponse({"error": "invalid_entry"}, status_code=400)
    entry_id = str(uuid.uuid4())
    with _conn() as conn:
        if not conn.execute("SELECT 1 FROM vaults WHERE owner_id=?", (me["id"],)).fetchone():
            return JSONResponse({"error": "vault_missing"}, status_code=409)
        conn.execute(
            "INSERT INTO seed_entries(id,owner_id,iv_meta,ciphertext_meta,entry_salt,iv_secret,ciphertext_secret) "
            "VALUES(?,?,?,?,?,?,?)",
            (
                entry_id, me["id"],
                data.iv_meta.strip(), data.ciphertext_meta.strip(),
                data.entry_salt.strip(), data.iv_secret.strip(), data.ciphertext_secret.strip(),
            ),
        )
        conn.commit()
    return {"id": entry_id}


@router.put("/seed-entries/{entry_id}")
async def update_seed_entry(entry_id: str, data: SeedEntryUpdateIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    meta_present = data.iv_meta is not None or data.ciphertext_meta is not None
    secret_present = data.entry_salt is not None or data.iv_secret is not None or data.ciphertext_secret is not None
    if meta_present and (not _valid_b64(data.iv_meta, 12, 64) or not _valid_b64(data.ciphertext_meta, 17, 65536)):
        return JSONResponse({"error": "invalid_entry"}, status_code=400)
    if secret_present and (
        not _valid_b64(data.entry_salt, 16, 128)
        or not _valid_b64(data.iv_secret, 12, 64)
        or not _valid_b64(data.ciphertext_secret, 17, 65536)
    ):
        return JSONResponse({"error": "invalid_entry"}, status_code=400)
    if not meta_present and not secret_present:
        return JSONResponse({"error": "nothing_to_update"}, status_code=400)
    with _conn() as conn:
        existing = conn.execute(
            "SELECT * FROM seed_entries WHERE id=? AND owner_id=?", (entry_id, me["id"])
        ).fetchone()
        if not existing:
            return JSONResponse({"error": "not_found"}, status_code=404)
        iv_meta = data.iv_meta.strip() if meta_present else existing["iv_meta"]
        ciphertext_meta = data.ciphertext_meta.strip() if meta_present else existing["ciphertext_meta"]
        entry_salt = data.entry_salt.strip() if secret_present else existing["entry_salt"]
        iv_secret = data.iv_secret.strip() if secret_present else existing["iv_secret"]
        ciphertext_secret = data.ciphertext_secret.strip() if secret_present else existing["ciphertext_secret"]
        conn.execute(
            "UPDATE seed_entries SET iv_meta=?,ciphertext_meta=?,entry_salt=?,iv_secret=?,ciphertext_secret=?,"
            "updated_at=strftime('%s','now') WHERE id=? AND owner_id=?",
            (iv_meta, ciphertext_meta, entry_salt, iv_secret, ciphertext_secret, entry_id, me["id"]),
        )
        conn.commit()
    # NOTE: this endpoint deliberately does NOT auto-reshare. Re-sharing
    # needs the freshly-edited plaintext, which only the browser has — see
    # POST /shares. The widget calls it again for every active share_links
    # row right after a successful PUT here.
    return {"ok": True}


def _cascade_delete_shares(conn, entry_id: str):
    """Call with `entry_id` already removed from seed_entries (or about to
    be). Cleans up every share_links/pending_shares row that references it
    either as the source (this entry's own outgoing shares — the recipient's
    derived copy is deleted too, recursively, in case they re-shared it
    onward) or as a recipient's now-gone derived copy (their inbound share
    record is dropped since there is nothing left to manage)."""
    outgoing = conn.execute(
        "SELECT recipient_owner_id,recipient_entry_id FROM share_links WHERE source_entry_id=?",
        (entry_id,),
    ).fetchall()
    for row in outgoing:
        if row["recipient_entry_id"]:
            conn.execute("DELETE FROM seed_entries WHERE id=?", (row["recipient_entry_id"],))
            _cascade_delete_shares(conn, row["recipient_entry_id"])
    conn.execute("DELETE FROM share_links WHERE source_entry_id=?", (entry_id,))
    conn.execute("DELETE FROM pending_shares WHERE source_entry_id=?", (entry_id,))
    conn.execute("DELETE FROM share_links WHERE recipient_entry_id=?", (entry_id,))


@router.delete("/seed-entries/{entry_id}")
async def delete_seed_entry(entry_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        result = conn.execute("DELETE FROM seed_entries WHERE id=? AND owner_id=?", (entry_id, me["id"]))
        if result.rowcount:
            _cascade_delete_shares(conn, entry_id)
        conn.execute("DELETE FROM entry_shares WHERE entry_id=?", (entry_id,))  # legacy table, harmless no-op
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


# --- sharing (one-time secure transfer) -------------------------------------
#
# See the module docstring for the full design. In short: POST /shares hands
# the server an already-encrypted (password-only) blob addressed to one
# recipient; the recipient fetches and decrypts it, re-creates the entry as
# a completely normal personal one via the existing POST /seed-entries, then
# calls accept to close the loop. share_links is the durable "who has an
# active copy" ledger the owner's later actions (edit, stop sharing) use to
# find and remove that copy — it is intentionally NOT a grant of any kind of
# ongoing access, unlike the legacy entry_shares table it replaces.
#
# Recipients are still picked from the caller's Apps Hub favourites, same
# gate budget's category_members / the previous round's entry_shares used.


@router.get("/seed-entries/{entry_id}/shares")
async def list_entry_shares(entry_id: str, x_pub_token: str = Header(default=None)):
    """Owner-only: who this entry has been shared with, each flagged
    `accepted` (has a derived copy already) or still pending. Used for the
    "shared with: ..." indicator and the manage-sharing dialog."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        entry = conn.execute("SELECT owner_id FROM seed_entries WHERE id=?", (entry_id,)).fetchone()
        if not entry or entry["owner_id"] != me["id"]:
            return JSONResponse({"error": "not_found"}, status_code=404)
        rows = conn.execute(
            "SELECT recipient_owner_id,recipient_entry_id,created_at,updated_at FROM share_links "
            "WHERE source_entry_id=? ORDER BY created_at",
            (entry_id,),
        ).fetchall()
    hub = _hub()
    profiles = {}
    if hub and rows:
        profiles = {p["id"]: p for p in hub.get_users_by_ids([r["recipient_owner_id"] for r in rows])}
    out = []
    for r in rows:
        p = profiles.get(r["recipient_owner_id"], {})
        out.append({
            "user_id": r["recipient_owner_id"],
            "username": p.get("username"),
            "display_name": p.get("display_name"),
            "avatar_color": p.get("avatar_color"),
            "avatar_svg": p.get("avatar_svg"),
            "accepted": r["recipient_entry_id"] is not None,
            "created_at": r["created_at"],
        })
    return out


@router.post("/shares")
async def create_share(data: ShareCreateIn, x_pub_token: str = Header(default=None)):
    """Start (or restart, for an edit-triggered re-share) a transfer. The
    caller must own source_entry_id and the recipient must already be a
    favourite — the server never sees the plaintext or the shared password,
    only the already-encrypted blob.

    Posting again for a pair that already has a share_links row (the edit
    re-share case) supersedes any not-yet-accepted transfer for that pair
    and resets recipient_entry_id back to NULL — the old copy, if any, is
    left untouched here; the widget calls DELETE .../share/{id} first for
    that (see the module docstring: "delete then re-send", not merge).
    """
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    hub = _hub()
    if not hub:
        return JSONResponse({"error": "apps_hub_unavailable"}, status_code=500)
    recipient_id = (data.recipient_owner_id or "").strip()
    source_entry_id = (data.source_entry_id or "").strip()
    if not recipient_id or not source_entry_id:
        return JSONResponse({"error": "invalid_target"}, status_code=400)
    if recipient_id == me["id"]:
        return JSONResponse({"error": "cannot_share_with_self"}, status_code=400)
    if (
        not _valid_b64(data.transfer_salt, 16, 128)
        or not _valid_b64(data.iv, 12, 64)
        or not _valid_b64(data.ciphertext, 17, 131072)
    ):
        return JSONResponse({"error": "invalid_share"}, status_code=400)
    with _conn() as conn:
        entry = conn.execute("SELECT owner_id FROM seed_entries WHERE id=?", (source_entry_id,)).fetchone()
        if not entry:
            return JSONResponse({"error": "not_found"}, status_code=404)
        if entry["owner_id"] != me["id"]:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        favourites = hub.get_favourites(me["id"])
        if recipient_id not in {f["id"] for f in favourites}:
            return JSONResponse({"error": "user is not in your favourites"}, status_code=400)
        # Supersede any transfer for this exact pair that's still unaccepted
        # (a fresh share replaces it outright — there is never more than one
        # live transfer per (entry, recipient) pair).
        conn.execute(
            "DELETE FROM pending_shares WHERE source_entry_id=? AND recipient_owner_id=?",
            (source_entry_id, recipient_id),
        )
        share_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO pending_shares(id,source_entry_id,source_owner_id,recipient_owner_id,transfer_salt,iv,ciphertext) "
            "VALUES(?,?,?,?,?,?,?)",
            (share_id, source_entry_id, me["id"], recipient_id, data.transfer_salt.strip(), data.iv.strip(), data.ciphertext.strip()),
        )
        existing_link = conn.execute(
            "SELECT 1 FROM share_links WHERE source_entry_id=? AND recipient_owner_id=?",
            (source_entry_id, recipient_id),
        ).fetchone()
        if existing_link:
            conn.execute(
                "UPDATE share_links SET recipient_entry_id=NULL,updated_at=strftime('%s','now') "
                "WHERE source_entry_id=? AND recipient_owner_id=?",
                (source_entry_id, recipient_id),
            )
        else:
            conn.execute(
                "INSERT INTO share_links(source_entry_id,recipient_owner_id,recipient_entry_id) VALUES(?,?,NULL)",
                (source_entry_id, recipient_id),
            )
        conn.commit()
    return {"id": share_id}


@router.delete("/seed-entries/{entry_id}/share/{recipient_owner_id}")
async def stop_sharing(entry_id: str, recipient_owner_id: str, x_pub_token: str = Header(default=None)):
    """The ONLY revocation mechanism: deletes the recipient's derived copy
    outright (a plain row delete — the server needs no key of theirs to do
    this), any still-pending un-accepted transfer, and the share_links
    record itself. No new share is sent."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        entry = conn.execute("SELECT owner_id FROM seed_entries WHERE id=?", (entry_id,)).fetchone()
        if not entry or entry["owner_id"] != me["id"]:
            return JSONResponse({"error": "not_found"}, status_code=404)
        link = conn.execute(
            "SELECT recipient_entry_id FROM share_links WHERE source_entry_id=? AND recipient_owner_id=?",
            (entry_id, recipient_owner_id),
        ).fetchone()
        if not link:
            return JSONResponse({"error": "not_found"}, status_code=404)
        if link["recipient_entry_id"]:
            conn.execute("DELETE FROM seed_entries WHERE id=?", (link["recipient_entry_id"],))
            _cascade_delete_shares(conn, link["recipient_entry_id"])
        conn.execute(
            "DELETE FROM pending_shares WHERE source_entry_id=? AND recipient_owner_id=?",
            (entry_id, recipient_owner_id),
        )
        conn.execute(
            "DELETE FROM share_links WHERE source_entry_id=? AND recipient_owner_id=?",
            (entry_id, recipient_owner_id),
        )
        conn.commit()
    return {"ok": True}


# --- sharing: recipient side -------------------------------------------------

@router.get("/shares/pending")
async def list_pending_shares(x_pub_token: str = Header(default=None)):
    """Transfers addressed to the caller, awaiting accept. Deliberately no
    plaintext, salt, iv or ciphertext here — those are fetched only on an
    actual accept attempt, see GET /shares/pending/{id}."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id,source_owner_id,created_at FROM pending_shares "
            "WHERE recipient_owner_id=? ORDER BY created_at DESC",
            (me["id"],),
        ).fetchall()
    hub = _hub()
    profiles = {}
    if hub and rows:
        profiles = {p["id"]: p for p in hub.get_users_by_ids([r["source_owner_id"] for r in rows])}
    out = []
    for r in rows:
        p = profiles.get(r["source_owner_id"], {})
        out.append({
            "id": r["id"],
            "created_at": r["created_at"],
            "source_owner": {
                "user_id": r["source_owner_id"],
                "username": p.get("username"),
                "display_name": p.get("display_name"),
            },
        })
    return out


@router.get("/shares/pending/{share_id}")
async def get_pending_share(share_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        row = conn.execute(
            "SELECT transfer_salt,iv,ciphertext FROM pending_shares WHERE id=? AND recipient_owner_id=?",
            (share_id, me["id"]),
        ).fetchone()
    if not row:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"transfer_salt": row["transfer_salt"], "iv": row["iv"], "ciphertext": row["ciphertext"]}


@router.post("/shares/pending/{share_id}/accept")
async def accept_pending_share(share_id: str, data: ShareAcceptIn, x_pub_token: str = Header(default=None)):
    """Closes the loop: the recipient has already decrypted the transfer
    client-side and created their own normal dual-protected entry from it
    (POST /seed-entries) — this just deletes the now-consumed pending row
    and records where the owner's later actions can find that new entry."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    entry_id = (data.created_entry_id or "").strip()
    if not entry_id:
        return JSONResponse({"error": "invalid_entry"}, status_code=400)
    with _conn() as conn:
        share = conn.execute(
            "SELECT source_entry_id FROM pending_shares WHERE id=? AND recipient_owner_id=?",
            (share_id, me["id"]),
        ).fetchone()
        if not share:
            return JSONResponse({"error": "not_found"}, status_code=404)
        owns_entry = conn.execute(
            "SELECT 1 FROM seed_entries WHERE id=? AND owner_id=?", (entry_id, me["id"])
        ).fetchone()
        if not owns_entry:
            return JSONResponse({"error": "invalid_entry"}, status_code=400)
        conn.execute("DELETE FROM pending_shares WHERE id=?", (share_id,))
        conn.execute(
            "UPDATE share_links SET recipient_entry_id=?,updated_at=strftime('%s','now') "
            "WHERE source_entry_id=? AND recipient_owner_id=?",
            (entry_id, share["source_entry_id"], me["id"]),
        )
        conn.commit()
    return {"ok": True}


# --- portfolio -----------------------------------------------------------------
#
# Zero-knowledge: address, label, network, token info and the last known
# balance all live inside one vaultKey-encrypted blob per row, exactly like a
# seed entry's ciphertext_meta — this server never sees any of it, only
# id/iv/ciphertext. That also means every balance/token-metadata/price-by-
# contract lookup that used to happen here now happens in the browser
# instead (see mvmcrypto-widget.js), since only the browser ever holds the
# decrypted address to look up. The one exception is native-asset USD price
# (_get_prices below) — "what is 1 ETH worth" identifies nobody, so it stays
# a small server-side cache shared across every visitor.

def _http_get_json(url: str, timeout: float = 8.0):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# Esplora-shaped block explorer APIs (blockstream.info and mempool.space
# expose the identical REST shape) — "first source that answers wins"
# resiliency, shared by the BTC balance fetch and the in-app explorer
# endpoints further down. BTC is the only network with this in-app explorer
# treatment; every other network just gets a link to its own public explorer,
# built client-side (mvmcrypto-widget.js).
_ESPLORA_BASES = ("https://blockstream.info/api", "https://mempool.space/api")


def _esplora_get(path: str, timeout: float = 10.0):
    last_err = None
    for base in _ESPLORA_BASES:
        try:
            return _http_get_json(f"{base}{path}", timeout=timeout)
        except Exception as e:
            last_err = e
    raise last_err


def _fetch_balance_sat(address: str) -> int:
    data = _esplora_get(f"/address/{address}", timeout=10.0)
    chain = data.get("chain_stats") or {}
    mempool = data.get("mempool_stats") or {}
    funded = int(chain.get("funded_txo_sum", 0)) + int(mempool.get("funded_txo_sum", 0))
    spent = int(chain.get("spent_txo_sum", 0)) + int(mempool.get("spent_txo_sum", 0))
    return funded - spent


_ADDR_RE = re.compile(r"^[A-Za-z0-9]+$")
_TXID_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _valid_address(address: str) -> bool:
    """BTC-only — the in-app Explorer (below) is the one remaining feature
    that takes a plaintext address, since it looks up public data ad hoc and
    never stores anything."""
    a = (address or "").strip()
    if not (26 <= len(a) <= 90) or not _ADDR_RE.fullmatch(a):
        return False
    return a.startswith("1") or a.startswith("3") or a.lower().startswith("bc1")


def _valid_txid(txid: str) -> bool:
    return bool(_TXID_RE.fullmatch((txid or "").strip()))


# Native-asset USD prices only — "what is 1 ETH worth" is public and
# identifies nobody, so this one lookup stays server-side for the shared
# cache. Anything that *would* identify a holding (a balance, a token by
# contract address) is looked up by the browser directly (see
# mvmcrypto-widget.js) since only it ever holds the decrypted address.
_NETWORK_PRICE_IDS = {
    "BTC": "bitcoin", "ETH": "ethereum", "BNB": "binancecoin",
    "MATIC": "matic-network", "LTC": "litecoin", "DOGE": "dogecoin", "TRX": "tron",
}

_PRICE_CACHE = {"prices": {}, "ts": 0.0}
_PRICE_TTL = 60.0


def _get_prices():
    """{network_code: usd_price}, from one CoinGecko call cached for ~60s —
    opening the app or repeatedly hitting refresh must not hammer the price
    API on every request."""
    now = time.time()
    if _PRICE_CACHE["prices"] and now - _PRICE_CACHE["ts"] < _PRICE_TTL:
        return _PRICE_CACHE["prices"], _PRICE_CACHE["ts"]
    ids = ",".join(sorted(set(_NETWORK_PRICE_IDS.values())))
    try:
        data = _http_get_json(f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd")
        prices = {
            code: float(data[cg_id]["usd"])
            for code, cg_id in _NETWORK_PRICE_IDS.items()
            if cg_id in data and "usd" in data[cg_id]
        }
        if prices:
            _PRICE_CACHE["prices"] = prices
            _PRICE_CACHE["ts"] = now
    except Exception:
        pass
    return _PRICE_CACHE["prices"], _PRICE_CACHE["ts"]


def _custom_premium():
    premium = sys.modules.get("backend.premium")
    return premium.load_premium_backend(APP_ID) if premium else None


def _blob_row_payload(row):
    """A row is either fully migrated (iv/ciphertext set — server sees
    nothing) or still legacy (from before encryption landed — plaintext
    columns populated, iv/ciphertext NULL). The client re-encrypts a legacy
    row the moment it decrypts it once, so this fallback is temporary per
    row and never written again after that first load."""
    if row["ciphertext"]:
        return {"id": row["id"], "iv": row["iv"], "ciphertext": row["ciphertext"], "created_at": row["created_at"]}
    return {"id": row["id"], "legacy": True, "created_at": row["created_at"],
            **{k: row[k] for k in row.keys() if k not in ("id", "iv", "ciphertext", "created_at", "owner_id")}}


_ADDRESS_COLUMNS = ("id,address,label,coin,token_contract,token_symbol,token_decimals,"
                    "balance_sat,last_updated,iv,ciphertext,created_at")


@router.get("/addresses")
async def list_addresses(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        rows = conn.execute(
            f"SELECT {_ADDRESS_COLUMNS} FROM addresses WHERE owner_id=? ORDER BY created_at",
            (me["id"],),
        ).fetchall()
    prices, price_ts = _get_prices()
    module = _custom_premium()
    return {
        "addresses": [_blob_row_payload(row) for row in rows],
        "custom_assets": module.list_assets(me["id"]) if module else [],
        # Whether this installation may use custom assets at all — the
        # licence of the server, not of the viewer, so every surface (desktop,
        # public page, extension) gets the same answer. Same reasoning as
        # mvmPasswords' "totp"/"audit" flags on its own vault response.
        "custom_assets_enabled": module is not None,
        "prices": prices,
        "price_updated_at": int(price_ts) if price_ts else None,
    }


@router.post("/addresses")
async def add_address(data: EncryptedBlobIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_address"}, status_code=400)
    address_id = str(uuid.uuid4())
    with _conn() as conn:
        conn.execute(
            "INSERT INTO addresses(id,owner_id,iv,ciphertext) VALUES(?,?,?,?)",
            (address_id, me["id"], data.iv.strip(), data.ciphertext.strip()),
        )
        conn.commit()
    return {"id": address_id}


@router.put("/addresses/{address_id}")
async def update_address(address_id: str, data: EncryptedBlobIn, x_pub_token: str = Header(default=None)):
    """Used both to migrate a legacy plaintext row on first load and to
    write back a new balance after the browser refreshes it — either way
    the whole row content is one fresh blob, never a partial update."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_address"}, status_code=400)
    with _conn() as conn:
        result = conn.execute(
            "UPDATE addresses SET iv=?,ciphertext=? WHERE id=? AND owner_id=?",
            (data.iv.strip(), data.ciphertext.strip(), address_id, me["id"]),
        )
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


@router.delete("/addresses/{address_id}")
async def delete_address(address_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        result = conn.execute("DELETE FROM addresses WHERE id=? AND owner_id=?", (address_id, me["id"]))
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


# --- custom assets (premium) -------------------------------------------------
#
# Every route here is a hollow delegation to premium/backend.py, exactly like
# mvmPasswords' 2FA/audit routes — an unlicensed install never receives that
# folder, so _custom_premium() is None and every route below answers a plain
# "premium_required" without the base app ever needing to know why.

@router.get("/custom-assets")
async def list_custom_assets(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    return module.list_assets(me["id"])


@router.post("/custom-assets")
async def add_custom_asset(data: EncryptedBlobIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_asset"}, status_code=400)
    return module.add_asset(me["id"], data.iv.strip(), data.ciphertext.strip())


@router.put("/custom-assets/{asset_id}")
async def update_custom_asset(asset_id: str, data: EncryptedBlobIn, x_pub_token: str = Header(default=None)):
    """Only ever used to migrate a legacy plaintext asset name on first
    load — an asset's name never changes otherwise."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_asset"}, status_code=400)
    if not module.update_asset(me["id"], asset_id, data.iv.strip(), data.ciphertext.strip()):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


@router.delete("/custom-assets/{asset_id}")
async def delete_custom_asset(asset_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    if not module.delete_asset(me["id"], asset_id):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


@router.get("/custom-assets/{asset_id}/transactions")
async def list_custom_txns(asset_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    return module.list_transactions(me["id"], asset_id)


@router.post("/custom-assets/{asset_id}/transactions")
async def add_custom_txn(asset_id: str, data: EncryptedBlobIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_txn"}, status_code=400)
    result = module.add_transaction(me["id"], asset_id, data.iv.strip(), data.ciphertext.strip())
    if result is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return result


@router.put("/custom-assets/{asset_id}/transactions/{txn_id}")
async def update_custom_txn(asset_id: str, txn_id: str, data: EncryptedBlobIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_txn"}, status_code=400)
    if not module.update_transaction(me["id"], asset_id, txn_id, data.iv.strip(), data.ciphertext.strip()):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


@router.delete("/custom-assets/{asset_id}/transactions/{txn_id}")
async def delete_custom_txn(asset_id: str, txn_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _custom_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    if not module.delete_transaction(me["id"], asset_id, txn_id):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


# --- explorer --------------------------------------------------------------
#
# A read-only lookup of public blockchain data (any address or txid, not
# just ones saved to the portfolio) — same non-secret stance as the
# portfolio addresses above. Gated behind login purely to avoid running an
# open proxy for anonymous traffic, not because the data itself is private.

def _tx_delta_for_address(tx: dict, address: str) -> int:
    received = sum(o.get("value", 0) or 0 for o in tx.get("vout", []) if o.get("scriptpubkey_address") == address)
    sent = sum(
        (v.get("prevout") or {}).get("value", 0) or 0
        for v in tx.get("vin", [])
        if (v.get("prevout") or {}).get("scriptpubkey_address") == address
    )
    return received - sent


def _tx_summary_row(tx: dict, address: str) -> dict:
    status = tx.get("status") or {}
    return {
        "txid": tx["txid"],
        "confirmed": bool(status.get("confirmed")),
        "block_time": status.get("block_time"),
        "fee_sat": tx.get("fee"),
        "delta_sat": _tx_delta_for_address(tx, address),
    }


@router.get("/explorer/address/{address}")
async def explorer_address(address: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    address = address.strip()
    if not _valid_address(address):
        return JSONResponse({"error": "invalid_address"}, status_code=400)
    try:
        summary = _esplora_get(f"/address/{address}")
        txs = _esplora_get(f"/address/{address}/txs")
    except Exception:
        return JSONResponse({"error": "explorer_unavailable"}, status_code=502)
    chain = summary.get("chain_stats") or {}
    mempool = summary.get("mempool_stats") or {}
    funded = int(chain.get("funded_txo_sum", 0)) + int(mempool.get("funded_txo_sum", 0))
    spent = int(chain.get("spent_txo_sum", 0)) + int(mempool.get("spent_txo_sum", 0))
    confirmed_total = int(chain.get("tx_count", 0))
    rows = [_tx_summary_row(tx, address) for tx in txs]
    confirmed_returned = sum(1 for r in rows if r["confirmed"])
    return {
        "address": address,
        "balance_sat": funded - spent,
        "total_received_sat": funded,
        "total_sent_sat": spent,
        "tx_count": confirmed_total + int(mempool.get("tx_count", 0)),
        "txs": rows,
        "has_more": confirmed_returned < confirmed_total,
    }


@router.get("/explorer/address/{address}/txs")
async def explorer_address_txs(address: str, before: str = "", x_pub_token: str = Header(default=None)):
    """Older page of an address's history — `before` is the last txid
    already shown, per Esplora's own cursor convention for this call."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    address = address.strip()
    if not _valid_address(address):
        return JSONResponse({"error": "invalid_address"}, status_code=400)
    if not _valid_txid(before):
        return JSONResponse({"error": "invalid_cursor"}, status_code=400)
    try:
        txs = _esplora_get(f"/address/{address}/txs/chain/{before}")
    except Exception:
        return JSONResponse({"error": "explorer_unavailable"}, status_code=502)
    rows = [_tx_summary_row(tx, address) for tx in txs]
    return {"txs": rows, "has_more": len(rows) >= 25}


@router.get("/explorer/tx/{txid}")
async def explorer_tx(txid: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    txid = txid.strip()
    if not _valid_txid(txid):
        return JSONResponse({"error": "invalid_txid"}, status_code=400)
    try:
        tx = _esplora_get(f"/tx/{txid}")
    except Exception:
        return JSONResponse({"error": "explorer_unavailable"}, status_code=502)
    status = tx.get("status") or {}
    vin = [{
        "address": (v.get("prevout") or {}).get("scriptpubkey_address"),
        "value_sat": (v.get("prevout") or {}).get("value"),
        "coinbase": bool(v.get("is_coinbase")),
    } for v in tx.get("vin", [])]
    vout = [{
        "address": v.get("scriptpubkey_address"),
        "value_sat": v.get("value"),
    } for v in tx.get("vout", [])]
    return {
        "txid": tx["txid"],
        "confirmed": bool(status.get("confirmed")),
        "block_height": status.get("block_height"),
        "block_time": status.get("block_time"),
        "fee_sat": tx.get("fee"),
        "size": tx.get("size"),
        "weight": tx.get("weight"),
        "vin": vin,
        "vout": vout,
        "total_in_sat": sum(v["value_sat"] or 0 for v in vin),
        "total_out_sat": sum(v["value_sat"] or 0 for v in vout),
    }
