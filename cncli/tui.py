"""Interactive menu: React OpenTUI launcher with plain fallback.

Full-TUI runs on a TTY when a node/bun runtime plus the tui build exist;
pipe/--json and missing runtimes fall back to plain prompts.
Never traceback.
"""

import getpass
import os
import shutil
import subprocess
import sys

try:
    from cncli import banner as _banner_mod
    _BANNER = _banner_mod.BANNER
except Exception:
    _banner_mod = None
    _BANNER = "CNCLI"

try:
    from cncli import store as _store
except Exception:
    _store = None

try:
    from cncli import lan as _lan
except Exception:
    _lan = None

try:
    from cncli import gas as _gas
except Exception:
    _gas = None

MAIN_MENU = "\n".join([
    "[01] SESSION   list/select/open/close/watch",
    "[02] CASH      count + print + fix",
    "[03] SETORAN   GAS dashboard (5 days)",
    "[04] PC ADMIN  status/log/watcher/port/pin/wipe/off",
    "[00] EXIT",
])

WATCH_INTERVAL_S = 2


def supports_color():
    if os.environ.get("NO_COLOR"):
        return False
    try:
        return sys.stdout.isatty()
    except Exception:
        return False


def color(text, code="32"):
    if not supports_color():
        return text
    return "\x1b[" + code + "m" + text + "\x1b[0m"


def clear_screen():
    if os.environ.get("CNCLI_NO_CLEAR"):
        return
    try:
        if sys.stdout.isatty():
            sys.stdout.write("\x1b[2J\x1b[H")
    except Exception:
        pass


def status_line():
    pc, ses = "--", "--"
    if _store is not None:
        try:
            pc, ses = _store.active_status()
        except Exception:
            pass
    return "PC: %s | session: %s" % (pc, ses)


def print_banner():
    clear_screen()
    text = _BANNER
    if _banner_mod is not None:
        try:
            w = shutil.get_terminal_size((80, 24)).columns
        except Exception:
            w = 80
        no_color = bool(os.environ.get("NO_COLOR")) or not supports_color()
        try:
            if w < 40 or no_color:
                text = _banner_mod.BANNER_COMPACT if w >= 30 else _banner_mod.BANNER_PLAIN
            else:
                text = _banner_mod.BANNER_FULL_RAW
        except Exception:
            text = _BANNER
    try:
        print(color(text, "36"))
    except UnicodeEncodeError:
        # ponytail: old Windows console can't encode block chars, plain fallback
        try:
            text = _banner_mod.BANNER_COMPACT
        except Exception:
            text = _BANNER
        try:
            print(text)
        except UnicodeEncodeError:
            print("CNCLI")
    print(color(status_line(), "33"))
    try:
        hint = _banner_mod.FOOTER_HINT
    except Exception:
        hint = "00 back"
    print(color(hint, "32"))


def _read(prompt):
    try:
        return input(prompt).strip()
    except EOFError:
        print()
        return "00"
    except KeyboardInterrupt:
        print()
        raise


def prompt_default(label, default=""):
    hint = " [%s]" % default if default else ""
    val = _read(label + hint + ": ")
    return val or default


