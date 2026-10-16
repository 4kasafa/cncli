"""Interactive menu, opencode-style Textual TUI with plain fallback.

Full-TUI runs on a TTY when textual is installed; pipe/--json/NO_COLOR
and narrow screens fall back to plain prompts. Never traceback.
"""

import getpass
import os
import shutil
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
# Textual full-TUI (opencode-style). Plain prompts above stay as fallback.
# ponytail: one App + simple screens, backends reused, never traceback.
# ---------------------------------------------------------------------------

def _rp(v):
    try:
        n = int(float(v or 0))
    except (TypeError, ValueError):
        n = 0
    s = "%d" % abs(n)
    parts = []
    while len(s) > 3:
        parts.insert(0, s[-3:])
        s = s[:-3]
    parts.insert(0, s)
    return ("Rp -" if n < 0 else "Rp ") + ".".join(parts)


def _banner_textual():
    raw, markup = "CNCLI", False
    if _banner_mod is not None:
        try:
            w = shutil.get_terminal_size((80, 24)).columns
        except Exception:
            w = 80
        try:
            raw, markup = _banner_mod.pick_banner(
                w, bool(os.environ.get("NO_COLOR")))
        except Exception:
            raw, markup = _BANNER, False
    return (raw, markup)


def _textual_available():
    try:
        import textual  # noqa: F401
        return True
    except Exception:
        return False


