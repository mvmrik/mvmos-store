"""mvm2factor's app-to-app API — the only way another app may reach 2FA data.

Loaded by Apps Hub via hub.call_app_api("mvm2factor", ...) once an admin
enables it at Apps Hub -> Settings -> App APIs. Reuses api.py's already-running
DB and helpers through sys.modules["app_public_mvm2factor"], so nothing here
re-implements the schema or the TOTP maths.

Two deliberate properties:

- **The secret never leaves.** get_code() returns the six digits mvm2factor
  computed itself. A caller cannot ask for the shared secret, so a compromised
  caller cannot mint codes of its own later.
- **This module does not care who is calling.** It exposes accounts belonging to
  one Apps Hub user and nothing else; deciding *whether* a given app should be
  offering 2FA at all is that app's business, not this one's. That is what keeps
  the integration generic instead of being a private channel to one app.

user_id is always an Apps Hub public_users.id — the same identity space
accounts.owner_id keys on. The caller is expected to already know which Apps Hub
user it acts for; call_app_api() injects it from the authenticated session.
"""

import sys


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


def get_code(user_id: str, account_id: str):
    """The current six-digit code for one account the user owns.

    Returns {code, name, issuer, seconds_left}. seconds_left comes back with the
    code because a caller that copies it to the clipboard needs to know how long
    it stays valid, and asking again a moment later would produce a different
    answer than the one it already handed the user.

    Raises LookupError when the account is not the user's or does not exist —
    the two are answered identically on purpose, so this cannot be used to probe
    which account ids exist.
    """
    if not user_id or not account_id:
        raise LookupError("account_not_found")
    pub = _pub()
    with pub._conn() as conn:
        row = conn.execute(
            "SELECT id,name,issuer,secret FROM accounts WHERE id=? AND owner_id=?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            raise LookupError("account_not_found")
        # Mirrors what the app's own UI does when a code is read, so an account
        # used through another app still looks used in mvm2factor's own list.
        conn.execute(
            "UPDATE accounts SET last_used=strftime('%s','now') WHERE id=? AND owner_id=?",
            (account_id, user_id),
        )
        conn.commit()
    import time

    return {
        "code": pub._totp(row["secret"]),
        "name": row["name"],
        "issuer": row["issuer"],
        "seconds_left": 30 - int(time.time()) % 30,
    }
