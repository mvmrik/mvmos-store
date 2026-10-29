"""Offline audio header inspection using only bundled code and Python stdlib.

TinyTag handles MP3, MP4/M4A/M4B, Ogg/Opus, FLAC and WAV. Small readers below
handle ADTS AAC and WebM (including recorder files without a Duration element).
No decoders, external executables, package installs or network calls are used.
Like any metadata reader this validates structure, not every compressed sample.
"""
import math
import os
import struct
import time
import types

# Root-level Python files are preserved by the Store installer. Do not import
# an ambient/site-packages copy or modify sys.path for this app's dependencies.
_vendor_path = os.path.join(os.path.dirname(__file__), 'tinytag_vendor.py')
_vendor = types.ModuleType('mvmaudio_tinytag_vendor')
_vendor.__file__ = _vendor_path
with open(_vendor_path, encoding='utf-8') as _source:
    exec(compile(_source.read(), _vendor_path, 'exec'), _vendor.__dict__)
TinyTag = _vendor.TinyTag


class InvalidAudio(ValueError):
    pass


class Reader:
    """Keep untrusted header lengths/seeks and parser work bounded."""
    def __init__(self, file):
        self.file = file
        self.size = file.seek(0, os.SEEK_END)
        file.seek(0)
        self.deadline = time.monotonic() + 30
        self.read_bytes = 0

    def check(self):
        if time.monotonic() > self.deadline:
            raise InvalidAudio('Audio inspection timed out')

    def tell(self):
        return self.file.tell()

    def read(self, size=-1):
        self.check()
        if size < 0:
            size = self.size - self.tell()
        if size > 16 * 1024 ** 2 or self.read_bytes + size > 128 * 1024 ** 2:
            raise InvalidAudio('Audio metadata is too large')
        data = self.file.read(size)
        self.read_bytes += len(data)
        return data

    def seek(self, offset, whence=os.SEEK_SET):
        self.check()
        target = offset + (self.tell() if whence == os.SEEK_CUR else self.size if whence == os.SEEK_END else 0)
        if not 0 <= target <= self.size:
            raise InvalidAudio('Audio points outside file')
        return self.file.seek(target)


def exact(f, n):
    data = f.read(n)
    if len(data) != n:
        raise InvalidAudio('Truncated audio')
    return data


def duration(value):
    value = float(value or 0)
    if not math.isfinite(value) or not 0 < value <= 1e8:
        raise InvalidAudio('Invalid audio duration')
    return value


def adts(f):
    """Sum samples from complete ADTS frames, including variable bitrate AAC."""
    rates = (96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350)
    # Some AAC files start with an ID3v2 metadata block.
    head = f.read(10)
    if head[:3] == b'ID3':
        if len(head) != 10 or head[3] not in (2, 3, 4) or any(b & 128 for b in head[6:]):
            raise InvalidAudio('Invalid ID3 header')
        size = sum(b << (7 * (3 - i)) for i, b in enumerate(head[6:10]))
        f.seek(10 + size + (10 if head[3] == 4 and head[5] & 16 else 0))
    else:
        f.seek(0)
    frames, seconds, rate = 0, 0.0, None
    while f.tell() < f.size:
        start = f.tell()
        h = exact(f, 7)
        if h[:3] == b'TAG' and f.size - start == 128:
            f.seek(f.size)
            break
        if h[0] != 255 or h[1] & 246 != 240:
            raise InvalidAudio('Invalid ADTS sync')
        index = (h[2] >> 2) & 15
        if index >= len(rates) or (rate is not None and rate != rates[index]):
            raise InvalidAudio('Invalid AAC sample rate')
        rate = rates[index]
        length = ((h[3] & 3) << 11) | (h[4] << 3) | (h[5] >> 5)
        header_length = 7 if h[1] & 1 else 9
        if length <= header_length:
            raise InvalidAudio('Empty AAC frame')
        f.seek(start + length)
        seconds += 1024 * ((h[6] & 3) + 1) / rate
        frames += 1
    if not frames:
        raise InvalidAudio('No AAC frames')
    return duration(seconds)


# EBML/Matroska element identifiers, as specified at matroska.org/technical.
LEVEL1 = {0x114D9B74, 0x1549A966, 0x1654AE6B, 0x1F43B675, 0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367}