def ask_pin():
    try:
        return getpass.getpass("PIN (hidden): ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        raise KeyboardInterrupt


def parse_denoms(spec):
    """Parse '100k*5,50k*2' (also '100000x3', '50 k'). Returns total int."""
    total = 0
    spec = (spec or "").lower().replace("rp", "").strip()
    if not spec:
        return 0
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        mult = 1
        for sep in ("*", "x", "@"):
            if sep in chunk:
                left, _, right = chunk.partition(sep)
                chunk, mult = left.strip(), int(right.strip() or 1)
                break
        chunk = chunk.replace(" ", "")
        if chunk.endswith("k"):
            face = int(chunk[:-1] or 0) * 1000
        elif chunk.endswith("jt") or chunk.endswith("m"):
            face = int(chunk.rstrip("jtm") or 0) * 1000000
        else:
            face = int(chunk or 0)
        total += face * mult
    return total


def session_wizard():
    """SESSION: list, detail-first resume/new/watch. Interval default 2s."""
    print("-- SESSION (watch interval %ds, Ctrl+C keeps session open) --"
          % WATCH_INTERVAL_S)
    if _store is None:
        print("store backend not wired yet (store milestone).")
        return None
    conn = _store.open_db()
    sessions = list(_store.list_sessions(conn, 50))
    if not sessions:
        print("no sessions yet.")
        if _read("open a new one? [y/N]: ").lower() != "y":
            return None
        return _wizard_new_session(conn)
    for i, s in enumerate(sessions, 1):
        mark = "*" if s["status"] == "open" else " "
        flag = " !" if not s["complete"] else ""
        print("[%d]%s %s%s" % (i, mark, s["id"], flag))
    choice = _read("pick number, 'new', 'del', or 00 back: ")
    if choice == "00":
        return "00"
    if choice == "new":
        return _wizard_new_session(conn)
    if choice in ("del", "delete"):
        target = _read("session id or number to delete (closed only): ")
        try:
            target = sessions[int(target) - 1]["id"]
        except (ValueError, IndexError):
            pass
        doomed = _store.get_session(conn, target)
        if doomed is None:
            print("unknown session.")
            return None
        if doomed["status"] == "open":
            print("refused: session is open (stop it first).")
            return None
        _store.delete_session(conn, target)
        print("deleted %s" % target)
        return None
    try:
        picked = sessions[int(choice) - 1]
    except (ValueError, IndexError):
        print("unknown choice.")
        return None
    print("id: %s" % picked["id"])
    print("pc: %s" % (picked["base_url"] or "--"))
    print("started: %s | status: %s | tx: %s%s" % (
        picked["started_at"] or "--", picked["status"],
        picked["count"] or 0,
        " | INCOMPLETE" if not picked["complete"] else ""))
    if _read("resume + watch %s? [y/N]: " % picked["id"]).lower() != "y":
        return None
    _store.patch_session(conn, picked["id"],
                         {"status": "open", "closed_at": None})
    from cncli.cli import open_and_watch
    return open_and_watch(conn, picked["id"],
                          picked["base_url"] or _saved_base(),
                          WATCH_INTERVAL_S)


def _wizard_new_session(conn):
    base = _saved_base()
    if not base:
        base = _read("PC base_url (e.g. http://192.168.1.5:8765): ")
        if not base:
            return None
    s = _store.create_session(conn, base)
    print("session %s" % s["id"])
    from cncli.cli import open_and_watch
    return open_and_watch(conn, s["id"], base, WATCH_INTERVAL_S)


def _saved_base():
    try:
        with open(os.path.join(os.path.expanduser("~"), ".cncli",
                               "config"), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def cash_wizard():
    """CASH: count denominations vs active session, preview, optional send."""
    print("-- CASH count (e.g. 100k*5,50k*2,10k*10; empty = ask) --")
    spec = _read("denominations: ")
    try:
        from cncli import cash as _cash
    except Exception:
        _cash = None
    if _cash is None:
        try:
            total = parse_denoms(spec)
        except ValueError:
            print("bad denomination, nothing counted.")
            return None
        print("physical total: Rp %d" % total)
        print("[= cncli count '%s']" % spec)
        return None
    try:
        qty = _cash.qty_from_spec(spec)
    except ValueError:
        print("bad denomination, nothing counted.")
        return None
    total = sum(d * q for d, q in qty.items())
    print("physical total: Rp %d" % total)
    noncash, meta = 0, {}
    if _store is not None:
        try:
            base = _store.session_totals()
            print("PC total: Rp %d (cash %d, non-cash %d)" % base)
            print("diff: Rp %d" % (total - base[0]))
            noncash = base[2]
            conn = _store.open_db()
            try:
                for k in ("kasir", "kasir_id", "cabang", "shift", "size"):
                    meta[k] = _store.get_meta(conn, k)
            finally:
                conn.close()
        except Exception as exc:
            print("cannot load session totals: %s" % exc)
    else:
        print("session compare needs store backend (store milestone).")
    if _read("print recap to PC printer? [y/N]: ").lower() != "y":
        print("[= cncli count '%s']" % spec)
        return None
    if _lan is None:
        print("[= cncli count '%s' --print] (lan backend pending)" % spec)
        return None
    payload = _cash.build_payload(
        qty, kasir=meta.get("kasir", ""), branch=meta.get("cabang", ""),
        shift=meta.get("shift", ""), user_id=meta.get("kasir_id", "-"),
        noncash=noncash, size=meta.get("size", "58"), base=_saved_base())
    err = _cash.validate_send(payload)
    if err:
        print("cannot print: %s" % err)
        return None
    for line in _cash.preview_receipt(payload):
        print(line)
    if _read("send to PC? [y/N]: ").lower() != "y":
        return None
    r = _lan.send_print(payload["base"], {
        k: payload[k] for k in ("kasir", "branch", "shift", "user_id",
                                "qty", "expense_amount", "expense_note",
                                "nontunai_amount", "size")})
    if r.get("ok"):
        print("printed at %s" % ((r.get("data") or {}).get("printer")
                                 or "printer"))
    else:
        print("failed: %s" % r.get("error"))
    return None


def setoran_flow():
    """SETORAN: auto-login GAS, 5-day dashboard, conflict ask."""
    print("-- SETORAN (auto login, 5 days, conflict asks local/gas) --")
    if _gas is None:
        print("gas backend not wired yet (store milestone).")
        print("[= cncli setoran]  or  [= cncli setoran --prefer gas]")
        return None
    try:
        _gas.interactive_dashboard()
    except Exception as exc:
        print("setoran failed: %s" % exc)
    return None


def _need_lan():
    if _lan is None:
        print("lan backend missing.")
        return None
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`).")
        return None
    return base


def _need_pin():
    try:
        pin = ask_pin()
    except KeyboardInterrupt:
        return None
    if not pin:
        print("cancelled: empty PIN.")
        return None
    return pin


def pc_admin():
    """PC ADMIN: displays run directly; changes ask PIN, wipe/shutdown confirm."""
    items = "\n".join([
        "[1] status",
        "[2] log",
        "[3] watcher on/off",
        "[4] port",
        "[5] change PIN",
        "[6] WIPE (destructive)",
        "[7] shutdown PC",
        "[00] BACK",
    ])
    print(items)
    choice = _read("pc > ")
    if choice == "00":
        return "00"
    base = _need_lan()
    if base is None:
        return None
    if choice == "1":
        r = _lan.status_get(base)
        if not r["ok"]:
            print("error: %s" % r["error"])
            return None
        for key in ("version", "ip", "port", "watcher_enabled",
                    "count_today"):
            print("%s: %s" % (key, (r["data"] or {}).get(key, "?")))
        return None
    if choice == "2":
        pin = _need_pin()
        if pin is None:
            return None
        tail = _read("tail lines [200]: ") or "200"
        r = _lan.log_get(base, pin, tail)
        if not r["ok"]:
            print("error: %s" % r.get("error"))
            return None
        for line in (r["data"] or {}).get("lines", []):
            print(line)
        return None
    if choice == "3":
        cur = _lan.watcher_get(base)
        if cur["ok"]:
            print("watcher now: %s"
                  % ("on" if (cur["data"] or {}).get("enabled") else "off"))
        want = _read("set watcher on or off? [on/off]: ").lower()
        if want not in ("on", "off"):
            return None
        pin = _need_pin()
        if pin is None:
            return None
        r = _lan.watcher_set(base, pin, want == "on")
        print("watcher: %s" % ("on" if (r.get("data") or {}).get("enabled")
                               else r.get("error")))
        return None
    if choice == "4":
        port = _read("new PC port: ")
        pin = _need_pin()
        if pin is None:
            return None
        r = _lan.port_set(base, pin, port)
        print("port: %s" % ((r.get("data") or {}).get("port")
                             or r.get("error")))
        return None
    if choice == "5":
        new_pin = _read("new 6-digit PIN: ")
        pin = _need_pin()
        if pin is None:
            return None
        r = _lan.pin_set(base, pin, new_pin)
        print("pin change: %s" % ("ok" if r.get("ok") else r.get("error")))
        return None
    if choice == "6":
        pin = _need_pin()
        if pin is None:
            return None
        if _read("type HAPUS to confirm wipe: ") != "HAPUS":
            print("cancelled: HAPUS not typed.")
            return None
        r = _lan.wipe(base, pin, "HAPUS")
        print("wipe: %s" % ("ok" if r.get("ok") else r.get("error")))
        return None
    if choice == "7":
        pin = _need_pin()
        if pin is None:
            return None
        if _read("type YES to shutdown PC: ") != "YES":
            print("cancelled: YES not typed.")
            return None
        r = _lan.shutdown(base, pin)
        print("shutdown: %s" % ("ok" if r.get("ok") else r.get("error")))
        return None
    print("unknown choice.")
    return None


# ---------------------------------------------------------------------------
# React OpenTUI launcher (tui/ folder). Plain prompts above stay as fallback.
# ponytail: subprocess passthrough, no runtime version parsing; fallback walks
# the candidate list until one exits, else plain menu.
# ---------------------------------------------------------------------------

def _tui_root():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tui")


def _launch_react_tui():
    """Run the React TUI. Returns exit code, or None when no runtime found."""
    root = _tui_root()
    dist = os.path.join(root, "dist", "index.js")
    src = os.path.join(root, "src", "index.tsx")
    node = shutil.which("node")
    bun = shutil.which("bun")
    cands = []
    if node and os.path.isfile(dist):
        cands.append([node, "--experimental-ffi", dist])
    if bun and os.path.isfile(src):
        cands.append([bun, src])
    for cmd in cands:
        try:
            return subprocess.call(cmd, cwd=root)
        except KeyboardInterrupt:
            return 0
        except OSError:
            continue
    return None


_ACTIONS = {
    "01": session_wizard, "1": session_wizard,
    "02": cash_wizard, "2": cash_wizard,
    "03": setoran_flow, "3": setoran_flow,
    "04": pc_admin, "4": pc_admin,
}


def plain_main():
    """Plain menu loop (fallback). 00 goes back, exit closes on Ctrl-C."""
    while True:
        print_banner()
        print(MAIN_MENU)
        try:
            choice = _read("cncli > ")
        except KeyboardInterrupt:
            print("bye.")
            return 0
        if choice in ("00", "0", "q", "quit", "exit"):
            print("bye.")
            return 0
        action = _ACTIONS.get(choice)
        if action is None:
            print("unknown choice, try 01-04 or 00.")
            try:
                _read("press Enter: ")
            except KeyboardInterrupt:
                print("bye.")
                return 0
            continue
        try:
            action()
        except KeyboardInterrupt:
            continue
        try:
            _read("press Enter to continue: ")
        except KeyboardInterrupt:
            continue


def main():
    """Try React TUI on TTY, else plain fallback. Never hangs."""
    try:
        if sys.stdin.isatty() and sys.stdout.isatty():
            rc = _launch_react_tui()
            if rc == 0:
                return 0
    except Exception as exc:
        print("tui fallback: %s" % exc)
    try:
        if sys.stdin.isatty():
            return plain_main()
    except Exception:
        pass
    print("error: menu needs an interactive TTY")
    return 2
