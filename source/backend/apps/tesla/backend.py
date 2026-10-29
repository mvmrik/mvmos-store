"""Approved Tesla server component: a root public-key route and desktop-only setup.

No nginx edits, no standalone service. Personal credentials stay in apps/tesla.
"""
import importlib.util
import os
import sys
import subprocess
import importlib
from typing import Optional
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'apps', 'tesla'))
_spec = importlib.util.spec_from_file_location('_tesla_onboarding_server', os.path.join(_APP_DIR, 'onboarding.py'))
setup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(setup)
eng = setup.eng
router = APIRouter()
get_current_session = sys.modules['backend.auth'].get_current_session


@router.get(setup.KEY_PATH)
def public_key(request: Request):
    with eng.db() as c:
        state = setup.server_state(c)
        from urllib.parse import urlsplit
        expected = urlsplit(state['origin']).hostname
        host = request.headers.get('host', '').lower().removesuffix(':443')
        if not expected or host != expected or not state['key_ready']:
            return Response(status_code=404)
        return Response(eng.cfg_get(c,'server_public_key'), media_type='application/x-pem-file',
                        headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})


# Tesla fetches this public key without an mvmOS desktop session.
# The core supports this opt-out for approved backend routes.
public_key.no_session_auth = True


class ServerBody(BaseModel):
    origin: str


@router.get('/api/apps/tesla/server', dependencies=[Depends(get_current_session)])
def server_info():
    with eng.db() as c:
        return JSONResponse(setup.server_state(c))


@router.put('/api/apps/tesla/server', dependencies=[Depends(get_current_session)])
def configure_server(body: ServerBody, x_pub_token: Optional[str] = Header(default=None), session=Depends(get_current_session)):
    if session.get('effective_user') != 'root':
        return JSONResponse({'error':'owner_only'},status_code=403)
    hub = sys.modules.get('backend.apphub')
    me = hub.get_pub_session(x_pub_token) if hub and x_pub_token else None
    if not me:
        return JSONResponse({'error':'profile_required'},status_code=403)
    with eng.db() as c:
        try:
            # Desktop-approved setup provisions its key-generation dependency on a
            # fresh mvmOS too; no terminal or manual pip command is required.
            setup.origin_url(body.origin)
            if importlib.util.find_spec('cryptography') is None:
                try:
                    subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', 'cryptography>=43'],
                                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
                    importlib.invalidate_caches()
                except (subprocess.SubprocessError, OSError):
                    return JSONResponse({'error':'dependency_failed'},status_code=503)
            return JSONResponse(setup.configure_server(c,body.origin,me['id']))
        except setup.SetupError as e:
            return JSONResponse({'error':str(e)},status_code=409)
