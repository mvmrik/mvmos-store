"""Racelandia consumes Game Hub's generic name service; it owns no name pools."""
import sys


def _hub():
    hub = sys.modules.get('app_backend_gamehub')
    if hub is None or not callable(getattr(hub, 'generate_names', None)):
        raise RuntimeError('Game Hub name generator is unavailable; update Game Hub before starting a new career')
    return hub


def generate(*, count=1, country='', gender='mixed', rng=None):
    return _hub().generate_names(country=country, gender=gender, count=count, rng=rng)


def display_rules():
    hub = sys.modules.get('app_backend_gamehub')
    return hub.name_display_rules() if hub and callable(getattr(hub, 'name_display_rules', None)) else {}


def person(rng=None):
    identity = generate(rng=rng)[0]
    return dict(name=identity['latin'], name_identity=identity)


def public(profile):
    identity = profile.get('name_identity') or None
    return dict(name_identity=identity, country=identity.get('country') if identity else None,
                gender=identity.get('gender') if identity else None)


# Only used to recognize names emitted by the old pilot market during migration.
# New people never select names from these legacy values.
_LEGACY_FIRST = set('Alex Jamie Robin Sam Casey Jordan Riley Taylor Drew Avery Logan Morgan Sasha Noah Nico Mika Luca Emil Kai Toni'.split())
_LEGACY_LAST = set('Morgan Taylor Blake Bennett Brooks Hayes Adams Reid Quinn Parker Scott Ellis Silva Moreau Keller Costa Sato Novak Rossi Lind'.split())


def legacy_pilot_name(name):
    parts = name.split()
    return len(parts) == 2 and parts[0] in _LEGACY_FIRST and parts[1] in _LEGACY_LAST


def ensure_person(profile, *, pilot=False):
    if profile.get('name_identity'):
        return False
    original = profile.get('name', '')
    new = person()
    if pilot and original and not legacy_pilot_name(original):
        new['name_identity']['custom_name'] = original
        new['name'] = original
    profile.update(new)
    return True


def migrate(conn, driver):
    """Give existing generated personnel persistent identities, preserving personal edits."""
    import json
    pid = driver['player_id']
    if driver['has_driver'] and ensure_person(driver, pilot=True):
        conn.execute('UPDATE driver SET name=?,name_identity=? WHERE player_id=?',
                     (driver['name'], json.dumps(driver['name_identity']), pid))
    for table in ('team_pilot', 'team_offer', 'crew_member', 'crew_offer', 'staff_member', 'staff_offer'):
        for row in conn.execute(f'SELECT id,profile FROM {table} WHERE player_id=?', (pid,)).fetchall():
            profile = json.loads(row['profile'])
            if table == 'team_pilot' and row['id'] == driver.get('pilot_id') and driver['has_driver']:
                profile.update(name=driver['name'], name_identity=driver['name_identity'])
                changed = not json.loads(row['profile']).get('name_identity') or json.loads(row['profile']).get('name') != driver['name']
            else:
                changed = ensure_person(profile, pilot=table == 'team_pilot')
            if changed:
                conn.execute(f'UPDATE {table} SET profile=? WHERE id=? AND player_id=?', (json.dumps(profile), row['id'], pid))
