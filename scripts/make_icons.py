#!/usr/bin/env python3
"""Generate the PWA's PNG icons with the standard library only (no image packages needed)."""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "public"
BG = (28, 25, 23)
CARD = (250, 250, 249)
ACCENT = (217, 119, 6)


def pixel(x: int, y: int, n: int) -> tuple[int, int, int]:
    u, v = x / n, y / n
    if 0.26 <= u <= 0.74 and 0.22 <= v <= 0.78:  # a vocabulary card
        if 0.34 <= u <= 0.66 and 0.60 <= v <= 0.66:  # with an underlined word
            return ACCENT
        return CARD
    return BG


def png(n: int) -> bytes:
    rows = b"".join(b"\x00" + bytes(c for x in range(n) for c in pixel(x, y, n)) for y in range(n))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    ext = OUT.parent.parent / "extension" / "static"
    targets = [
        (OUT / "pwa-192.png", 192),
        (OUT / "pwa-512.png", 512),
        (OUT / "apple-touch-icon.png", 180),
        (ext / "icon-128.png", 128),
    ]
    for path, size in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png(size))
        print(f"wrote {path}")
