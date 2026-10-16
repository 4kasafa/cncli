"""Cash count + print payload, port of CNmobile www/js/print.js. Stdlib only.

DENOMS, qty spec (100k x5), receipt preview (32 cols), send validations
and the exact POST /api/print payload shape the PC expects.
"""

import datetime

DENOMS = [100000, 75000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200,
          100]


def _face(token):
    token = token.replace(" ", "")
    if token.endswith("k"):
        return int(token[:-1] or 0) * 1000
    if token.endswith("jt") or token.endswith("m"):
        return int(token.rstrip("jtm") or 0) * 1000000
    return int(token or 0)


def qty_from_spec(spec):
    """'100k x5,50k x2' (also *, @) -> {denom: count}. Raises ValueError."""
    qty = {}
    for chunk in (spec or "").lower().replace("rp", "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        mult = 1
        for sep in ("*", "x", "@"):
            if sep in chunk:
                left, _, right = chunk.partition(sep)
                chunk, mult = left.strip(), int(right.strip() or 1)
                break
        face = _face(chunk)
        if face <= 0 or mult <= 0:
            raise ValueError("bad denomination: %r" % chunk)
        qty[face] = qty.get(face, 0) + mult
    return qty


def build_payload(qty, kasir="", branch="", shift="", user_id="-",
                  expense=0, note="", noncash=0, size="58", base=""):
    qty = {int(d): int(q) for d, q in (qty or {}).items() if int(q) > 0}
    return {
        "kasir": (kasir or "").strip(),
        "branch": (branch or "").strip(),
        "shift": shift or "",
        "user_id": (user_id or "").strip() or "-",
        "qty": qty,
        "expense_amount": max(0, int(expense or 0)),
        "expense_note": (note or "").strip(),
        "nontunai_amount": max(0, int(noncash or 0)),
        "size": "80" if size == "80" else "58",
        "fisik": sum(d * q for d, q in qty.items()),
        "base": (base or "").strip(),
    }


def validate_send(p):
    """English error string, or '' when ready to send."""
    p = p or {}
    if not str(p.get("kasir") or "").strip():
        return "fill kasir first"
    if not str(p.get("user_id") or "").strip():
        return "fill cashier id first"
    if int(p.get("fisik") or 0) <= 0:
        return "fill denominations first"
    if not str(p.get("base") or "").strip():
        return "connect to PC first"
    return ""


def _group(n):
    s = "%d" % abs(int(n or 0))
    parts = []
    while len(s) > 3:
        parts.insert(0, s[-3:])
        s = s[:-3]
    parts.insert(0, s)
    return ".".join(parts)


def _rupiah(v):
    n = int(v or 0)
    return ("Rp -" if n < 0 else "Rp ") + _group(n)


def _center(s, w):
    s = str(s)[:w]
    pad = w - len(s)
    left = pad // 2
    return " " * left + s + " " * (pad - left)


def preview_receipt(payload, width=32):
    """Receipt lines, every line at most `width` chars."""
    p = payload or {}
    w = max(int(width or 32), 10)
    qty = p.get("qty") or {}
    fisik = p["fisik"] if "fisik" in p else sum(
        d * q for d, q in qty.items())
    lines = [
        _center("TOKO LAY", w),
        _center("Laporan Penjualan", w),
        "-" * w,
        ("Tanggal %s" % datetime.date.today().isoformat())[:w],
        ("Cabang %s" % (p.get("branch") or "-"))[:w],
        ("Shift %s" % (p.get("shift") or "-"))[:w],
        ("Kasir %s" % (p.get("kasir") or "-"))[:w],
        "-" * w,
    ]
    for d in sorted(qty):
        q = qty[d]
        if q > 0:
            lines.append(("%s x %d = %s"
                          % (_group(d), q, _rupiah(d * q)))[:w])
    lines.append(("-" * w))
    lines.append(("TOTAL FISIK %s" % _rupiah(fisik))[:w])
    lines.append(("Non Tunai %s" % _rupiah(p.get("nontunai_amount", 0)))[:w])
    lines.append(("Pengeluaran %s" % _rupiah(p.get("expense_amount", 0)))[:w])
    if p.get("expense_note"):
        lines.append(("Ket: %s" % p["expense_note"])[:w])
    lines.append(_center(datetime.datetime.now().strftime(
        "%d/%m/%Y %H:%M:%S"), w))
    return lines
