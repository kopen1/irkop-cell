#!/usr/bin/env python3
"""Resize PNG 8-bit RGBA non-interlaced tanpa dependensi (zlib + struct).

Pakai: python3 tools/resize_png.py <src> <dst> <width> <height>
"""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit('bukan PNG')
    pos = 8
    idat = b''
    w = h = bd = ct = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, comp, filt, inter = struct.unpack('>IIBBBBB', chunk)
            if bd != 8 or ct != 6 or inter != 0:
                raise SystemExit(f'hanya 8-bit RGBA non-interlaced (bd={bd} ct={ct} inter={inter})')
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, out


def write_png(path, w, h, px):
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y * stride:(y + 1) * stride]

    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(out)


def resize(w, h, px, dw, dh):
    stride = w * 4
    out = bytearray(dw * dh * 4)
    for y in range(dh):
        sy0 = y * h // dh
        sy1 = max(sy0 + 1, (y + 1) * h // dh)
        for x in range(dw):
            sx0 = x * w // dw
            sx1 = max(sx0 + 1, (x + 1) * w // dw)
            r = g = b = a = n = 0
            for sy in range(sy0, sy1):
                base = sy * stride
                for sx in range(sx0, sx1):
                    i = base + sx * 4
                    r += px[i]
                    g += px[i + 1]
                    b += px[i + 2]
                    a += px[i + 3]
                    n += 1
            o = (y * dw + x) * 4
            out[o] = r // n
            out[o + 1] = g // n
            out[o + 2] = b // n
            out[o + 3] = a // n
    return out


def fit(src_w, src_h, px, dw, dh, ratio):
    """Skala logo ke kotak di tengah kanvas transparan (safe zone adaptive icon)."""
    inner = max(1, int(dw * ratio))
    scaled = resize(src_w, src_h, px, inner, inner)
    out = bytearray(dw * dh * 4)
    off = (dw - inner) // 2
    for y in range(inner):
        sy = y * inner
        dy = off + y
        for x in range(inner):
            si = (sy + x) * 4
            di = (dy * dw + off + x) * 4
            out[di:di + 4] = scaled[si:si + 4]
    return out


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    dw, dh = int(sys.argv[3]), int(sys.argv[4])
    ratio = float(sys.argv[5]) if len(sys.argv) > 5 else 0
    w, h, px = read_png(src)
    if ratio > 0:
        out = fit(w, h, px, dw, dh, ratio)
    elif (dw, dh) != (w, h):
        out = resize(w, h, px, dw, dh)
    else:
        out = px
    write_png(dst, dw, dh, out)
    print(f'{dst}  {dw}x{dh}' + (f'  fit={ratio}' if ratio else ''))
