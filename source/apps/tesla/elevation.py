"""Local terrain profiles from anonymous AWS Terrain Tiles (Skadi HGT).

No Tesla requests, API keys, extra packages or coordinate lookup service.
Only whole one-degree terrain squares are downloaded. Runtime cache is excluded
from Store archives. Heights describe terrain, including beneath bridges/tunnels.
"""
import gzip
import math
import os
import struct
import tempfile
import threading
import time
import urllib.request

CACHE = os.path.join(os.path.dirname(__file__), '.runtime', 'elevation')
SOURCE = 'https://elevation-tiles-prod.s3.amazonaws.com/skadi/'
MAX_BYTES = 3601 * 3601 * 2
_LOCK = threading.Lock()
_FAILED = {}


def square(lat, lng):
    lat, lng = math.floor(lat), math.floor(lng)
    return ('N' if lat >= 0 else 'S') + f'{abs(lat):02d}' + ('E' if lng >= 0 else 'W') + f'{abs(lng):03d}'


def _tile(name, deadline):
    try:
        os.makedirs(CACHE, exist_ok=True)
    except OSError:
        return None
    path = os.path.join(CACHE, name + '.hgt')
    if os.path.isfile(path) and os.path.getsize(path) in (1201**2*2, MAX_BYTES):
        os.utime(path, None)
        return path
    if time.monotonic() >= deadline or _FAILED.get(name, 0) > time.monotonic():
        return None
    if not _LOCK.acquire(timeout=1):
        return None
    tmp = None
    try:
        if os.path.isfile(path) and os.path.getsize(path) in (1201**2*2, MAX_BYTES):
            return path
        req = urllib.request.Request(SOURCE + name[:3] + '/' + name + '.hgt.gz', headers={'User-Agent': 'mvmOS-Tesla/1.0'})
        with urllib.request.urlopen(req, timeout=min(8, max(1, deadline-time.monotonic()))) as response:
            with gzip.GzipFile(fileobj=response) as stream, tempfile.NamedTemporaryFile(dir=CACHE, delete=False) as out:
                tmp = out.name
                size = 0
                while True:
                    chunk = stream.read(65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_BYTES or time.monotonic() > deadline:
                        raise ValueError('terrain_limit')
                    out.write(chunk)
        if size not in (1201**2*2, MAX_BYTES):
            raise ValueError('terrain_size')
        os.replace(tmp, path)
        tmp = None
        # Keep at most about 256 MB, evicting least recently used squares.
        files = [(e.stat().st_mtime, e.path, e.stat().st_size) for e in os.scandir(CACHE) if e.name.endswith('.hgt')]
        total = sum(x[2] for x in files)
        for _, old, count in sorted(files):
            if total <= 256 * 1024**2:
                break
            if old != path:
                os.unlink(old)
                total -= count
        return path
    except (OSError, ValueError, EOFError):
        _FAILED[name] = time.monotonic() + 300
        return None
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)
        _LOCK.release()


def height(raw, n, lat, lng):
    """Bilinear interpolation of signed big-endian north-to-south HGT rows."""
    x = (lng-math.floor(lng)) * (n-1)
    y = (1-(lat-math.floor(lat))) * (n-1)
    col, row = min(n-2, int(x)), min(n-2, int(y))
    dx, dy = x-col, y-row
    values = [struct.unpack_from('>h', raw, 2*(r*n+c))[0] for r,c in ((row,col),(row,col+1),(row+1,col),(row+1,col+1))]
    if -32768 in values:
        return None
    a,b,c,d = values
    return round(a*(1-dx)*(1-dy)+b*dx*(1-dy)+c*(1-dx)*dy+d*dx*dy, 1)


def distance(a, b):
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lng2-lng1)/2)**2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def profile(rows):
    # Input: trip id, timestamp, latitude, longitude. Never join separate drives.
    selected = [tuple(r) for r in rows]
    if len(selected) > 1500:
        selected = [selected[round(i*(len(selected)-1)/1499)] for i in range(1500)]
    result, tiles, previous, anchor = [], {}, None, None
    km = ascent = descent = 0.0
    valid = []
    loaded_name, loaded = None, None
    deadline = time.monotonic() + 24
    for trip, ts, lat, lng in selected:
        if lat is None or lng is None or not math.isfinite(lat) or not math.isfinite(lng) or not (-90 < lat < 90 and -180 <= lng < 180):
            previous = anchor = None
            if result: result.append([round(km, 3), None])
            continue
        point = (lat, lng)
        step = distance(previous[2], point) if previous and previous[0] == trip else 0
        gap = previous is None or previous[0] != trip or ts-previous[1] > 300 or step > 5
        if gap:
            anchor = None
            if result: result.append([round(km, 3), None])
        km += step
        previous = (trip, ts, point)
        name = square(lat, lng)
        if name not in tiles:
            tiles[name] = _tile(name, deadline) if len(tiles) < 12 else None
        if loaded_name != name:
            loaded_name, loaded = name, None
            try:
                with open(tiles[name], 'rb') as f: raw = f.read(MAX_BYTES+1)
                n = math.isqrt(len(raw)//2)
                if n in (1201, 3601) and n*n*2 == len(raw):
                    loaded = (raw, n)
            except (OSError, TypeError):
                pass
        value = height(*loaded, lat, lng) if loaded else None
        result.append([round(km, 3), value])
        if value is None:
            anchor = None
            continue
        valid.append(value)
        # Three-metre deadband avoids summing small interpolation/GPS noise.
        if anchor is not None and abs(value-anchor) >= 3:
            ascent += max(0, value-anchor)
            descent += max(0, anchor-value)
            anchor = value
        elif anchor is None:
            anchor = value
    return {'points': result, 'ascent_m': round(ascent), 'descent_m': round(descent),
            'min_m': min(valid) if valid else None, 'max_m': max(valid) if valid else None,
            'partial': len(valid) < len(selected) or any(p[1] is None for p in result),
            'samples': len(valid), 'total': len(selected)}
