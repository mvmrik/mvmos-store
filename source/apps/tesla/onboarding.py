"""Tesla setup: personal credentials, a desktop-approved origin and a stable server key."""
import hashlib
import importlib.util
import os
import time
import urllib.parse
import urllib.request

_spec = importlib.util.spec_from_file_location('_tesla_setup_engine', os.path.join(os.path.dirname(__file__), 'engine.py'))
eng = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eng)
KEY_PATH = '/.well-known/appspecific/com.tesla.3p.public-key.pem'


class SetupError(ValueError):
    pass


def origin_url(value):
    try:
        u = urllib.parse.urlsplit(value.strip())
        if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
            raise ValueError()
        if u.port not in (None, 443):
            raise ValueError()
        host = u.hostname.encode('idna').decode('ascii').lower()
        if '.' not in host or any(ch not in 'abcdefghijklmnopqrstuvwxyz0123456789-.' for ch in host):
            raise ValueError()
        return 'https://' + host
    except (ValueError, UnicodeError, AttributeError):
        raise SetupError('https_origin')


def server_state(c):
    origin = eng.cfg_get(c, 'public_origin', '')
    public = eng.cfg_get(c, 'server_public_key', '')
    return {'origin': origin, 'owner_id': eng.cfg_get(c, 'server_owner', ''),
            'key_ready': bool(public), 'key_url': origin + KEY_PATH if origin else '',
            'callback': origin + '/pub/tesla/callback' if origin else '',
            'fingerprint': hashlib.sha256(public.encode()).hexdigest() if public else ''}


def configure_server(c, origin, user_id):
    origin = origin_url(origin)
    c.execute('BEGIN IMMEDIATE')
    old = server_state(c)
    if eng.cfg_get(c, 'registration_busy_until', 0) > time.time():
        raise SetupError('setup_busy')
    # Changing ownership/origin while connected would invalidate the existing setup.
    if (old['owner_id'] and old['owner_id'] != user_id) or (old['origin'] and old['origin'] != origin):
        if c.execute('SELECT 1 FROM accounts LIMIT 1').fetchone() or c.execute('SELECT 1 FROM credentials WHERE registered_at>0 LIMIT 1').fetchone():
            raise SetupError('server_locked')
    if not old['key_ready']:
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization
        key = ec.generate_private_key(ec.SECP256R1())
        private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        eng.set_cfg(c, 'server_private_key', private)
        eng.set_cfg(c, 'server_public_key', public)
    eng.set_cfg(c, 'public_origin', origin)
    eng.set_cfg(c, 'server_owner', user_id)
    c.commit()
    return server_state(c)


def allowed(c, user_id):
    return eng.cfg_get(c, 'server_owner', '') == user_id


def ready(c, user_id):
    state, cfg = server_state(c), eng.settings(c, user_id)
    return bool(allowed(c, user_id) and state['origin'] and state['key_ready'] and cfg['registered_at']
                and cfg['registered_origin'] == state['origin'] and cfg['registered_key'] == state['fingerprint'])


def credential_info(c, user_id):
    cfg, state = eng.settings(c, user_id), server_state(c)
    return {'client_id': cfg['client_id'], 'has_secret': bool(cfg['client_secret']),
            'region': cfg['region'], 'budget': cfg['budget'], 'ready': ready(c, user_id),
            'server_ready': bool(state['origin'] and state['key_ready']),
            'can_configure': allowed(c, user_id), 'origin': state['origin'],
            'callback': state['callback'], 'key_url': state['key_url']}


