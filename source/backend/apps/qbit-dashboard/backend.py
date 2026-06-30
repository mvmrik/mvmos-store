import asyncio
import httpx
import re
import sys
import time
from fastapi import APIRouter, Depends, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, Response
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/qbit", tags=["qbit"])

_AUTODISCOVER_PORTS = [8080, 8090, 9090, 10095, 6881]

# Persistent client with session cookie cache: key = (host, port, username) → {client, expires}
_sessions: dict = {}
_SESSION_TTL = 1800  # 30 min


async def _get_client(host: str, port: int, username: str, password: str) -> httpx.AsyncClient:
    key = (host, port, username)
    now = time.time()
    entry = _sessions.get(key)
    if entry and entry["expires"] > now:
        return entry["client"]
    # close old client if exists
    if entry:
        try: await entry["client"].aclose()
        except Exception: pass
    base = f"http://{host}:{port}"
    client = httpx.AsyncClient(base_url=base, timeout=15)
    if username:
        lr = await client.post("/api/v2/auth/login", data={"username": username, "password": password})
        if lr.text.strip() not in ("Ok.", ""):
            await client.aclose()
            raise ValueError("Login failed")
    _sessions[key] = {"client": client, "expires": now + _SESSION_TTL}
    return client


async def _proxy_request(host, port, username, password, path, method, data):
    """Make a proxied request, retry once if session expired."""
    for attempt in range(2):
        try:
            client = await _get_client(host, port, username, password)
            if method == "GET":
                r = await client.get(path)
            else:
                r = await client.post(path, data=data or {})
            # if qBittorrent returns 403, session expired — invalidate and retry
            if r.status_code == 403 and attempt == 0:
                key = (host, port, username)
                if key in _sessions:
                    try: await _sessions[key]["client"].aclose()
                    except Exception: pass
                    del _sessions[key]
                continue
            return r
        except httpx.ConnectError:
            raise
    raise ValueError("Session error after retry")


@router.get("/discover")
async def discover(session=Depends(get_current_session)):
    for port in _AUTODISCOVER_PORTS:
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                r = await client.get(f"http://localhost:{port}/api/v2/app/version")
                if r.status_code == 200:
                    return JSONResponse({"found": True, "host": "localhost", "port": port, "version": r.text.strip()})
        except Exception:
            continue
    return JSONResponse({"found": False})


@router.post("/proxy")
async def proxy(request: Request, session=Depends(get_current_session)):
    body = await request.json()
    host = body.get("host", "localhost")
    port = int(body.get("port", 8080))
    username = body.get("username", "")
    password = body.get("password", "")
    path = body.get("path", "/api/v2/app/version")
    method = body.get("method", "GET").upper()
    data = body.get("data", None)
    try:
        r = await _proxy_request(host, port, username, password, path, method, data)
        try:
            return JSONResponse(r.json())
        except Exception:
            return Response(content=r.content, media_type=r.headers.get("content-type", "text/plain"))
    except httpx.ConnectError:
        return JSONResponse({"error": "Cannot connect to qBittorrent"}, status_code=502)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=401)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/configure-localhost")
