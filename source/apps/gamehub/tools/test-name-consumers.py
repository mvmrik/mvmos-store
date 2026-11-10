"""Run from the repository root with venv/bin/python apps/gamehub/tools/test-name-consumers.py."""
import asyncio
import importlib.util
import json
from pathlib import Path
from name_service_fixture import install, catalogue, connect

ROOT = Path(__file__).resolve().parents[3]
hub = install()


def load(app):
    spec = importlib.util.spec_from_file_location('test_' + app, ROOT / 'apps' / app / 'mp_game.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Context:
    host_id = 'test-player'
    saved_state = None
    def __init__(self): self.messages = []
    def all_players(self): return [dict(id=self.host_id, display_name='Test Player', connected=True)]
    async def send(self, pid, msg): self.messages.append(msg)
    async def broadcast(self, msg): self.messages.append(msg)
    def schedule(self, *args): pass
    def save_state(self, *args): pass


async def main():
    assert [hub.name_country(lang) for lang in ['bg', 'ru-RU', 'pt-PT', 'zh', 'ja', 'en-GB', 'xx']] == ['BG', 'RU', 'BR', 'CN', 'JP', 'US', 'US']
    belot = load('belot')
    for language, code in [('bg', 'BG'), ('ru', 'RU'), ('ja', 'JP')]:
        ctx = Context(); game = belot.Game(ctx)
        await game.on_start({'name_language':language})
        bots = [s for s in game.seats if s['bot']]
        assert len(bots) == 3 and all(p['name_identity']['country'] == code for p in bots)
        assert len({p['name'] for p in bots}) == 3
        ctx.saved_state = game.snapshot()
        restored = belot.Game(ctx); await restored.on_start({'name_language':'en'})
        assert restored.seats == game.seats
        assert ctx.messages[-1]['name_display_rules']['language_scripts']['bg'] == ['Latn', 'Cyrl']
    living = load('livingtown');ctx = Context();game = living.Game(ctx)
    await game.on_start({'name_language':'bg'})
    assert game.state['start_country'] == 'BG' and game.state['founding']
    game.state['founding'] = False
    game.state['people'] = [dict(id=42, name='Existing Name', parents=[1,2], children=[43])]
    ctx.saved_state = game.snapshot(); restored = living.Game(ctx)
    await restored.on_start({'name_language':'ja'})
    assert restored.state == game.state
    assert restored._start()['name_catalogue']['BG']['groups']['male_first']
    score = load('scorearena')
    # Avoid reading real players' throwing history. Keep the real ghost engine.
    score._ghost_for = lambda *args:score.Ghost(20)
    ctx = Context(); game = score.Game(ctx)
    game._maybe_ghost_turn = lambda: asyncio.sleep(0)
    await game.on_start({'mode':'501','opponent':'ghost'})
    identity = game.ghost_identity
    assert identity['country'] and identity['native'] and identity['latin']
    saved = game.snapshot(); restored = score.Game(ctx);restored._restore(saved)
    assert restored.ghost_identity == identity
    assert restored._state('sa_state')['roster'][score.GHOST_ID]['name_identity'] == identity
    del saved['ghost_identity'];restored._restore(saved)
    migrated = restored.snapshot();restored._restore(migrated)
    assert restored.ghost_identity == migrated['ghost_identity']
    with connect() as conn:
        catalogue.schema(conn)
        conn.execute("INSERT INTO name_catalog_custom(country,category,native,latin) VALUES('BG','female_first','Пробноиме','Testname')")
        conn.commit()
        assert any(r['latin'] == 'Testname' for r in hub.name_catalogue()['BG']['groups']['female_first'])
    print('PASS: locale mapping, Belot country/unique bots/resume, Living Town saved family links, Score Arena identity/resume/legacy saves, local catalogue additions')

asyncio.run(main())