def run_textual():
    """Run the full-TUI. Returns exit code. Raises on failure (fallback)."""
    import asyncio

    from textual.app import App, ComposeResult
    from textual.containers import Vertical
    from textual.screen import Screen
    from textual.widgets import (
        Button, Footer, Input, ListItem, ListView, LoadingIndicator, Static,
    )

    banner_text, use_markup = _banner_textual()
    try:
        foot = _banner_mod.FOOTER_HINT
    except Exception:
        foot = "00 back - q stop - Ctrl+C exit"

    class MenuScreen(Screen):
        def compose(self) -> ComposeResult:
            yield Static(banner_text, markup=use_markup)
            yield Static(status_line())
            yield Button("[01] SESSION  list/select/open/close/watch",
                         id="m-ses")
            yield Button("[02] CASH  count + print + fix", id="m-cash")
            yield Button("[03] SETORAN  GAS dashboard (5 days)", id="m-set")
            yield Button("[04] PC ADMIN  status/log/watcher/port/pin/wipe/off",
                         id="m-pc")
            yield Button("[00] EXIT", id="m-exit")
            yield Static(foot)
            yield Footer()

        def on_button_pressed(self, ev):
            bid = (ev.button.id or "")
            if bid == "m-exit":
                self.app.exit(0)
            elif bid == "m-ses":
                self.app.push_screen(SesScreen())
            elif bid == "m-cash":
                self.app.push_screen(CashScreen())
            elif bid == "m-set":
                self.app.push_screen(SetoranScreen())
            elif bid == "m-pc":
                self.app.push_screen(PcScreen())

    class SesScreen(Screen):
        BINDINGS = [("q", "pop_screen", "Back"), ("escape", "pop_screen", "Back")]

        def compose(self) -> ComposeResult:
            yield Static("-- SESSION (*=open !=incomplete, pick number) --")
            yield ListView(id="ses-list")
            yield LoadingIndicator(id="ses-load")
            yield Static("", id="ses-msg")
            yield Button("New session", id="s-new")
            yield Button("Close active", id="s-close")
            yield Button("Refresh", id="s-ref")
            yield Button("[00] BACK", id="s-back")
            yield Footer()

        def on_mount(self):
            self.query_one("#ses-load", LoadingIndicator).display = False
            self.refresh_list()

        def refresh_list(self):
            lv = self.query_one("#ses-list", ListView)
            lv.clear()
            self._rows = []
            if _store is None:
                self.query_one("#ses-msg", Static).update("store missing")
                return
            try:
                conn = _store.open_db()
                try:
                    rows = list(_store.list_sessions(conn, 50))
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
            except Exception as exc:
                self.query_one("#ses-msg", Static).update("load: %s" % exc)
                return
            self._rows = rows
            for i, s in enumerate(rows, 1):
                try:
                    mark = "*" if s["status"] == "open" else " "
                    flag = " !" if not s["complete"] else ""
                    lv.append(ListItem(Static("[%d]%s %s%s" % (
                        i, mark, s["id"], flag))))
                except Exception:
                    continue
            if not rows:
                self.query_one("#ses-msg", Static).update("no sessions yet")

        def on_button_pressed(self, ev):
            bid = ev.button.id or ""
            if bid == "s-back":
                self.app.pop_screen()
            elif bid == "s-ref":
                self.refresh_list()
            elif bid == "s-new":
                self.new_session()
            elif bid == "s-close":
                self.close_active()

        def new_session(self):
            if _store is None:
                return
            base = _saved_base()
            if not base:
                self.query_one("#ses-msg", Static).update(
                    "run cncli connect <base_url> first")
                return
            try:
                conn = _store.open_db()
                s = _store.create_session(conn, base)
                sid = s["id"]
                try:
                    conn.close()
                except Exception:
                    pass
            except Exception as exc:
                self.query_one("#ses-msg", Static).update("new: %s" % exc)
                return
            self.app.push_screen(WatchScreen(sid, base))

        def close_active(self):
            if _store is None:
                return
            try:
                conn = _store.open_db()
                try:
                    rows = list(_store.list_sessions(conn, 50))
                    act = next((r for r in rows if r["status"] == "open"), None)
                    if act is None:
                        self.query_one("#ses-msg", Static).update("no open session")
                        return
                    _store.close_session(conn, act["id"], bool(act["complete"]))
                    self.query_one("#ses-msg", Static).update("closed %s" % act["id"])
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
            except Exception as exc:
                self.query_one("#ses-msg", Static).update("close: %s" % exc)
                return
            self.refresh_list()

        def on_list_view_selected(self, ev):
            try:
                idx = self.query_one("#ses-list", ListView).index
            except Exception:
                return
            try:
                picked = self._rows[idx]
            except Exception:
                return
            base = picked["base_url"] or _saved_base()
            if _store is not None:
                try:
                    conn = _store.open_db()
                    try:
                        _store.patch_session(conn, picked["id"],
                                             {"status": "open", "closed_at": None})
                    finally:
                        try:
                            conn.close()
                        except Exception:
                            pass
                except Exception:
                    pass
            self.app.push_screen(WatchScreen(picked["id"], base))

    class WatchScreen(Screen):
        BINDINGS = [("q", "pop_screen", "Stop"), ("escape", "pop_screen", "Stop")]

        def __init__(self, sid, base, interval=2):
            super().__init__()
            self.sid = sid
            self.base = base
            self.interval = interval or 2
            self._timer = None

        def compose(self) -> ComposeResult:
            yield Static("-- WATCH %s (q stops, session stays open) --" % self.sid)
            yield LoadingIndicator(id="w-load")
            yield Static("contacting PC...", id="w-tot")
            yield Button("Stop (session stays open)", id="w-stop")
            yield Footer()

        def on_mount(self):
            self.run_worker(self._poll(True))

        def on_unmount(self):
            try:
                if self._timer is not None:
                    self._timer.stop()
            except Exception:
                pass

        async def _poll(self, first=False):
            if _store is None or _lan is None:
                self.query_one("#w-tot", Static).update("backend missing")
                self.query_one("#w-load", LoadingIndicator).display = False
                return
            try:
                conn = _store.open_db()
            except Exception as exc:
                self.query_one("#w-tot", Static).update("db: %s" % exc)
                self.query_one("#w-load", LoadingIndicator).display = False
                return
            try:
                from cncli.cli import _drain
                ok, err = await asyncio.to_thread(_drain, conn, self.sid, self.base)
                total, cash, noncash = _store.session_totals(conn, self.sid)
                tag = "" if ok else " -- incomplete: %s" % err
                self.query_one("#w-tot", Static).update(
                    "tx total %s (cash %s, non-cash %s)%s" % (
                        _rp(total), _rp(cash), _rp(noncash), tag))
            except Exception as exc:
                try:
                    self.query_one("#w-tot", Static).update("watch: %s" % exc)
                except Exception:
                    pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
            self.query_one("#w-load", LoadingIndicator).display = False
            if first:
                try:
                    self._timer = self.set_interval(self.interval, self._tick)
                except Exception:
                    pass

        async def _tick(self):
            await self._poll(False)

        def on_button_pressed(self, ev):
            self.app.pop_screen()

    class CashScreen(Screen):
        BINDINGS = [("q", "pop_screen", "Back"), ("escape", "pop_screen", "Back")]

        def __init__(self):
            super().__init__()
            self.qty = {}
            self.idx = 0
            try:
                from cncli import cash as _c
                self.denoms = list(_c.DENOMS)
            except Exception:
                self.denoms = [100000, 50000, 20000, 10000, 5000, 2000, 1000]

        def compose(self) -> ComposeResult:
            yield Static("-- CASH stepper (Back keeps inputs, Clear wipes) --")
            yield Static("", id="c-live")
            yield Static("", id="c-denom")
            yield Static("", id="c-sub")
            yield Input(placeholder="qty, e.g. 5", id="c-qty")
            yield LoadingIndicator(id="c-load")
            yield Static("", id="c-msg")
            yield Button("Back", id="c-back")
            yield Button("Next", id="c-next")
            yield Button("Preview", id="c-prev")
            yield Button("Send to printer", id="c-send")
            yield Button("Clear", id="c-clear")
            yield Button("[00] BACK", id="c-exit")
            yield Footer()

        def on_mount(self):
            self.query_one("#c-load", LoadingIndicator).display = False
            self.paint()

        def fisik(self):
            return sum(d * self.qty.get(d, 0) for d in self.denoms)

        def paint(self):
            try:
                d = self.denoms[self.idx]
            except Exception:
                d = 0
            q = self.qty.get(d, 0)
            try:
                inp = self.query_one("#c-qty", Input)
                if str(inp.value or "") != str(q if q else ""):
                    inp.value = str(q if q else "")
            except Exception:
                pass
            self.query_one("#c-sub", Static).update(
                "%s x %d = %s" % (_rp(d).replace("Rp ", ""), q, _rp(d * q)))
            self.query_one("#c-denom", Static).update(
                "denom %d/%d: %s" % (self.idx + 1, len(self.denoms), _rp(d)))
            self.live_totals()

        def live_totals(self):
            pc_cash = pc_non = 0
            if _store is not None:
                try:
                    _, pc_cash, pc_non = _store.session_totals()
                except Exception:
                    pass
            fisik = self.fisik()
            self.query_one("#c-live", Static).update(
                "fisik %s | PC cash %s non %s | diff %s" % (
                    _rp(fisik), _rp(pc_cash), _rp(pc_non), _rp(fisik - pc_cash)))

        def on_input_changed(self, ev):
            if (ev.input.id or "") != "c-qty":
                return
            try:
                d = self.denoms[self.idx]
            except Exception:
                return
            raw = "".join(ch for ch in (ev.value or "") if ch.isdigit())
            try:
                self.qty[d] = max(0, int(raw or 0))
                if self.qty[d] == 0:
                    self.qty.pop(d, None)
            except Exception:
                pass
            self.paint()

        def payload(self):
            from cncli import cash as _c
            noncash, meta = 0, {}
            if _store is not None:
                try:
                    _, _, noncash = _store.session_totals()
                    conn = _store.open_db()
                    try:
                        for k in ("kasir", "kasir_id", "cabang", "shift", "size"):
                            meta[k] = _store.get_meta(conn, k)
                    finally:
                        try:
                            conn.close()
                        except Exception:
                            pass
                except Exception:
                    pass
            return _c.build_payload(
                dict(self.qty), kasir=meta.get("kasir", ""),
                branch=meta.get("cabang", ""), shift=meta.get("shift", ""),
                user_id=meta.get("kasir_id", "-"), noncash=noncash,
                size=meta.get("size", "58"), base=_saved_base())

        def on_button_pressed(self, ev):
            bid = ev.button.id or ""
            if bid == "c-exit":
                self.app.pop_screen()
            elif bid == "c-back":
                self.idx = (self.idx - 1) % len(self.denoms)
                self.paint()
            elif bid == "c-next":
                self.idx = (self.idx + 1) % len(self.denoms)
                self.paint()
            elif bid == "c-clear":
                self.qty = {}
                self.idx = 0
                self.query_one("#c-msg", Static).update("cleared")
                self.paint()
            elif bid == "c-prev":
                self.run_worker(self._preview())
            elif bid == "c-send":
                self.run_worker(self._send())

        async def _preview(self):
            try:
                from cncli import cash as _c
                p = await asyncio.to_thread(self.payload)
                lines = _c.preview_receipt(p, 32)
                self.query_one("#c-msg", Static).update("\n".join(lines))
            except Exception as exc:
                self.query_one("#c-msg", Static).update("preview: %s" % exc)

        async def _send(self):
            if _lan is None:
                self.query_one("#c-msg", Static).update("lan missing")
                return
            self.query_one("#c-load", LoadingIndicator).display = True
            try:
                from cncli import cash as _c
                p = await asyncio.to_thread(self.payload)
                err = _c.validate_send(p)
                if err:
                    self.query_one("#c-msg", Static).update("cannot print: %s" % err)
                    return
                r = await asyncio.to_thread(
                    _lan.send_print, p["base"], {
                        k: p[k] for k in ("kasir", "branch", "shift", "user_id",
                                          "qty", "expense_amount", "expense_note",
                                          "nontunai_amount", "size")})
                if r.get("ok"):
                    self.query_one("#c-msg", Static).update("printed")
                else:
                    self.query_one("#c-msg", Static).update("failed: %s" % r.get("error"))
            except Exception as exc:
                self.query_one("#c-msg", Static).update("send: %s" % exc)
            finally:
                self.query_one("#c-load", LoadingIndicator).display = False

    class ConflictScreen(Screen):
        def __init__(self, _local=None, gas=None, on_pick=None):
            super().__init__()
            self._local = _local or {}
            self._gas = gas or {}
            self._cb = on_pick

        def compose(self) -> ComposeResult:
            yield Static("-- KONFLIK: pick one, Esc dismiss (non-blocking) --")
            yield Static("lokal: %s" % self._local)
            yield Static("gas: %s" % self._gas)
            yield Button("pakai lokal", id="k-lokal")
            yield Button("pakai gas", id="k-gas")
            yield Button("tutup", id="k-tutup")

        def on_button_pressed(self, ev):
            pick = {"k-lokal": "local", "k-gas": "gas"}.get(ev.button.id or "", "close")
            cb = self._cb
            self.app.pop_screen()
            if cb is not None:
                try:
                    cb(pick)
                except Exception:
                    pass

    class SetoranScreen(Screen):
        BINDINGS = [("q", "pop_screen", "Back"), ("escape", "pop_screen", "Back")]

        def compose(self) -> ComposeResult:
            yield Static("-- SETORAN (cache first, background sync) --")
            yield LoadingIndicator(id="g-load")
            yield Static("--", id="g-status")
            yield Static("", id="g-sum")
            yield ListView(id="g-list")
            yield Button("Refresh", id="g-ref")
            yield Button("[00] BACK", id="g-back")
            yield Footer()

        def on_mount(self):
            self.paint_cache("loading cache...")
            self.run_worker(self._sync())

        def paint_cache(self, status):
            self.query_one("#g-status", Static).update(status)
            if _store is None:
                return
            try:
                email, _ = _store.load_creds()
                if not email:
                    self.query_one("#g-sum", Static).update("no GAS login saved")
                    return
                conn = _store.open_db()
                try:
                    cached = _store.load_setoran_cache(conn, email)
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
                if cached:
                    self.paint_rows(cached, "OFFLINE: baca cache")
            except Exception as exc:
                self.query_one("#g-sum", Static).update("cache: %s" % exc)

        def paint_rows(self, rows, status):
            from cncli import gas as _g
            kurang, lebih = _g.summarize(rows)
            self.query_one("#g-status", Static).update(status)
            self.query_one("#g-sum", Static).update(
                "tx %d | short %s | over %s" % (
                    len(rows), _rp(kurang), _rp(lebih)))
            lv = self.query_one("#g-list", ListView)
            lv.clear()
            for r in (rows or [])[:5]:
                try:
                    lv.append(ListItem(Static("- %s | %s | %s" % (
                        (r or {}).get("tanggal", "?"), (r or {}).get("shift", "?"),
                        _rp((r or {}).get("jumlahSelisih", 0))))))
                except Exception:
                    continue

        def on_button_pressed(self, ev):
            if (ev.button.id or "") in ("g-back",):
                self.app.pop_screen()
            elif (ev.button.id or "") == "g-ref":
                self.query_one("#g-load", LoadingIndicator).display = True
                self.run_worker(self._sync())

        async def _sync(self):
            if _gas is None or _store is None:
                self.query_one("#g-status", Static).update("backend missing")
                self.query_one("#g-load", LoadingIndicator).display = False
                return
            try:
                email, pw = await asyncio.to_thread(_store.load_creds)
                if not email or not pw:
                    self.query_one("#g-status", Static).update("no GAS login")
                    self.query_one("#g-load", LoadingIndicator).display = False
                    return
                self.query_one("#g-status", Static).update("SYNC...")
                auth = await asyncio.to_thread(_gas.login, email, pw)
                if not auth.get("success"):
                    self.paint_cache("ERR: %s" % auth.get("message"))
                    self.query_one("#g-load", LoadingIndicator).display = False
                    return
                dash = await asyncio.to_thread(
                    _gas.get_dashboard_data, auth["token"])
                if not dash.get("success"):
                    self.paint_cache("ERR: %s" % dash.get("message"))
                    self.query_one("#g-load", LoadingIndicator).display = False
                    return
                rows = dash["data"] or []
                conn = _store.open_db()
                try:
                    cached = _store.load_setoran_cache(conn, email)
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
                if cached != rows and cached:
                    self.paint_rows(cached, "CONF: cache vs GAS differs")
                    self.query_one("#g-load", LoadingIndicator).display = False
                    self.app.push_screen(ConflictScreen(
                        {"rows": len(cached)}, {"rows": len(rows)},
                        lambda pick: self._resolve(email, rows, pick)))
                    return
                conn = _store.open_db()
                try:
                    _store.save_setoran_cache(conn, email, rows)
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
                self.paint_rows(rows, "OK")
            except Exception as exc:
                try:
                    self.query_one("#g-status", Static).update("ERR: %s" % exc)
                except Exception:
                    pass
            finally:
                try:
                    self.query_one("#g-load", LoadingIndicator).display = False
                except Exception:
                    pass

        def _resolve(self, email, rows, pick):
            if pick == "gas":
                try:
                    conn = _store.open_db()
                    try:
                        _store.save_setoran_cache(conn, email, rows)
                    finally:
                        try:
                            conn.close()
                        except Exception:
                            pass
                except Exception:
                    pass
                self.paint_rows(rows, "OK: saved GAS version")
            elif pick == "local":
                self.query_one("#g-status", Static).update("OK: kept local cache")
            else:
                self.query_one("#g-status", Static).update("dismissed (non-blocking)")

    class PcScreen(Screen):
        BINDINGS = [("q", "pop_screen", "Back"), ("escape", "pop_screen", "Back")]

        def compose(self) -> ComposeResult:
            yield Static("-- PC ADMIN (PIN hidden, never stored) --")
            yield LoadingIndicator(id="p-load")
            yield Static("", id="p-out")
            yield Button("1 status", id="p-status")
            yield Button("2 log", id="p-log")
            yield Button("3 watcher on/off", id="p-watch")
            yield Button("4 port", id="p-port")
            yield Button("5 change PIN", id="p-pin")
            yield Button("6 WIPE", id="p-wipe")
            yield Button("7 shutdown", id="p-off")
            yield Input(placeholder="PIN (hidden)", password=True, id="p-pin-in")
            yield Input(placeholder="arg: tail/port/new/HAPUS/YES", id="p-arg")
            yield Button("[00] BACK", id="p-back")
            yield Footer()

        def on_mount(self):
            self.query_one("#p-load", LoadingIndicator).display = False

        def _pin_arg(self):
            try:
                pin = (self.query_one("#p-pin-in", Input).value or "").strip()
            except Exception:
                pin = ""
            try:
                arg = (self.query_one("#p-arg", Input).value or "").strip()
            except Exception:
                arg = ""
            return (pin, arg)

        def on_button_pressed(self, ev):
            bid = ev.button.id or ""
            if bid == "p-back":
                self.app.pop_screen()
            elif bid == "p-status":
                self.run_worker(self._do("status"))
            elif bid == "p-log":
                self.run_worker(self._do("log"))
            elif bid == "p-watch":
                self.run_worker(self._do("watcher"))
            elif bid == "p-port":
                self.run_worker(self._do("port"))
            elif bid == "p-pin":
                self.run_worker(self._do("pin"))
            elif bid == "p-wipe":
                self.run_worker(self._do("wipe"))
            elif bid == "p-off":
                self.run_worker(self._do("off"))

        async def _do(self, what):
            if _lan is None:
                self.query_one("#p-out", Static).update("lan missing")
                return
            base = _saved_base()
            if not base:
                self.query_one("#p-out", Static).update("run cncli connect first")
                return
            pin, arg = self._pin_arg()
            self.query_one("#p-load", LoadingIndicator).display = True
            try:
                if what == "status":
                    r = await asyncio.to_thread(_lan.status_get, base)
                    d = r.get("data") or {}
                    self.query_one("#p-out", Static).update(
                        "version %s watcher %s today %s" % (
                            d.get("version", "?"),
                            d.get("watcher_enabled", "?"), d.get("count_today", "?"))
                        if r.get("ok") else "error: %s" % r.get("error"))
                    return
                if not pin:
                    self.query_one("#p-out", Static).update("cancelled: empty PIN")
                    return
                if what == "log":
                    try:
                        tail = int(arg or 200)
                    except Exception:
                        tail = 200
                    r = await asyncio.to_thread(_lan.log_get, base, pin, tail)
                    lines = ((r.get("data") or {}).get("lines", []) if r.get("ok")
                             else ["error: %s" % r.get("error")])
                    self.query_one("#p-out", Static).update("\n".join(lines[-20:]))
                elif what == "watcher":
                    cur = await asyncio.to_thread(_lan.watcher_get, base)
                    want = "off" if ((cur.get("data") or {}).get("enabled")) else "on"
                    if arg.lower() in ("on", "off"):
                        want = arg.lower()
                    r = await asyncio.to_thread(
                        _lan.watcher_set, base, pin, want == "on")
                    self.query_one("#p-out", Static).update(
                        "watcher: %s" % ("on" if (r.get("data") or {}).get("enabled")
                                         else r.get("error")))
                elif what == "port":
                    r = await asyncio.to_thread(_lan.port_set, base, pin, arg)
                    self.query_one("#p-out", Static).update(
                        "port: %s" % ((r.get("data") or {}).get("port") or r.get("error")))
                elif what == "pin":
                    r = await asyncio.to_thread(_lan.pin_set, base, pin, arg)
                    self.query_one("#p-out", Static).update(
                        "pin: %s" % ("ok" if r.get("ok") else r.get("error")))
                elif what == "wipe":
                    if arg != "HAPUS":
                        self.query_one("#p-out", Static).update("type HAPUS in arg box")
                        return
                    r = await asyncio.to_thread(_lan.wipe, base, pin, "HAPUS")
                    self.query_one("#p-out", Static).update(
                        "wipe: %s" % ("ok" if r.get("ok") else r.get("error")))
                elif what == "off":
                    if arg != "YES":
                        self.query_one("#p-out", Static).update("type YES in arg box")
                        return
                    r = await asyncio.to_thread(_lan.shutdown, base, pin)
                    self.query_one("#p-out", Static).update(
                        "shutdown: %s" % ("ok" if r.get("ok") else r.get("error")))
            except Exception as exc:
                self.query_one("#p-out", Static).update("%s: %s" % (what, exc))
            finally:
                self.query_one("#p-load", LoadingIndicator).display = False

    class CncliApp(App):
        CSS = "Screen { align: center top; } Button { width: 100%; }"
        BINDINGS = [("q", "quit_action", "Quit")]

        def on_mount(self):
            self.push_screen(MenuScreen())

        def compose(self) -> ComposeResult:
            yield Vertical()

        def action_quit_action(self):
            try:
                if len(self.screen_stack) > 1:
                    self.pop_screen()
                else:
                    self.exit(0)
            except Exception:
                self.exit(0)

    CncliApp().run()
    return 0


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
    """Try full-TUI on TTY with textual, else plain fallback. Never hangs."""
    try:
        if sys.stdin.isatty() and sys.stdout.isatty() and _textual_available():
            try:
                return run_textual()
            except Exception as exc:
                print("tui fallback: %s" % exc)
    except Exception:
        pass
    try:
        if sys.stdin.isatty():
            return plain_main()
    except Exception:
        pass
    print("error: menu needs an interactive TTY")
    return 2
