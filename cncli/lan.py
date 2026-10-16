"""LAN client for CNdesktop, port of CNmobile www/js/lan.js. Stdlib only.

Contract owned by the PC (CNdesktop PRD); this module only forwards.
PINs are call arguments, never stored. Timeout 10s, full English.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT_S = 10


def _base(url):
    return (url or "").strip().rstrip("/")


def map_err(status, body_err, is_timeout):
    if is_timeout:
        return "PC unreachable, same WiFi?"
    if status == 400:
        return str(body_err or "request rejected by PC")
    if status == 403:
        return "wrong PIN"
    if status == 409:
        return "PC busy, retry"
    if status == 429:
        return "locked for 5 minutes"
    if status:
        return str(body_err or ("PC refused (HTTP %d)" % status))
    return str(body_err or "connection failed")


def _read_error(exc):
    try:
        body = exc.read().decode("utf-8", "replace")
        data = json.loads(body)
        return data.get("error")
    except Exception:
        return None


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as res:
            return {"ok": True, "data": json.loads(
                res.read().decode("utf-8", "replace"))}
    except urllib.error.HTTPError as exc:
        return {"ok": False,
                "error": map_err(exc.code, _read_error(exc), False),
                "status": exc.code}
    except Exception as exc:
        timeout = isinstance(exc, TimeoutError) or "timed out" in str(exc)
        return {"ok": False, "error": map_err(0, None, timeout), "status": 0}


def _post(url, obj):
    data = json.dumps(obj or {}).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            return {"ok": True, "status": res.status, "data": json.loads(
                res.read().decode("utf-8", "replace"))}
    except urllib.error.HTTPError as exc:
        return {"ok": False,
                "error": map_err(exc.code, _read_error(exc), False),
                "status": exc.code}
    except Exception as exc:
        timeout = isinstance(exc, TimeoutError) or "timed out" in str(exc)
        return {"ok": False, "error": map_err(0, None, timeout), "status": 0}


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def health(base_url):
    r = _get(_base(base_url) + "/api/health")
    if not r["ok"]:
        return r
    data = r["data"] or {}
    if data.get("ok") is False:
        return {"ok": False, "error": "PC reports unhealthy"}
    return {"ok": True, "raw": data}


def _norm_row(r):
    r = r or {}
    return {
        "server_id": _to_int(r.get("id")),
        "no_transaksi": str(r.get("no_transaksi") or ""),
        "no_urut": str(r.get("no_urut") or ""),
        "total": _to_int(r.get("total")),
        "tunai": _to_int(r.get("tunai")),
        "nontunai": _to_int(r.get("nontunai")),
        "bank": str(r.get("bank") or ""),
        "kategori": str(r.get("kategori") or ""),
        "created_at": str(r.get("created_at") or ""),
    }


def fetch_tx(base_url, since, limit=50):
    url = (_base(base_url) + "/api/transactions?since=%d&limit=%d"
           % (_to_int(since), _to_int(limit) or 50))
    r = _get(url)
    if not r["ok"]:
        r["rows"] = []
        return r
    data = r["data"]
    arr = data if isinstance(data, list) else (data or {}).get("rows", [])
    return {"ok": True, "rows": [_norm_row(x) for x in arr]}


def send_print(base_url, payload):
    return _post(_base(base_url) + "/api/print", payload)


def wipe(base_url, pin, confirm):
    return _post(_base(base_url) + "/api/wipe",
                 {"pin": pin, "confirm": confirm})


def watcher_get(base_url):
    return _get(_base(base_url) + "/api/watcher")


def watcher_set(base_url, pin, enabled):
    return _post(_base(base_url) + "/api/watcher",
                 {"pin": pin, "enabled": bool(enabled)})


def status_get(base_url):
    r = _get(_base(base_url) + "/api/status")
    if not r["ok"]:
        r.setdefault("status", 0)
        return r
    if not (r["data"] or {}).get("version"):
        return {"ok": False, "error": "old PC version, update first",
                "status": 200}
    return {"ok": True, "data": r["data"], "status": 200}


def log_get(base_url, pin, tail=200):
    tail = min(max(_to_int(tail) or 200, 1), 1000)
    url = (_base(base_url) + "/api/log?pin=%s&tail=%d"
           % (urllib.parse.quote(str(pin or "")), tail))
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as res:
            return {"ok": True, "status": res.status, "data": json.loads(
                res.read().decode("utf-8", "replace"))}
    except urllib.error.HTTPError as exc:
        return {"ok": False,
                "error": map_err(exc.code, _read_error(exc), False),
                "status": exc.code}
    except Exception as exc:
        timeout = isinstance(exc, TimeoutError) or "timed out" in str(exc)
        return {"ok": False, "error": map_err(0, None, timeout), "status": 0}


def port_set(base_url, pin, port):
    return _post(_base(base_url) + "/api/port",
                 {"pin": pin, "port": _to_int(port)})


def pin_set(base_url, pin, new_pin):
    return _post(_base(base_url) + "/api/pin",
                 {"pin": pin, "new_pin": new_pin})


def shutdown(base_url, pin):
    return _post(_base(base_url) + "/api/shutdown", {"pin": pin})


def _saved_base():
    try:
        with open(os.path.join(os.path.expanduser("~"), ".cncli", "config"),
                  encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def status_main(base_url=None):
    """Entry for `cncli status`. Returns process exit code."""
    base = _base(base_url) or _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
    r = status_get(base)
    if not r["ok"]:
        print("error: %s" % r["error"])
        return 1
    d = r["data"] or {}
    print("version: %s" % d.get("version", "?"))
    print("address: %s:%s" % (d.get("ip", "?"), d.get("port", "?")))
    print("watcher: %s" % ("on" if d.get("watcher_enabled") else "off"))
    print("today: %s tx" % d.get("count_today", "?"))
    return 0
