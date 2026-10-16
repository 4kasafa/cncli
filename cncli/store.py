"""SQLite backend, port of CNmobile www/js/store.js. Stdlib only.

Default db: ~/.cncli/cncli.db. Session ids are human: YYYY-MM-DDN.
All data functions take a connection from open_db(); TUI helpers
(active_status, list_sessions, session_totals) open the default db.
"""

import datetime
import json
import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, base_url TEXT, started_at TEXT,
  closed_at TEXT, status TEXT, complete INTEGER,
  last_seen INTEGER, count INTEGER);
CREATE TABLE IF NOT EXISTS tx(
  session_id TEXT, server_id INTEGER, no_transaksi TEXT,
  no_urut TEXT, total INTEGER, tunai INTEGER, nontunai INTEGER,
  bank TEXT, kategori TEXT, created_at TEXT, edited INTEGER DEFAULT 0,
  PRIMARY KEY(session_id, server_id));
CREATE TABLE IF NOT EXISTS fills(
  session_id TEXT, day TEXT, n INTEGER,
  tunai INTEGER, nontunai INTEGER, total INTEGER, kategori TEXT,
  PRIMARY KEY(session_id, day, n));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS setoran_cache(email TEXT PRIMARY KEY,
  payload TEXT, fetched_at TEXT);