def vint(f, identifier=False):
    first = exact(f, 1)[0]
    width = 1
    while width <= 8 and not first & (1 << (8 - width)):
        width += 1
    if width > (4 if identifier else 8):
        raise InvalidAudio('Invalid EBML integer')
    value = first if identifier else first & ((1 << (8 - width)) - 1)
    for byte in exact(f, width - 1):
        value = (value << 8) | byte
    return value, width


def header(f, end):
    eid, _ = vint(f, True)
    size, width = vint(f)
    unknown = size == (1 << (7 * width)) - 1
    start = f.tell()
    stop = end if unknown else start + size
    if start > end or stop > end or (unknown and eid not in (0x18538067, 0x1F43B675)):
        raise InvalidAudio('Invalid EBML element size')
    return eid, start, stop, unknown


def children(f, start, end):
    f.seek(start)
    while f.tell() < end:
        eid, pos, stop, unknown = header(f, end)
        if unknown:
            raise InvalidAudio('Unexpected open-ended element')
        yield eid, pos, stop
        f.seek(stop)


def uint(f, end):
    size = end - f.tell()
    if not 0 < size <= 8:
        raise InvalidAudio('Invalid EBML scalar')
    return int.from_bytes(exact(f, size), 'big')


def floating(f, end):
    size = end - f.tell()
    if size not in (4, 8):
        raise InvalidAudio('Invalid EBML float')
    value = struct.unpack('>f' if size == 4 else '>d', exact(f, size))[0]
    if not math.isfinite(value) or value <= 0:
        raise InvalidAudio('Invalid EBML float value')
    return value


