"""mvm2factor's app-to-app API — the only way another app may reach 2FA data.

Loaded by Apps Hub via hub.call_app_api("mvm2factor", ...) once an admin
enables it at Apps Hub -> Settings -> App APIs. Reuses api.py's already-running
DB and helpers through sys.modules["app_public_mvm2factor"], so nothing here
re-implements the schema or the TOTP maths.

Two deliberate properties:

- **The secret never leaves in the clear.** Secrets are encrypted in the
  browser with a password the server never sees, so the server cannot compute a
  code either. get_code() hands out the account's ciphertext and the vault
  parameters; only a browser that knows the password, or already holds the
  unlocked key, can turn them into digits. An account saved before encryption
  existed, whose owner has not opened mvm2factor since, still gets a code.
- **This module does not care who is calling.** It exposes accounts belonging to
  one Apps Hub user and nothing else; deciding *whether* a given app should be
  offering 2FA at all is that app's business, not this one's. That is what keeps
  the integration generic instead of being a private channel to one app.

user_id is always an Apps Hub public_users.id — the same identity space
accounts.owner_id keys on. The caller is expected to already know which Apps Hub
user it acts for; call_app_api() injects it from the authenticated session.
"""

import sys

# Both return only ciphertext and the parameters to open it, which is of use to
# a browser holding the password and to nothing else. Automations, the External
# API and mvmAI run without one, so they are not offered there; apps calling
# in-process, such as mvmPasswords, still reach them.
INTERNAL_ONLY = {"get_code", "get_vault"}


def _pub():
    module = sys.modules.get("app_public_mvm2factor")
    if module is None:
        raise RuntimeError("mvm2factor api.py not loaded")
    return module


def list_accounts(user_id: str):
    """Every 2FA account the user owns, as {id, name, issuer, website_host}.

    No code is computed here. A caller listing accounts is populating a picker,
    not signing in, and generating codes for the whole list would be wasted work
    that also drags a fresh TOTP calculation into an unrelated screen.
    """
    if not user_id:
        return []
    pub = _pub()
    with pub._conn() as conn:
        rows = conn.execute(
            "SELECT id,name,issuer,website_host FROM accounts "
            "WHERE owner_id=? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "issuer": row["issuer"],
            "website_host": row["website_host"],
        }
        for row in rows
    ]


def get_vault(user_id: str):
    """The user's vault parameters, {salt, iterations, check_iv, check_ct}, or
    None while the user has not chosen a password yet.

    Enough to test a password in the browser without fetching any account.
    """
    if not user_id:
        return None
    pub = _pub()
    with pub._conn() as conn:
        return pub._vault(conn, user_id)


def get_code(user_id: str, account_id: str):
    """What a browser needs to show the current code for one account.

    Returns {name, issuer, seconds_left, iv, ciphertext, vault, code}. iv and
    ciphertext are the encrypted secret and vault holds the parameters to
    unlock it; code is None once the account is encrypted, and is the finished
    code only for an account whose owner has not chosen a password yet.

    Raises LookupError when the account is not the user's or does not exist —
    the two are answered identically on purpose, so this cannot be used to probe
    which account ids exist.
    """
    if not user_id or not account_id:
        raise LookupError("account_not_found")
    pub = _pub()
    with pub._conn() as conn:
        row = conn.execute(
            "SELECT id,name,issuer,secret,iv,ciphertext FROM accounts WHERE id=? AND owner_id=?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            raise LookupError("account_not_found")
        vault = pub._vault(conn, user_id)
        # Mirrors what the app's own UI does when a code is read, so an account
        # used through another app still looks used in mvm2factor's own list.
        conn.execute(
            "UPDATE accounts SET last_used=strftime('%s','now') WHERE id=? AND owner_id=?",
            (account_id, user_id),
        )
        conn.commit()
    import time

    return {
        "code": pub._totp(row["secret"]) if row["secret"] else None,
        "name": row["name"],
        "issuer": row["issuer"],
        "seconds_left": 30 - int(time.time()) % 30,
        "iv": row["iv"],
        "ciphertext": row["ciphertext"],
        "vault": vault,
    }
