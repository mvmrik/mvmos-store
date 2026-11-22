"""mvmAI's minute tick, called by the mvmOS Scheduler.

It only passes the time to the agent projects' schedule runner. All the work lives
in the premium module: without it (no licence, or agents switched off) nothing runs.
"""

import sys

APP_ID = "mvmai"


def run(now, db_path, config):
    premium = sys.modules.get("backend.premium")
    backend = premium.load_premium_backend(APP_ID) if premium else None
    api = sys.modules.get("app_public_" + APP_ID)
    if not backend or api is None or not hasattr(backend, "agents_module"):
        return
    desk = api._desktop()
    if desk is None or not backend.agents_enabled(desk._read_cfg()):
        return
    backend.agents_module().workspaces().tick(api, now)
