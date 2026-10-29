"""
Tesla — the minute tick. Core calls run() once a minute; this reads the cars
that are due. While one is being driven at a rhythm shorter than a minute, the
looks in between are made from a background thread, so other apps' ticks are
never held up.
"""
import importlib.util
import os
import threading
import time

_DIR = os.path.dirname(os.path.abspath(__file__))


def _engine():
    spec = importlib.util.spec_from_file_location("_tesla_engine_tick", os.path.join(_DIR, "engine.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _between(eng, wait):
    deadline = time.time() + 52
    while wait is not None and time.time() + max(1, wait) < deadline:
        time.sleep(max(1, wait))
        wait = eng.tick()


def run(now, db_path, config):
    eng = _engine()
    wait = eng.tick()
    if wait is not None and wait < 50:
        threading.Thread(target=_between, args=(eng, wait), daemon=True).start()