async def configure_localhost(session=Depends(get_current_session)):
    import pwd, pathlib
    user = session.get("effective_user", "root")
    try:
        home = pwd.getpwnam(user).pw_dir
    except Exception:
        home = os.path.expanduser("~")

    conf_dir = pathlib.Path(home) / ".config" / "qBittorrent"
    conf_file = conf_dir / "qBittorrent.conf"

    try:
        conf_dir.mkdir(parents=True, exist_ok=True)
        content = conf_file.read_text() if conf_file.exists() else ""

        if "WebUI\\LocalHostAuth=false" in content:
            return JSONResponse({"ok": True, "already": True})

        if "[Preferences]" in content:
            content = content.replace("[Preferences]", "[Preferences]\nWebUI\\LocalHostAuth=false", 1)
        else:
            content += "\n[Preferences]\nWebUI\\LocalHostAuth=false\nWebUI\\Port=8080\n"

        conf_file.write_text(content)

        subprocess.run(["pkill", "-x", "qbittorrent-nox"], capture_output=True)
        import time; time.sleep(1)
        subprocess.Popen(["qbittorrent-nox", "--daemon"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)

        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


_IPT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
_IPT_SEM = asyncio.Semaphore(5)


def _ipt_client(uid: str, pass_: str, togtem: str) -> httpx.AsyncClient:
    cookies = {"uid": uid, "pass": pass_, "togTem": togtem}
    return httpx.AsyncClient(timeout=30, follow_redirects=True,
                             cookies=cookies, headers={"User-Agent": _IPT_UA})


def _parse_results(html: str) -> list:
    results = []
    table_start = html.find('<table id="torrents"')
    if table_start < 0:
        return results
    table_end = html.find('</table>', table_start)
    table = html[table_start:table_end]
    rows = re.findall(r'<tr>(.*?)</tr>', table, re.DOTALL)
    for row in rows:
        title_m = re.search(r'<a class=" hv" href="(/t/(\d+))">([^<]+)</a>', row)
        if not title_m:
            continue
        link, tid, title = title_m.group(1), title_m.group(2), title_m.group(3)
        dl_m = re.search(r'href="(/download\.php/\d+/[^"]+\.torrent)"', row)
        download = dl_m.group(1) if dl_m else None
        sub_m = re.search(r'<div class="sub">([^<]+)', row)
        subtitle = sub_m.group(1).strip() if sub_m else ""
        cat_m = re.search(r'alt="([^"]+)"', row)
        category = cat_m.group(1) if cat_m else ""
        # <td> tags are not closed — split on <td> and take text content of last 4
        parts = re.split(r'<td[^>]*>', row)
        def _text(s): return re.sub(r'<[^>]+>', '', s).strip()
        plain = [_text(p) for p in parts]
        plain = [p for p in plain if p]  # remove empty
        size  = plain[-4] if len(plain) >= 4 else ""
        seeds = plain[-2] if len(plain) >= 2 else ""
        peers = plain[-1] if len(plain) >= 1 else ""
        results.append({
            "id": tid, "title": title, "link": link,
            "download": download, "subtitle": subtitle,
            "category": category, "size": size,
            "seeds": seeds, "peers": peers,
        })
    return results


def _get_last_page(html: str) -> int:
    m = re.search(r'p=(\d+)#torrents">Last', html)
    return int(m.group(1)) if m else 1


async def _fetch_description(client: httpx.AsyncClient, torrent_id: str, index: int) -> str:
    # Adaptive delay: fast for first 20, slower as index grows
    if index >= 50:
        delay = 1.5
    elif index >= 20:
        delay = 0.5
    else:
        delay = 0.0
    if delay:
        await asyncio.sleep(delay)
    async with _IPT_SEM:
        try:
            r = await client.get(f"https://iptorrents.com/t/{torrent_id}")
            bq = re.search(r'<blockquote>(.*?)</blockquote>', r.text, re.DOTALL)
            if bq:
                return re.sub(r'<[^>]+>', ' ', bq.group(1)).strip()
        except Exception:
            pass
    return ""


@router.post("/ipt-search")
async def ipt_search(request: Request, session=Depends(get_current_session)):
    body = await request.json()
    uid = body.get("uid", "")
    pass_ = body.get("pass", "")
    togtem = body.get("togtem", "")
    query = body.get("query", "").strip()
    desc_filter = body.get("desc_filter", "").strip().lower()

    if not uid or not pass_:
        return JSONResponse({"error": "IPTorrents cookies not configured"}, status_code=400)
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)

    try:
        async with _ipt_client(uid, pass_, togtem) as client:
            # Fetch first page to find total pages
            r = await client.get(f"https://iptorrents.com/t?q={query}&qf=")
            if "login.php" in str(r.url):
                return JSONResponse({"error": "IPTorrents session expired — update cookies in Settings"}, status_code=401)

            html = r.text
            last_page = _get_last_page(html)
            all_results = _parse_results(html)

            # Fetch remaining pages
            if last_page > 1:
                pages = range(2, last_page + 1)
                page_responses = await asyncio.gather(*[
                    client.get(f"https://iptorrents.com/t?q={query}&qf=;p={p}")
                    for p in pages
                ], return_exceptions=True)
                for pr in page_responses:
                    if isinstance(pr, Exception):
                        continue
                    all_results.extend(_parse_results(pr.text))

            # If no description filter — return all results immediately
            if not desc_filter:
                return JSONResponse({"results": all_results, "total": len(all_results), "filtered": False})

            # Fetch descriptions in parallel and filter
            desc_tasks = [_fetch_description(client, r["id"], i) for i, r in enumerate(all_results)]
            descriptions = await asyncio.gather(*desc_tasks)

            filtered = []
            for item, desc in zip(all_results, descriptions):
                if desc_filter in desc.lower() or desc_filter in item["title"].lower():
                    item["description_snippet"] = desc[:300]
                    filtered.append(item)

            return JSONResponse({"results": filtered, "total": len(all_results), "filtered": True})

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/ipt-download")
async def ipt_download(request: Request, session=Depends(get_current_session)):
    """Download .torrent file from IPTorrents and return it as binary."""
    body = await request.json()
    uid = body.get("uid", "")
    pass_ = body.get("pass", "")
    togtem = body.get("togtem", "")
    download_path = body.get("download_path", "")
    if not uid or not pass_ or not download_path:
        return JSONResponse({"error": "Missing params"}, status_code=400)
    try:
        async with _ipt_client(uid, pass_, togtem) as client:
            r = await client.get(f"https://iptorrents.com{download_path}")
            if r.status_code != 200:
                return JSONResponse({"error": f"IPT download failed: {r.status_code}"}, status_code=502)
            filename = download_path.split("/")[-1]
            return Response(
                content=r.content,
                media_type="application/x-bittorrent",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)