def packets(f, end, flags):
    """Read packet boundaries, including Xiph, fixed and EBML lacing."""
    mode = flags & 6
    count = exact(f, 1)[0] + 1 if mode else 1
    sizes = []
    if mode == 2:  # Xiph
        for _ in range(count - 1):
            size = 0
            while True:
                b = exact(f, 1)[0]
                size += b
                if b != 255:
                    break
            sizes.append(size)
    elif mode == 6:  # EBML: first size is unsigned, subsequent sizes are deltas
        if count > 1:
            sizes.append(vint(f)[0])
            for _ in range(count - 2):
                delta, width = vint(f)
                sizes.append(sizes[-1] + delta - ((1 << (7 * width - 1)) - 1))
    remaining = end - f.tell()
    if mode == 4:
        if remaining % count:
            raise InvalidAudio('Invalid fixed lace')
        sizes = [remaining // count] * count
    else:
        sizes.append(remaining - sum(sizes))
    if any(size <= 0 for size in sizes) or sum(sizes) != remaining:
        raise InvalidAudio('Invalid lace sizes')
    result = []
    for size in sizes:
        pos = f.tell()
        result.append(exact(f, min(size, 2)))
        f.seek(pos + size)
    return result


def opus_seconds(packet):
    config = packet[0] >> 3
    ms = 2.5 * (1 << (config & 3)) if config >= 16 else 10 * (1 << (config & 1)) if config >= 12 else (10, 20, 40, 60)[config & 3]
    code = packet[0] & 3
    count = 1 if code == 0 else 2 if code in (1, 2) else packet[1] & 63 if len(packet) > 1 else 0
    if not count or ms * count > 120:
        raise InvalidAudio('Invalid Opus packet duration')
    return ms * count / 1000


def webm(f):
    eid, start, end, _ = header(f, f.size)
    if eid != 0x1A45DFA3:
        raise InvalidAudio('Missing EBML header')
    doctype = None
    for key, pos, stop in children(f, start, end):
        if key == 0x4282:
            doctype = exact(f, stop - pos)
    if doctype != b'webm':
        raise InvalidAudio('Not a WebM document')
    f.seek(end)
    # Allow global Void/CRC elements before the Segment.
    while True:
        eid, start, end, _ = header(f, f.size)
        if eid == 0x18538067:
            break
        if eid not in (0xEC, 0xBF):
            raise InvalidAudio('Missing WebM segment')
        f.seek(end)
    segment_end = end
    scale, declared, audio, clusters = 1000000, None, {}, []
    f.seek(start)
    while f.tell() < segment_end:
        key, pos, stop, unknown = header(f, segment_end)
        if key == 0x1549A966:  # Info
            for k, p, e in children(f, pos, stop):
                if k == 0x2AD7B1:
                    scale = uint(f, e)
                elif k == 0x4489:
                    declared = floating(f, e)
        elif key == 0x1654AE6B:  # Tracks
            for k, p, e in children(f, pos, stop):
                if k != 0xAE:
                    continue
                track = {'delay': 0, 'default': 0, 'scale': 1, 'last': None, 'delta': 0}
                for field, a, b in children(f, p, e):
                    names = {0xD7: 'number', 0x83: 'type', 0x56AA: 'delay', 0x23E383: 'default'}
                    if field in names:
                        track[names[field]] = uint(f, b)
                    elif field == 0x86:
                        track['codec'] = exact(f, b - a)
                    elif field == 0x23314F:
                        track['scale'] = floating(f, b)
                if track.get('type') == 2 and track.get('codec') in (b'A_OPUS', b'A_VORBIS') and track.get('number', 0) > 0:
                    audio[track['number']] = track
        elif key == 0x1F43B675:
            if unknown:
                # MediaRecorder may omit Cluster sizes. A new Segment child
                # ends the preceding open-ended Cluster, not the whole file.
                while f.tell() < segment_end:
                    before = f.tell()
                    child, _, child_end, _ = header(f, segment_end)
                    if child in LEVEL1:
                        stop = before
                        break
                    f.seek(child_end)
            clusters.append((pos, stop))
        f.seek(stop)
    if scale <= 0 or not audio:
        raise InvalidAudio('No WebM audio track')
    found, last_end = False, 0
    for start, end in clusters:
        timestamp = 0
        # Timestamp is normally the first child. Resolve it independently of order.
        for key, pos, stop in children(f, start, end):
            if key == 0xE7:
                timestamp = uint(f, stop)
        for key, pos, stop in children(f, start, end):
            block, block_end, explicit, padding = None, None, None, 0
            if key == 0xA3:
                block, block_end = pos, stop
            elif key == 0xA0:
                for k, p, e in children(f, pos, stop):
                    if k == 0xA1:
                        block, block_end = p, e
                    elif k == 0x9B:
                        explicit = uint(f, e)
                    elif k == 0x75A2:
                        if not 0 < e - p <= 8:
                            raise InvalidAudio('Invalid discard padding')
                        padding = int.from_bytes(exact(f, e - p), 'big', signed=True) / 1e9
            if block is None:
                continue
            f.seek(block)
            number, _ = vint(f)
            if number not in audio:
                continue
            relative, flags = struct.unpack('>hB', exact(f, 3))
            track = audio[number]
            payloads = packets(f, block_end, flags)
            found = True
            pts = (timestamp + relative * track['scale']) * scale / 1e9 - track['delay'] / 1e9
            if track['last'] is not None and pts > track['last']:
                track['delta'] = pts - track['last']
            track['last'] = pts
            if explicit is not None:
                length = explicit * track['scale'] * scale / 1e9
            elif track['codec'] == b'A_OPUS':
                length = sum(opus_seconds(p) for p in payloads)
            else:
                length = track['default'] * len(payloads) / 1e9 or track['delta']
            last_end = max(last_end, pts + length - max(0, padding))
    if not found:
        raise InvalidAudio('WebM has no audio packets')
    return duration(declared * scale / 1e9 if declared is not None else last_end)


def inspect_audio(path):
    """Return a finite duration for an accepted audio container, or raise."""
    ext = os.path.splitext(path)[1].lower()
    try:
        with open(path, 'rb') as source:
            reader = Reader(source)
            if ext == '.aac':
                return adts(reader)
            if ext == '.webm':
                return webm(reader)
            tag = TinyTag.get(file_obj=reader, tags=False, duration=True, image=False)
            expected = {'.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav'}
            mime = (tag.mime_type or '').split(';', 1)[0]
            if ext not in expected or expected[ext] != mime or not tag.channels or not tag.samplerate:
                raise InvalidAudio('Missing or mismatched audio stream')
            return duration(tag.duration)
    except (ValueError, EOFError, OSError, struct.error, IndexError, OverflowError, _vendor.TinyTagException) as exc:
        raise InvalidAudio('Invalid or unsupported audio') from exc
