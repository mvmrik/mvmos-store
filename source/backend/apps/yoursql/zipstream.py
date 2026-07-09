"""
Minimal single/multi-entry streaming DEFLATE zip writer.

zipfile.ZipFile's own ZIP_DEFLATED writer buffers internally in the zlib
compressor and won't hand back compressed bytes until an entry is closed —
fine for small in-memory archives, but means a StreamingResponse built on top
of it sits completely silent (no bytes reaching the client) for however long
the whole entry takes to write, which for a large database export is minutes
with nothing to show for it. This module flushes the compressor after every
chunk (zlib.Z_SYNC_FLUSH) so compressed bytes are actually available to yield
moments after they're fed in, while still producing a standard, valid,
compressed zip file (verified against Python's own zipfile reader).
"""

import struct
import zlib


def stream_zip(entries):
    """entries: iterable of (name: str, chunks: iterable of bytes).
    Yields bytes making up a complete, valid, ZIP_DEFLATED archive."""
    offset = 0
    central = []
    for name, chunks in entries:
        entry_start = offset
        name_b = name.encode()
        co = zlib.compressobj(6, zlib.DEFLATED, -15)
        crc = 0
        usize = 0
        csize = 0
        flags = 0x08  # bit 3: sizes/crc follow in a data descriptor after the data
        header = struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, flags, 8, 0, 0, 0, 0, 0, len(name_b), 0) + name_b
        yield header
        offset += len(header)
        for chunk in chunks:
            if not chunk:
                continue
            crc = zlib.crc32(chunk, crc)
            usize += len(chunk)
            out = co.compress(chunk) + co.flush(zlib.Z_SYNC_FLUSH)
            if out:
                csize += len(out)
                yield out
                offset += len(out)
        out = co.flush(zlib.Z_FINISH)
        csize += len(out)
        yield out
        offset += len(out)
        dd = struct.pack('<IIII', 0x08074b50, crc, csize, usize)
        yield dd
        offset += len(dd)
        central.append((name_b, crc, csize, usize, entry_start))

    cd_start = offset
    cd_size = 0
    for name_b, crc, csize, usize, entry_start in central:
        rec = struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, 0x08, 8, 0, 0, crc, csize, usize,
                           len(name_b), 0, 0, 0, 0, 0, entry_start) + name_b
        yield rec
        cd_size += len(rec)
    eocd = struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, len(central), len(central), cd_size, cd_start, 0)
    yield eocd
