"""BwalletT — encrypted per-profile Bitcoin wallet storage and network gateway.

The wallet password, mnemonic, derived private keys and unsigned wallet state
never reach this service. The browser encrypts one wallet document with
PBKDF2-SHA256 and AES-256-GCM; this module stores only the salt, IV and opaque
ciphertext scoped to the authenticated Apps Hub profile.

Public blockchain reads and signed-transaction broadcast use fixed Esplora
endpoints. The gateway deliberately accepts only validated Bitcoin identifiers
and never a caller-provided URL.
"""

import asyncio
import base64
import hashlib
import os
import re
import sqlite3
import sys
from typing import Optional

import httpx
from fastapi import APIRouter, Header
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel


router = APIRouter()
APP_ID = "bwallett"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_B64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
_TXID_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")
_BASE58_RE = re.compile(r"^[mn2][1-9A-HJ-NP-Za-km-z]{25,61}$")
_BECH32_RE = re.compile(r"^tb1[ac-hj-np-z02-9]{8,87}$", re.IGNORECASE)
_NETWORK_BASES = {
    "testnet3": (
        "https://mempool.space/testnet/api",
        "https://blockstream.info/testnet/api",
    ),
}
_HTTP_HEADERS = {"User-Agent": "Mozilla/5.0 (mvmOS BwalletT/1.0)"}
_SCRIPTS = ("i18n.js", "bwallett-crypto.js", "bwallett-widget.js")


def _hub():
    return sys.modules.get("backend.apphub")


def _user(token: Optional[str]):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None


