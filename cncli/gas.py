"""GAS client, port of CNmobile www/js/gas.js. Stdlib only.

Same contract as gas_service.py: POST {action,args} with
Content-Type text/plain, deviceId CNmobile, token from redirectUrl
fallback token_<ms>. Timeout 20s, full English.
"""

import json
import re
import time
import urllib.parse
import urllib.request

GAS_URL = ("https://script.google.com/macros/s/"
           "AKfycbw95Qnt8U-GQWt04AeG3sBpBfcBleNLfPMSr0arOXtGDH2iZiMDVoWHyBmNpW8Shejo/exec")
GAS_TIMEOUT_S = 20
DEVICE_ID = "CNmobile"


def summarize(rows):
    """(total_kurang, total_lebih) from dashboard rows. Pure function."""
    kurang = lebih = 0
    for row in rows or []:
        try:
            s = float((row or {}).get("jumlahSelisih") or 0)
        except (TypeError, ValueError):
            s = 0
        if s < 0:
            kurang += abs(s)
        elif s > 0:
            lebih += s
    return (kurang, lebih)


def call_api(action, args):
    data = json.dumps({"action": action, "args": args}).encode("utf-8")
    req = urllib.request.Request(
        GAS_URL, data=data, headers={"Content-Type": "text/plain"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=GAS_TIMEOUT_S) as res:
            return json.loads(res.read().decode("utf-8", "replace"))
    except Exception as exc:
        return {"success": False,
                "message": "connection failed: %s" % exc}


def _token_from_redirect(url):
    m = re.search(r"token=([^&]+)", url or "")
    if m:
        return urllib.parse.unquote(m.group(1))
    return "token_%d" % int(time.time() * 1000)


def login(email, password):
    res = call_api("checkLogin", [{
        "email": (email or "").strip(),
        "password": password,
        "deviceId": DEVICE_ID,
    }])
    if not res or not res.get("success"):
        return {"success": False,
                "message": (res or {}).get("message")
                or "wrong email or password"}
    return {"success": True,
            "token": _token_from_redirect(res.get("redirectUrl")),
            "user": res.get("user")}


def get_dashboard_data(token, cashier_name=""):
    res = call_api("getDashboardData", [token, cashier_name or ""])
    if not res or not res.get("success"):
        return {"success": False,
                "message": (res or {}).get("error")
                or (res or {}).get("message")
                or "failed to load transactions",
                "data": []}
    data = res.get("data") or []
    kurang, lebih = summarize(data)
    return {"success": True,
            "total_transaksi": res.get("totalTransaksi", len(data)),
            "total_kurang": kurang,
            "total_lebih": lebih,
            "data": data}


def _rupiah(v):
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        n = 0
    s = "%d" % abs(n)
    parts = []
    while len(s) > 3:
        parts.insert(0, s[-3:])
        s = s[:-3]
    parts.insert(0, s)
    out = ".".join(parts)
    return ("Rp -" if n < 0 else "Rp ") + out


def interactive_dashboard(prefer=None):
    """Auto-login via stored creds, 5-day dashboard, conflict ask.

    prefer: None (ask per conflict) or 'local' or 'gas' for scripts.
    Returns exit code int.
    """
    from cncli import store
    email, password = store.load_creds()
    if not email or not password:
        try:
            email = input("GAS email: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 130
        import getpass
        try:
            password = getpass.getpass("GAS password (hidden): ")
        except (EOFError, KeyboardInterrupt):
            print()
            return 130
        store.save_creds(email, password)
    auth = login(email, password)
    if not auth.get("success"):
        print("login failed: %s" % auth.get("message"))
        return 1
    dash = get_dashboard_data(auth["token"])
    if not dash.get("success"):
        print("fetch failed: %s" % dash.get("message"))
        return 1
    rows = dash["data"]
    print("transactions: %d" % dash["total_transaksi"])
    print("total short: %s" % _rupiah(dash["total_kurang"]))
    print("total over: %s" % _rupiah(dash["total_lebih"]))
    for row in rows[:5]:
        print("- %s | %s | %s" % (
            row.get("tanggal", "?"), row.get("shift", "?"),
            _rupiah(row.get("jumlahSelisih", 0))))
    conn = store.open_db()
    try:
        cached = store.load_setoran_cache(conn, email)
        if cached != rows:
            if prefer in ("local", "gas"):
                pick = prefer
            else:
                try:
                    pick = input(
                        "cache differs from GAS, use local or gas? [local/gas]: "
                    ).strip().lower()
                except (EOFError, KeyboardInterrupt):
                    print()
                    return 130
                if pick not in ("local", "gas"):
                    print("cancelled.")
                    return 2
            if pick == "gas":
                store.save_setoran_cache(conn, email, rows)
                print("saved GAS version to cache.")
            else:
                print("kept local cache.")
        else:
            store.save_setoran_cache(conn, email, rows)
    finally:
        conn.close()
    return 0