def save_credentials(c, user_id, client_id, secret, region, budget):
    if not allowed(c, user_id):
        raise SetupError('owner_only')
    cfg = eng.settings(c, user_id)
    if eng.cfg_get(c, 'registration_busy_until', 0) > time.time():
        raise SetupError('setup_busy')
    client_id, secret = client_id.strip(), secret.strip()
    if not client_id or len(client_id)>256 or len(secret)>2048 or region not in eng.REGIONS or not 0<=budget<=10000:
        raise SetupError('invalid_credentials')
    changed = cfg['client_id'] != client_id or cfg['region'] != region or bool(secret and secret != cfg['client_secret'])
    if changed and c.execute('SELECT 1 FROM accounts WHERE user_id=?', (user_id,)).fetchone():
        raise SetupError('disconnect_first')
    secret = secret or (cfg['client_secret'] if cfg['client_id'] == client_id else '')
    if not secret:
        raise SetupError('invalid_credentials')
    c.execute('''INSERT INTO credentials(user_id,client_id,client_secret,region,budget) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET client_id=excluded.client_id,client_secret=excluded.client_secret,
        region=excluded.region,budget=excluded.budget''', (user_id,client_id,secret,region,budget))
    if changed:
        c.execute("UPDATE credentials SET registered_at=0,registered_origin='',registered_key='' WHERE user_id=?", (user_id,))
        c.execute('DELETE FROM oauth_states WHERE user_id=?', (user_id,))
    c.commit()
    return credential_info(c, user_id)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def verify_public_key(origin, expected):
    try:
        req = urllib.request.Request(origin + KEY_PATH, headers={'Cache-Control':'no-cache', 'User-Agent':'mvmOS-Tesla/1.0'})
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=12) as response:
            actual = response.read(8192).decode('ascii').strip()
            if response.status != 200 or actual != expected.strip():
                raise SetupError('key_unreachable')
    except SetupError:
        raise
    except Exception:
        raise SetupError('key_unreachable')


def matches_public_key(public, expected):
    """Tesla returns an uncompressed SEC1 hex point; older responses may use PEM."""
    if not isinstance(public, str):
        return False
    if public.strip() == expected.strip():
        return True
    try:
        from cryptography.hazmat.primitives import serialization
        key = serialization.load_pem_public_key(expected.encode())
        point = key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        return bytes.fromhex(public.strip()) == point
    except (ValueError, TypeError, AttributeError):
        return False


def register(c, user_id):
    if not allowed(c, user_id):
        raise SetupError('owner_only')
    state, cfg = server_state(c), eng.settings(c, user_id)
    if not state['origin'] or not state['key_ready']:
        raise SetupError('server_required')
    if not cfg['client_id'] or not cfg['client_secret']:
        raise SetupError('invalid_credentials')
    now = int(time.time())
    c.execute('BEGIN IMMEDIATE')
    if eng.cfg_get(c, 'registration_busy_until', 0) > now:
        c.rollback()
        raise SetupError('setup_busy')
    eng.set_cfg(c, 'registration_busy_until', now + 120)
    c.commit()
    try:
        # Do not change an already working registration during routine viewing/saving.
        verify_public_key(state['origin'], eng.cfg_get(c, 'server_public_key'))
        api, auth, _ = eng.REGIONS[cfg['region']]
        status, token = eng.http('POST', auth + '/oauth2/v3/token', form={
            'grant_type':'client_credentials','client_id':cfg['client_id'],
            'client_secret':cfg['client_secret'],'audience':api})
        if status != 200 or not token.get('access_token'):
            raise SetupError('partner_auth_failed')
        status, result = eng.http('POST', api + '/api/1/partner_accounts', token=token['access_token'],
                                  payload={'domain':urllib.parse.urlsplit(state['origin']).hostname})
        if status not in (200,201):
            raise SetupError('registration_failed')
        # Registration returns the enrolled EC point as hex. Verify it directly;
        # a separate lookup can require scopes absent from the partner token.
        public = (result.get('response') or {}).get('public_key')
        if not public:
            status, result = eng.http('GET', api + '/api/1/partner_accounts/public_key?domain=' + urllib.parse.urlsplit(state['origin']).hostname, token=token['access_token'])
            public = (result.get('response') or {}).get('public_key') if status == 200 else None
        if not public or not matches_public_key(public, eng.cfg_get(c,'server_public_key')):
            raise SetupError('registration_failed')
        # Another request must not replace credentials during network calls.
        latest = eng.settings(c, user_id)
        if any(latest[k] != cfg[k] for k in ('client_id','client_secret','region')) or server_state(c) != state:
            raise SetupError('setup_changed')
        c.execute('UPDATE credentials SET registered_origin=?,registered_key=?,registered_at=? WHERE user_id=?',
                  (state['origin'],state['fingerprint'],int(time.time()),user_id))
        c.commit()
        return credential_info(c, user_id)
    finally:
        eng.set_cfg(c, 'registration_busy_until', 0)
        c.commit()