def _private_response():
    return JSONResponse({"error": "unauthorized"}, status_code=401)


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db():
    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS wallets (
                owner_id   TEXT PRIMARY KEY,
                salt       TEXT NOT NULL,
                iterations INTEGER NOT NULL DEFAULT 600000,
                iv         TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                revision   INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        conn.commit()


_init_db()


class WalletCreateIn(BaseModel):
    salt: str
    iterations: int = 600000
    iv: str
    ciphertext: str


class WalletUpdateIn(BaseModel):
    salt: str
    iterations: int = 600000
    iv: str
    ciphertext: str
    revision: int


class AddressRef(BaseModel):
    address: str
    branch: int
    address_index: int


class SyncIn(BaseModel):
    network: str = "testnet3"
    addresses: list[AddressRef]


class BroadcastIn(BaseModel):
    network: str = "testnet3"
    raw_tx: str
    recipient: str
    amount_sats: int


class SendPolicyIn(BaseModel):
    min_send_sats: int = 0
    max_send_sats: int = 0


def _valid_b64(value: str, minimum: int, maximum: int) -> bool:
    value = (value or "").strip()
    if len(value) > maximum or not _B64_RE.fullmatch(value):
        return False
    try:
        return len(base64.b64decode(value, validate=True)) >= minimum
    except Exception:
        return False


def _valid_wallet(data) -> bool:
    return (
        _valid_b64(data.salt, 16, 128)
        and 200_000 <= data.iterations <= 1_000_000
        and _valid_b64(data.iv, 12, 64)
        and _valid_b64(data.ciphertext, 17, 262_144)
    )


def _valid_address(value: str) -> bool:
    value = (value or "").strip()
    if not (_BASE58_RE.fullmatch(value) or _BECH32_RE.fullmatch(value)):
        return False
    if value.lower().startswith("tb1") and not (value.islower() or value.isupper()):
        return False
    return True


def _premium():
    premium = sys.modules.get("backend.premium")
    return premium.load_premium_backend(APP_ID) if premium else None


def _admin(token: Optional[str]):
    user = _user(token)
    return user if user and user.get("is_admin") else None


def _read_varint(raw: bytes, offset: int) -> tuple[int, int]:
    if offset >= len(raw):
        raise ValueError("truncated transaction")
    prefix = raw[offset]
    if prefix < 0xFD:
        return prefix, offset + 1
    sizes = {0xFD: 2, 0xFE: 4, 0xFF: 8}
    size = sizes[prefix]
    end = offset + 1 + size
    if end > len(raw):
        raise ValueError("truncated transaction")
    return int.from_bytes(raw[offset + 1:end], "little"), end


def _transaction_outputs(raw_hex: str) -> list[tuple[int, bytes]]:
    """Read output values/scripts from a legacy or SegWit transaction."""
    raw = bytes.fromhex(raw_hex)
    if len(raw) < 10:
        raise ValueError("truncated transaction")
    offset = 4
    if raw[offset:offset + 2] == b"\x00\x01":
        offset += 2
    inputs, offset = _read_varint(raw, offset)
    if inputs < 1 or inputs > 100_000:
        raise ValueError("invalid input count")
    for _ in range(inputs):
        offset += 36
        script_len, offset = _read_varint(raw, offset)
        offset += script_len + 4
        if offset > len(raw):
            raise ValueError("truncated transaction")
    count, offset = _read_varint(raw, offset)
    if count < 1 or count > 100_000:
        raise ValueError("invalid output count")
    outputs = []
    for _ in range(count):
        if offset + 8 > len(raw):
            raise ValueError("truncated transaction")
        value = int.from_bytes(raw[offset:offset + 8], "little")
        offset += 8
        script_len, offset = _read_varint(raw, offset)
        end = offset + script_len
        if end > len(raw):
            raise ValueError("truncated transaction")
        outputs.append((value, raw[offset:end]))
        offset = end
    return outputs


def _base58_payload(value: str) -> bytes:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    number = 0
    for char in value:
        number = number * 58 + alphabet.index(char)
    decoded = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    decoded = b"\x00" * (len(value) - len(value.lstrip("1"))) + decoded
    if len(decoded) != 25 or hashlib.sha256(hashlib.sha256(decoded[:-4]).digest()).digest()[:4] != decoded[-4:]:
        raise ValueError("invalid base58 address")
    return decoded[:-4]


def _bech32_program(value: str) -> tuple[int, bytes]:
    charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    value = value.lower()
    split = value.rfind("1")
    if split < 1 or value[:split] != "tb" or split + 7 > len(value):
        raise ValueError("invalid bech32 address")
    data = [charset.index(char) for char in value[split + 1:]]
    values = [ord(char) >> 5 for char in "tb"] + [0] + [ord(char) & 31 for char in "tb"] + data
    check = 1
    for item in values:
        top = check >> 25
        check = (check & 0x1FFFFFF) << 5 ^ item
        for bit, generator in enumerate((0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)):
            if (top >> bit) & 1:
                check ^= generator
    version, payload = data[0], data[1:-6]
    expected = 1 if version == 0 else 0x2BC830A3
    if version > 16 or check != expected:
        raise ValueError("invalid bech32 checksum")
    acc = bits = 0
    program = bytearray()
    for item in payload:
        acc = (acc << 5) | item
        bits += 5
        while bits >= 8:
            bits -= 8
            program.append((acc >> bits) & 0xFF)
    if bits >= 5 or ((acc << (8 - bits)) & 0xFF):
        raise ValueError("invalid bech32 padding")
    if not 2 <= len(program) <= 40 or (version == 0 and len(program) not in (20, 32)):
        raise ValueError("invalid witness program")
    return version, bytes(program)


def _address_script(value: str) -> bytes:
    if value.lower().startswith("tb1"):
        version, program = _bech32_program(value)
        opcode = 0 if version == 0 else 0x50 + version
        return bytes((opcode, len(program))) + program
    payload = _base58_payload(value)
    if payload[0] == 0x6F:
        return b"\x76\xa9\x14" + payload[1:] + b"\x88\xac"
    if payload[0] == 0xC4:
        return b"\xa9\x14" + payload[1:] + b"\x87"
    raise ValueError("wrong address network")


def _contains_payment(raw_hex: str, recipient: str, amount_sats: int) -> bool:
    try:
        script = _address_script(recipient)
        return (amount_sats, script) in _transaction_outputs(raw_hex)
    except (ValueError, IndexError):
        return False


def _asset_version():
    newest = 0
    for name in _SCRIPTS:
        try:
            newest = max(newest, int(os.path.getmtime(os.path.join(_PUBLIC_DIR, name))))
        except OSError:
            pass
    return str(newest or 0)


async def _get(path: str, network: str = "testnet3"):
    last_error = None
    async with httpx.AsyncClient(timeout=12, headers=_HTTP_HEADERS) as client:
        for base in _NETWORK_BASES[network]:
            try:
                response = await client.get(base + path)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
    raise last_error or RuntimeError("network_unavailable")


async def _get_text(path: str, network: str = "testnet3"):
    last_error = None
    async with httpx.AsyncClient(timeout=12, headers=_HTTP_HEADERS) as client:
        for base in _NETWORK_BASES[network]:
            try:
                response = await client.get(base + path)
                response.raise_for_status()
                return response.text
            except httpx.HTTPError as exc:
                last_error = exc
    raise last_error or RuntimeError("network_unavailable")


async def _post_tx(raw_tx: str, network: str = "testnet3"):
    last_error = None
    async with httpx.AsyncClient(timeout=15, headers=_HTTP_HEADERS) as client:
        for base in _NETWORK_BASES[network]:
            try:
                response = await client.post(
                    base + "/tx",
                    content=raw_tx,
                    headers={**_HTTP_HEADERS, "Content-Type": "text/plain"},
                )
                response.raise_for_status()
                return response.text.strip()
            except httpx.HTTPStatusError as exc:
                # A deterministic rejection (invalid transaction, already
                # spent input, etc.) should be shown to the user, not hidden
                # behind a second provider's different wording.
                if exc.response.status_code < 500:
                    return JSONResponse(
                        {"error": "broadcast_rejected", "detail": exc.response.text[:500]},
                        status_code=400,
                    )
                last_error = exc
            except httpx.HTTPError as exc:
                last_error = exc
    raise last_error or RuntimeError("network_unavailable")


@router.get("/assets")
async def assets():
    return {"version": _asset_version()}


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return HTMLResponse("", status_code=403)
    with open(os.path.join(_PUBLIC_DIR, "index.html")) as file:
        html = file.read().replace("__APP_VERSION__", _asset_version())
    return HTMLResponse(html)


@router.get("/wallet")
async def get_wallet(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        row = conn.execute(
            "SELECT salt,iterations,iv,ciphertext,revision,created_at,updated_at "
            "FROM wallets WHERE owner_id=?",
            (me["id"],),
        ).fetchone()
    return {"exists": False} if not row else {"exists": True, **dict(row)}


@router.post("/wallet")
async def create_wallet(data: WalletCreateIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_wallet(data):
        return JSONResponse({"error": "invalid_wallet"}, status_code=400)
    try:
        with _conn() as conn:
            conn.execute(
                "INSERT INTO wallets(owner_id,salt,iterations,iv,ciphertext) VALUES(?,?,?,?,?)",
                (me["id"], data.salt.strip(), data.iterations, data.iv.strip(), data.ciphertext.strip()),
            )
            conn.commit()
    except sqlite3.IntegrityError:
        return JSONResponse({"error": "wallet_exists"}, status_code=409)
    return {"ok": True, "revision": 1}


@router.put("/wallet")
async def update_wallet(data: WalletUpdateIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_wallet(data) or data.revision < 1:
        return JSONResponse({"error": "invalid_wallet"}, status_code=400)
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE wallets SET salt=?,iterations=?,iv=?,ciphertext=?,revision=revision+1,"
            "updated_at=strftime('%s','now') WHERE owner_id=? AND revision=?",
            (data.salt.strip(), data.iterations, data.iv.strip(), data.ciphertext.strip(), me["id"], data.revision),
        )
        conn.commit()
    if not cur.rowcount:
        return JSONResponse({"error": "wallet_changed"}, status_code=409)
    return {"ok": True, "revision": data.revision + 1}


async def _sync_one(ref: AddressRef, gate: asyncio.Semaphore, network: str):
    async def limited(path):
        async with gate:
            return await _get(path, network)

    status, utxos, txs = await asyncio.gather(
        limited(f"/address/{ref.address}"),
        limited(f"/address/{ref.address}/utxo"),
        limited(f"/address/{ref.address}/txs"),
    )
    return {
        "address": ref.address,
        "branch": ref.branch,
        "address_index": ref.address_index,
        "chain_stats": status.get("chain_stats", {}),
        "mempool_stats": status.get("mempool_stats", {}),
        "utxos": utxos,
        "txs": txs,
    }


@router.post("/network/sync")
async def network_sync(data: SyncIn, x_pub_token: str = Header(default=None)):
    if not _user(x_pub_token):
        return _private_response()
    if data.network not in _NETWORK_BASES or not data.addresses or len(data.addresses) > 30:
        return JSONResponse({"error": "invalid_address_set"}, status_code=400)
    seen = set()
    for ref in data.addresses:
        if (
            not _valid_address(ref.address)
            or ref.address in seen
            or ref.branch not in (0, 1)
            or not 0 <= ref.address_index <= 10_000
        ):
            return JSONResponse({"error": "invalid_address_set"}, status_code=400)
        seen.add(ref.address)
    try:
        gate = asyncio.Semaphore(6)
        rows = await asyncio.gather(*(_sync_one(ref, gate, data.network) for ref in data.addresses))
    except (httpx.HTTPError, ValueError, RuntimeError):
        return JSONResponse({"error": "network_unavailable"}, status_code=502)
    txs = {}
    for row in rows:
        for tx in row.pop("txs"):
            txs[tx.get("txid", "")] = tx
    return {"addresses": rows, "transactions": list(txs.values())}


@router.get("/network/fees")
async def network_fees(network: str = "testnet3", x_pub_token: str = Header(default=None)):
    if not _user(x_pub_token):
        return _private_response()
    if network not in _NETWORK_BASES:
        return JSONResponse({"error": "invalid_network"}, status_code=400)
    try:
        return await _get("/v1/fees/recommended", network)
    except (httpx.HTTPError, ValueError, RuntimeError):
        return JSONResponse({"error": "network_unavailable"}, status_code=502)


@router.get("/send-policy")
async def send_policy(x_pub_token: str = Header(default=None)):
    user = _user(x_pub_token)
    if not user:
        return _private_response()
    # The configured range controls public users only.  Keep the server owner
    # unrestricted even when they use the regular wallet send flow.
    if user.get("is_admin"):
        return {"min_send_sats": 0, "max_send_sats": 0}
    premium = _premium()
    if not premium or not hasattr(premium, "get_policy"):
        return {"min_send_sats": 0, "max_send_sats": 0}
    return premium.get_policy()


@router.get("/admin/send-policy")
async def admin_send_policy(x_pub_token: str = Header(default=None)):
    if not _admin(x_pub_token):
        return JSONResponse({"error": "admin_required"}, status_code=403)
    premium = _premium()
    enabled = bool(premium and premium.is_available())
    policy = premium.get_policy() if enabled and hasattr(premium, "get_policy") else {
        "min_send_sats": 0,
        "max_send_sats": 0,
    }
    return {"premium": enabled, **policy}


@router.put("/admin/send-policy")
async def save_admin_send_policy(data: SendPolicyIn, x_pub_token: str = Header(default=None)):
    if not _admin(x_pub_token):
        return JSONResponse({"error": "admin_required"}, status_code=403)
    if (
        data.min_send_sats < 0
        or data.max_send_sats < 0
        or data.min_send_sats > 2_100_000_000_000_000
        or data.max_send_sats > 2_100_000_000_000_000
        or (data.max_send_sats and data.max_send_sats < data.min_send_sats)
    ):
        return JSONResponse({"error": "invalid_send_policy"}, status_code=400)
    premium = _premium()
    if not premium or not premium.is_available():
        return JSONResponse({"error": "premium_required"}, status_code=402)
    premium.save_policy(data.min_send_sats, data.max_send_sats)
    return {"ok": True, "min_send_sats": data.min_send_sats, "max_send_sats": data.max_send_sats}


@router.post("/network/broadcast")
async def network_broadcast(data: BroadcastIn, x_pub_token: str = Header(default=None)):
    user = _user(x_pub_token)
    if not user:
        return _private_response()
    if data.network not in _NETWORK_BASES:
        return JSONResponse({"error": "invalid_network"}, status_code=400)
    raw = (data.raw_tx or "").strip()
    recipient = (data.recipient or "").strip()
    if (
        len(raw) < 20
        or len(raw) > 800_000
        or len(raw) % 2
        or not _HEX_RE.fullmatch(raw)
        or not _valid_address(recipient)
        or data.amount_sats < 1
        or data.amount_sats > 2_100_000_000_000_000
        or not _contains_payment(raw, recipient, data.amount_sats)
    ):
        return JSONResponse({"error": "invalid_transaction"}, status_code=400)
    if not user.get("is_admin"):
        premium = _premium()
        if premium and hasattr(premium, "validate_send"):
            blocked = premium.validate_send(data.amount_sats)
            if blocked:
                return JSONResponse(blocked, status_code=403)
    try:
        result = await _post_tx(raw, data.network)
    except (httpx.HTTPError, RuntimeError):
        return JSONResponse({"error": "network_unavailable"}, status_code=502)
    if isinstance(result, JSONResponse):
        return result
    if not _TXID_RE.fullmatch(result):
        return JSONResponse({"error": "invalid_broadcast_response"}, status_code=502)
    return {"txid": result.lower()}


@router.get("/explorer/address/{address}")
async def explorer_address(address: str, network: str = "testnet3", x_pub_token: str = Header(default=None)):
    if not _user(x_pub_token):
        return _private_response()
    if network not in _NETWORK_BASES:
        return JSONResponse({"error": "invalid_network"}, status_code=400)
    if not _valid_address(address):
        return JSONResponse({"error": "invalid_address"}, status_code=400)
    try:
        status, txs = await asyncio.gather(_get(f"/address/{address}", network), _get(f"/address/{address}/txs", network))
        return {"type": "address", "address": address, "status": status, "transactions": txs}
    except (httpx.HTTPError, ValueError, RuntimeError):
        return JSONResponse({"error": "not_found"}, status_code=404)


@router.get("/explorer/tx/{txid}")
async def explorer_tx(txid: str, network: str = "testnet3", x_pub_token: str = Header(default=None)):
    if not _user(x_pub_token):
        return _private_response()
    if network not in _NETWORK_BASES:
        return JSONResponse({"error": "invalid_network"}, status_code=400)
    if not _TXID_RE.fullmatch(txid):
        return JSONResponse({"error": "invalid_txid"}, status_code=400)
    try:
        tx = await _get(f"/tx/{txid.lower()}", network)
        tip = int(await _get_text("/blocks/tip/height", network))
        return {"type": "tx", "transaction": tx, "tip_height": tip}
    except (httpx.HTTPError, ValueError, RuntimeError):
        return JSONResponse({"error": "not_found"}, status_code=404)