"""

MAX_TX = 500
MAX_SESSIONS = 50


def _home():
    return os.path.expanduser("~")


def default_path():
    return os.path.join(_home(), ".cncli", "cncli.db")


def open_db(path=None):
    path = path or default_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def _today():
    return datetime.date.today().isoformat()


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _to_int(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 0
    return n


def create_session(conn, base_url):
    day = _today()
    n = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE id LIKE ?", (day + "_%",)
    ).fetchone()[0] + 1
    sid = "%s_%d" % (day, n)
    conn.execute(
        "INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)",
        (sid, base_url or "", _now(), None, "open", 1, 0, 0),
    )
    conn.execute(
        "DELETE FROM sessions WHERE id NOT IN "
        "(SELECT id FROM sessions ORDER BY started_at DESC LIMIT ?)",
        (MAX_SESSIONS,),
    )
    conn.commit()
    return get_session(conn, sid)


def get_session(conn, sid):
    return conn.execute(
        "SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()


def list_sessions(conn, limit=20):
    return conn.execute(
        "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?",
        (limit,)).fetchall()


def patch_session(conn, sid, patch):
    patch = dict(patch or {})
    cols = [k for k in patch
            if k in ("status", "complete", "closed_at", "last_seen",
                     "count", "base_url")]
    if not cols:
        return get_session(conn, sid)
    conn.execute(
        "UPDATE sessions SET %s WHERE id=?" %
        ",".join("%s=?" % c for c in cols),
        tuple(patch[c] for c in cols) + (sid,))
    conn.commit()
    return get_session(conn, sid)


def close_session(conn, sid, complete):
    return patch_session(conn, sid, {
        "status": "closed", "closed_at": _now(),
        "complete": 1 if complete else 0})


def delete_session(conn, sid):
    s = get_session(conn, sid)
    if s is None or s["status"] == "open":
        return False
    conn.execute("DELETE FROM tx WHERE session_id=?", (sid,))
    conn.execute("DELETE FROM fills WHERE session_id=?", (sid,))
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
    conn.commit()
    return True


def get_last_seen(conn, sid):
    s = get_session(conn, sid)
    return _to_int(s["last_seen"]) if s else 0


def _fill_key(row):
    try:
        n = int(str(row.get("no_urut") or ""))
    except (TypeError, ValueError):
        return ""
    if n <= 0:
        return ""
    day = str(row.get("created_at") or "")[:10] or "??"
    return "%s|%d" % (day, n)


def upsert_tx(conn, session_id, rows):
    seen_id = {r["server_id"] for r in conn.execute(
        "SELECT server_id FROM tx WHERE session_id=?", (session_id,))}
    seen_no = {r["no_transaksi"] for r in conn.execute(
        "SELECT no_transaksi FROM tx WHERE session_id=? "
        "AND no_transaksi<>''", (session_id,))}
    fills = get_fills(conn, session_id)
    added, ids, max_id = 0, [], get_last_seen(conn, session_id)
    for src in rows or []:
        r = dict(src or {})
        sid = _to_int(r.get("server_id"))
        max_id = max(max_id, sid)
        if sid in seen_id:
            continue  # drain never overwrites local edits
        no = str(r.get("no_transaksi") or "")
        if no and no in seen_no:
            continue
        if _fill_key(r) in fills:
            continue  # manual fill wins over late PC data
        seen_id.add(sid)
        if no:
            seen_no.add(no)
        conn.execute(
            "INSERT INTO tx VALUES(?,?,?,?,?,?,?,?,?,?,0)",
            (session_id, sid, no, str(r.get("no_urut") or ""),
             _to_int(r.get("total")), _to_int(r.get("tunai")),
             _to_int(r.get("nontunai")), str(r.get("bank") or ""),
             str(r.get("kategori") or ""),
             str(r.get("created_at") or "")))
        added += 1
        ids.append(sid)
    conn.execute(
        "DELETE FROM tx WHERE session_id=? AND server_id NOT IN "
        "(SELECT server_id FROM tx WHERE session_id=? "
        "ORDER BY server_id DESC LIMIT ?)",
        (session_id, session_id, MAX_TX))
    count = conn.execute(
        "SELECT COUNT(*) FROM tx WHERE session_id=?",
        (session_id,)).fetchone()[0]
    patch_session(conn, session_id, {"last_seen": max_id, "count": count})
    return {"added": added, "last_seen": max_id, "ids": ids}


def list_tx(conn, session_id):
    return conn.execute(
        "SELECT * FROM tx WHERE session_id=? ORDER BY server_id DESC",
        (session_id,)).fetchall()


def _kategori(t, nt, fallback=""):
    if t > 0 and nt > 0:
        return "Split"
    if t > 0:
        return "Tunai"
    if nt > 0:
        return "Nontunai"
    return fallback


def patch_tx(conn, session_id, server_id, tunai, nontunai):
    t, nt = _to_int(tunai), _to_int(nontunai)
    if t < 0 or nt < 0:
        return None
    cur = conn.execute(
        "SELECT * FROM tx WHERE session_id=? AND server_id=?",
        (session_id, _to_int(server_id))).fetchone()
    if cur is None:
        return None
    conn.execute(
        "UPDATE tx SET tunai=?, nontunai=?, total=?, kategori=?, "
        "edited=1 WHERE session_id=? AND server_id=?",
        (t, nt, t + nt, _kategori(t, nt, cur["kategori"]),
         session_id, _to_int(server_id)))
    conn.commit()
    return conn.execute(
        "SELECT * FROM tx WHERE session_id=? AND server_id=?",
        (session_id, _to_int(server_id))).fetchone()


def get_fills(conn, session_id):
    return {"%s|%s" % (r["day"], r["n"]): r for r in conn.execute(
        "SELECT * FROM fills WHERE session_id=?", (session_id,))}


def upsert_fill(conn, session_id, day, n, tunai, nontunai):
    t, nt = _to_int(tunai), _to_int(nontunai)
    try:
        n = int(n)
    except (TypeError, ValueError):
        return None
    if n <= 0 or not day or t < 0 or nt < 0:
        return None
    conn.execute(
        "INSERT OR REPLACE INTO fills VALUES(?,?,?,?,?,?,?)",
        (session_id, day, n, t, nt, t + nt, _kategori(t, nt, "")))
    conn.commit()
    return conn.execute(
        "SELECT * FROM fills WHERE session_id=? AND day=? AND n=?",
        (session_id, day, n)).fetchone()


def set_meta(conn, k, v):
    conn.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, v or ""))
    conn.commit()


def get_meta(conn, k, default=""):
    r = conn.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r["v"] if r else default


def _cred_path(home=None):
    d = os.path.join(home or _home(), ".cncli")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "credentials")


def save_creds(email, password, home=None):
    path = _cred_path(home)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"email": email, "password": password}))
    os.chmod(path, 0o600)


def load_creds(home=None):
    try:
        with open(_cred_path(home), encoding="utf-8") as fh:
            data = json.load(fh)
        return data.get("email", ""), data.get("password", "")
    except (OSError, ValueError, AttributeError):
        return "", ""


def forget_creds(home=None):
    try:
        os.remove(_cred_path(home))
        return True
    except OSError:
        return False


def save_setoran_cache(conn, email, payload):
    conn.execute("INSERT OR REPLACE INTO setoran_cache VALUES(?,?,?)",
                 (email, json.dumps(payload), _now()))
    conn.commit()


def load_setoran_cache(conn, email):
    r = conn.execute("SELECT payload FROM setoran_cache WHERE email=?",
                     (email,)).fetchone()
    if not r:
        return None
    try:
        return json.loads(r["payload"])
    except ValueError:
        return None


def _open_session(conn):
    return conn.execute(
        "SELECT * FROM sessions WHERE status='open' "
        "ORDER BY started_at DESC LIMIT 1").fetchone()


def session_totals(conn=None, session_id=None):
    own = conn is None
    conn = conn or open_db()
    try:
        if session_id is None:
            s = _open_session(conn)
            if s is None:
                return (0, 0, 0)
            session_id = s["id"]
        total = cash = noncash = 0
        for r in list_tx(conn, session_id):
            k = (r["kategori"] or "").lower()
            if k == "tunai":
                cash += _to_int(r["total"])
            elif k == "nontunai":
                noncash += _to_int(r["total"])
            else:
                cash += _to_int(r["tunai"])
                noncash += _to_int(r["nontunai"])
            total += _to_int(r["total"])
        for f in get_fills(conn, session_id).values():
            k = (f["kategori"] or "").lower()
            if k == "tunai":
                cash += _to_int(f["total"])
            elif k == "nontunai":
                noncash += _to_int(f["total"])
            else:
                cash += _to_int(f["tunai"])
                noncash += _to_int(f["nontunai"])
            total += _to_int(f["total"])
        return (total, cash, noncash)
    finally:
        if own:
            conn.close()


def active_status(db=None):
    """(pc, session) for the TUI banner. Never raises."""
    conn = None
    try:
        conn = db or open_db()
        s = _open_session(conn)
        if s is None:
            return ("--", "--")
        return (s["base_url"] or "--", s["id"])
    except Exception:
        return ("--", "--")
    finally:
        if db is None and conn is not None:
            try:
                conn.close()
            except Exception:
                pass