@router.post("/ipt-desc")
async def ipt_desc(request: Request, session=Depends(get_current_session)):
    body = await request.json()
    uid = body.get("uid", "")
    pass_ = body.get("pass", "")
    togtem = body.get("togtem", "")
    tid = body.get("id", "")
    if not uid or not pass_ or not tid:
        return JSONResponse({"error": "Missing params"}, status_code=400)
    try:
        async with _ipt_client(uid, pass_, togtem) as client:
            r = await client.get(f"https://iptorrents.com/t/{tid}")
            html = r.text
            # All blockquotes concatenated (description can span multiple)
            bqs = re.findall(r'<blockquote>(.*?)</blockquote>', html, re.DOTALL)
            if bqs:
                combined = '\n'.join(bqs)
            else:
                # Fallback: content between torrent id div and Related Torrents table
                m = re.search(r'<div[^>]+class="thnx"[^>]*>.*?</div>\s*<div[^>]+class="thnx"[^>]*>', html, re.DOTALL)
                # Try to find description area by looking for the main post content
                m2 = re.search(r'</h2>(.*?)<table class="t1"', html, re.DOTALL)
                combined = m2.group(1) if m2 else ''
            desc = re.sub(r'<[^>]+>', ' ', combined)
            desc = re.sub(r'&nbsp;', ' ', desc)
            desc = re.sub(r'&#\d+;', '', desc)
            desc = re.sub(r'&[a-z]+;', '', desc)
            desc = re.sub(r'\r\n', '\n', desc)
            desc = re.sub(r'[ \t]+', ' ', desc)
            desc = re.sub(r'\n{3,}', '\n\n', desc).strip()
            return JSONResponse({"description": desc or "(no description)"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/upload")
async def upload_torrent(
    host: str = Form("localhost"),
    port: int = Form(8080),
    username: str = Form(""),
    password: str = Form(""),
    savepath: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    torrents: UploadFile = File(...),
    session=Depends(get_current_session),
):
    content = await torrents.read()
    try:
        client = await _get_client(host, port, username, password)
        files = {"torrents": (torrents.filename, content, "application/x-bittorrent")}
        data = {}
        if savepath: data["savepath"] = savepath
        if category: data["category"] = category
        r = await client.post("/api/v2/torrents/add", files=files, data=data)
        return JSONResponse({"ok": True, "result": r.text})
    except httpx.ConnectError:
        return JSONResponse({"error": "Cannot connect to qBittorrent"}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
