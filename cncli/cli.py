"""cncli entry point. Bare `cncli` on a TTY opens the interactive menu."""

import argparse
import getpass
import os
import sys
import time

from cncli import __version__
from cncli import out as _out

ALIASES = {
    "st": ["status"], "conn": ["connect"], "hist": ["ses", "--all"],
    # ponytail: 18-plan names stay as hidden aliases to the 8-command core.
    "start": ["ses", "--new", "--watch"],
    "live": ["ses", "--open"],
    "history": ["ses", "--all"],
    "calculate": ["count"],
    "print": ["count", "--print"],
    "edit": ["fix"], "fill": ["fix"],
    "watcher": ["pc", "watcher"], "log": ["pc", "log"],
    "port": ["pc", "port"], "pin": ["pc", "pin"],
    "wipe": ["pc", "wipe"], "shutdown": ["pc", "off"],
    "stop": ["ses", "--close"],
}


def _config_path():
    home = os.path.expanduser("~")
    return os.path.join(home, ".cncli", "config")


def _saved_base():
    try:
        with open(_config_path(), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _pin(args):
    if getattr(args, "pin", None):
        print("warning: --pin is visible in shell history, "
              "prefer the interactive prompt", file=sys.stderr)
        return args.pin
    try:
        if sys.stdin.isatty():
            return getpass.getpass("PIN (hidden): ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
    print("error: PIN required (--pin or interactive prompt)")
    return None


def _active_session(conn, session_id=None):
    from cncli import store
    if session_id:
        s = store.get_session(conn, session_id)
        if s is None:
            return None
        return s
    rows = store.list_sessions(conn, 50)
    for s in rows:
        if s["status"] == "open":
            return s
    return None


def cmd_connect(args):
    base = (args.base_url or "").strip().rstrip("/")
    if not base.startswith("http"):
        print("error: base_url must start with http(s), "
              "e.g. http://192.168.1.5:8765", file=sys.stderr)
        return 2
    path = _config_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(base + "\n")
    except OSError as exc:
        print("error: cannot save config: %s" % exc, file=sys.stderr)
        return 1
    _out.emit({"saved": base}, args.json)
    return 0


def cmd_status(args):
    from cncli import lan as lan_mod
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
    r = lan_mod.status_get(base)
    if not r["ok"]:
        print("error: %s" % r["error"])
        return 1
    _out.emit(r["data"] or {}, args.json)
    return 0


def cmd_menu(args):
    # ponytail: TUI only on TTY; pipe/json stays plain, never hangs.
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("error: menu needs an interactive TTY (pipe detected)")
        return 2
    from cncli import tui
    del args
    return tui.main()


def _drain(conn, sid, base):
    from cncli import lan, store
    for _ in range(200):
        last = store.get_last_seen(conn, sid)
        r = lan.fetch_tx(base, last, 50)
        if not r["ok"]:
            store.patch_session(conn, sid, {"complete": 0})
            return False, r["error"]
        if r["rows"]:
            store.upsert_tx(conn, sid, r["rows"])
        if len(r["rows"]) < 50:
            return True, ""
    return True, ""


def open_and_watch(conn, sid, base, interval=2):
    """Drain then poll a session. Ctrl+C stops watch, session stays open."""
    from cncli import lan, store
    ok, err = _drain(conn, sid, base)
    if not ok:
        print("drain incomplete: %s" % err)
    try:
        while True:
            ok, err = _drain(conn, sid, base)
            total, cash, noncash = store.session_totals(conn, sid)
            print("tx total Rp %d (cash Rp %d, non-cash Rp %d)%s"
                  % (total, cash, noncash,
                     "" if ok else " -- incomplete: %s" % err))
            time.sleep(interval or 2)
    except KeyboardInterrupt:
        print("watch stopped, session %s still open" % sid)
    return 0


def _read_spec(args):
    if args.spec:
        return args.spec
    if sys.stdin.isatty():
        try:
            return input("denominations (e.g. 100k*5,50k*2): ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return ""
    print("error: denominations required as argument")
    return None


def run_count(args, force_send=False):
    from cncli import cash, lan, store
    spec = _read_spec(args)
    if spec is None:
        return 2
    try:
        qty = cash.qty_from_spec(spec)
    except ValueError:
        print("error: bad denomination")
        return 2
    conn = store.open_db()
    s = _active_session(conn, args.session)
    if s is None:
        print("error: no open session (use --session ID)")
        return 1
    total, cash_amt, noncash = store.session_totals(conn, s["id"])
    meta = {k: store.get_meta(conn, k)
            for k in ("kasir", "kasir_id", "cabang", "shift", "size")}
    payload = cash.build_payload(
        qty, kasir=meta["kasir"], branch=meta["cabang"],
        shift=meta["shift"], user_id=meta["kasir_id"] or "-",
        expense=args.expense or 0, note=args.note or "",
        noncash=noncash, size=meta["size"] or "58",
        base=_saved_base())
    result = {"physical": payload["fisik"], "pc_cash": cash_amt,
              "pc_noncash": noncash, "diff": payload["fisik"] - cash_amt}
    send = force_send or args.print
    if send or args.preview:
        for line in cash.preview_receipt(payload):
            print(line)
    if not send:
        _out.emit(result, args.json)
        return 0
    err = cash.validate_send(payload)
    if err:
        print("error: %s" % err)
        return 1
    r = lan.send_print(payload["base"], {
        k: payload[k] for k in ("kasir", "branch", "shift", "user_id",
                                "qty", "expense_amount", "expense_note",
                                "nontunai_amount", "size")})
    if not r.get("ok"):
        print("error: %s" % r.get("error"))
        return 1
    result["printed_at"] = (r.get("data") or {}).get("printer") or "printer"
    _out.emit(result, args.json)
    return 0


def cmd_setoran(args):
    from cncli import gas, store
    if args.forget:
        _out.emit({"forgotten": store.forget_creds()}, args.json)
        return 0
    if args.save_login:
        try:
            email = input("GAS email: ").strip()
            pw = getpass.getpass("GAS password (hidden): ")
        except (EOFError, KeyboardInterrupt):
            print()
            return 130
        if not email or not pw:
            print("error: email and password required")
            return 2
        store.save_creds(email, pw)
        _out.emit({"saved_login": email}, args.json)
        return 0
    return gas.interactive_dashboard(prefer=args.prefer)


def cmd_meta(args):
    from cncli import store
    conn = store.open_db()
    given = {k: v for k, v in
             (("kasir", args.kasir), ("kasir_id", args.id_kasir),
              ("cabang", args.cabang), ("shift", args.shift))
             if v}
    if args.show or not given:
        _out.emit({k: store.get_meta(conn, k)
                   for k in ("kasir", "kasir_id", "cabang", "shift")},
                  args.json)
        return 0
    for k, v in given.items():
        store.set_meta(conn, k, v)
    _out.emit({"saved": sorted(given)}, args.json)
    return 0


def _ses_mark(s):
    mark = "*" if s["status"] == "open" else " "
    flag = " !" if not s["complete"] else ""
    return "[%s%s]" % (mark, flag)


def cmd_ses(args):
    """One list for all sessions (open+closed). Numbers picked in TUI."""
    from cncli import lan, store
    conn = store.open_db()
    try:
        if args.delete:
            s = store.get_session(conn, args.delete)
            if s is None:
                print("error: unknown session %s" % args.delete)
                return 1
            if s["status"] == "open":
                print("error: session %s is open (stop it first)" % args.delete)
                return 1
            store.delete_session(conn, args.delete)
            _out.emit({"deleted": args.delete}, args.json)
            return 0
        if args.close:
            s = _active_session(conn, args.session)
            if s is None:
                print("error: no open session")
                return 1
            store.close_session(conn, s["id"], bool(s["complete"]))
            _out.emit({"closed": s["id"]}, args.json)
            return 0
        if args.new or args.resume:
            base = _saved_base()
            if not base:
                print("no PC saved (run `cncli connect <base_url>`)")
                return 2
            if args.resume:
                s = store.get_session(conn, args.resume)
                if s is None:
                    print("error: unknown session %s" % args.resume)
                    return 1
                store.patch_session(conn, args.resume,
                                    {"status": "open", "closed_at": None})
                sid = args.resume
            else:
                h = lan.health(base)
                s = store.create_session(conn, base)
                if not h["ok"]:
                    store.patch_session(conn, s["id"], {"complete": 0})
                sid = s["id"]
            print("session %s" % sid)
            if args.watch:
                return open_and_watch(conn, sid, base, args.interval)
            _out.emit({"opened": sid}, args.json)
            return 0
        rows = list(store.list_sessions(conn, 50))
        if args.open:
            rows = [s for s in rows if s["status"] == "open"]
        out = []
        for s in rows:
            d = dict(s)
            if not s["complete"]:
                d["flag"] = "incomplete"
            out.append(d)
        if not args.json:
            if not rows:
                print("no sessions yet (cncli ses --new)")
                return 0
            for i, s in enumerate(rows, 1):
                print("[%d]%s %s" % (i, _ses_mark(s), s["id"]))
            if rows and any(s["status"] == "open" for s in rows):
                print("*=open !=incomplete")
            return 0
        _out.emit(out, True)
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass


def cmd_watch(args):
    """Live view of the active session. q/Ctrl+C stops, session stays open."""
    from cncli import lan, store
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
    conn = store.open_db()
    s = _active_session(conn, args.session)
    if s is None:
        print("error: no open session (use --session ID)")
        return 1
    ok, err = _drain(conn, s["id"], base)
    total, cash, noncash = store.session_totals(conn, s["id"])
    tag = "" if ok else " -- incomplete: %s" % err
    print("tx total Rp %d (cash Rp %d, non-cash Rp %d)%s"
          % (total, cash, noncash, tag))
    if args.once:
        return 0
    try:
        while True:
            time.sleep(args.interval or 2)
            ok, err = _drain(conn, s["id"], base)
            total, cash, noncash = store.session_totals(conn, s["id"])
            tag = "" if ok else " -- incomplete: %s" % err
            print("tx total Rp %d (cash Rp %d, non-cash Rp %d)%s"
                  % (total, cash, noncash, tag))
    except KeyboardInterrupt:
        print("watch stopped, session %s still open" % s["id"])
    return 0


def cmd_count(args):
    args.print = bool(getattr(args, "print", False))
    return run_count(args, force_send=args.print)


def cmd_fix(args):
    """Fix anything: existing id=edit, missing number=fill (active session)."""
    from cncli import store
    import datetime
    conn = store.open_db()
    s = _active_session(conn, args.session)
    if s is None:
        print("error: no open session (use --session ID)")
        return 1
    key = (args.key or "").strip()
    if "|" in key:
        day, _, num = key.rpartition("|")
        row = store.upsert_fill(conn, s["id"], day.strip(), num.strip(),
                                args.tunai, args.nontunai)
        if row is None:
            print("error: bad key or negative amount")
            return 1
        _out.emit(dict(row), args.json)
        return 0
    try:
        sid = int(key)
    except (TypeError, ValueError):
        print("error: key is server id or DAY|N, e.g. 42 or 2026-10-16|12")
        return 2
    row = store.patch_tx(conn, s["id"], sid, args.tunai, args.nontunai)
    if row is not None:
        _out.emit(dict(row), args.json)
        return 0
    day = datetime.date.today().isoformat()
    row = store.upsert_fill(conn, s["id"], day, sid,
                            args.tunai, args.nontunai)
    if row is None:
        print("error: bad id or negative amount")
        return 1
    print("created fill %s|%s" % (day, sid))
    _out.emit(dict(row), args.json)
    return 0


def cmd_pc(args):
    """Single door for PC admin. PIN via hidden prompt, never stored."""
    from cncli import lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
    sub = (args.sub or "").lower()
    if sub == "status":
        r = lan.status_get(base)
        if not r["ok"]:
            print("error: %s" % r["error"])
            return 1
        _out.emit(r["data"] or {}, args.json)
        return 0
    if sub == "log":
        pin = _pin(args)
        if pin is None:
            return 2
        r = lan.log_get(base, pin, args.tail)
        if not r["ok"]:
            print("error: %s" % r.get("error"))
            return 1
        data = r["data"] or {}
        _out.emit(data.get("lines", data), args.json)
        return 0
    if sub == "watcher":
        if args.on == args.off:
            r = lan.watcher_get(base)
            if not r["ok"]:
                print("error: %s" % r.get("error"))
                return 1
            _out.emit(r["data"] or {}, args.json)
            return 0
        pin = _pin(args)
        if pin is None:
            return 2
        r = lan.watcher_set(base, pin, bool(args.on))
        if not r["ok"]:
            print("error: %s" % r.get("error"))
            return 1
        _out.emit(r["data"] or {}, args.json)
        return 0
    if sub == "port":
        val = args.set if args.set else args.value
        try:
            val = int(val)
        except (TypeError, ValueError):
            print("error: port required, e.g. cncli pc port 8765")
            return 2
        pin = _pin(args)
        if pin is None:
            return 2
        r = lan.port_set(base, pin, val)
        if not r["ok"]:
            print("error: %s" % r.get("error"))
            return 1
        _out.emit(r["data"] or {}, args.json)
        return 0
    if sub == "pin":
        if not args.new:
            print("error: --new NEW_PIN required")
            return 2
        pin = _pin(args)
        if pin is None:
            return 2
        r = lan.pin_set(base, pin, args.new)
        if not r["ok"]:
            print("error: %s" % r.get("error"))
            return 1
        _out.emit(r["data"] or {}, args.json)
        return 0
    if sub == "wipe":
        pin = _pin(args)
        if pin is None:
            return 2
        if args.confirm != "HAPUS":
            print("error: type --confirm HAPUS to wipe (no undo)")
            return 2
        r = lan.wipe(base, pin, args.confirm)
        if not r["ok"]:
            print("error: %s" % r.get("error"))
            return 1
        _out.emit(r["data"] or {}, args.json)
        return 0
    if sub == "off":
        pin = _pin(args)
        if pin is None:
            return 2
        if not args.yes:
            print("error: pass --yes to shutdown the PC")
            return 2
        r = lan.shutdown(base, pin)
        if not r["ok"]:
            print("error: %s" % r.get("error"))
            return 1
        _out.emit(r["data"] or {}, args.json)
        return 0
    print("error: unknown pc target (status/log/watcher/port/pin/wipe/off)")
    return 2


def build_parser():
    parser = argparse.ArgumentParser(
        prog="cncli",
        description="CNcli v%s: Termux CLI for CNdesktop LAN + GAS setoran. "
                    "No args on a TTY opens the interactive menu." % __version__,
    )
    parser.add_argument("-v", "--version", action="version",
                        version="cncli " + __version__)
    parser.add_argument("--json", action="store_true",
                        help="machine-readable JSON output")
    sub = parser.add_subparsers(dest="cmd", metavar="<command>")

    p = sub.add_parser("menu", help="open interactive banner + menu")
    p.set_defaults(func=cmd_menu)
    p = sub.add_parser("status", help="check PC health (needs connect first)")
    p.set_defaults(func=cmd_status)
    p = sub.add_parser("connect", help="save PC base_url, e.g. http://IP:8765")
    p.add_argument("base_url", help="PC base URL including port")
    p.set_defaults(func=cmd_connect)

    # ponytail: old names run via ALIASES above, no parsers = hidden from help.

    p = sub.add_parser("setoran", help="GAS dashboard, auto login")
    p.add_argument("--prefer", choices=("local", "gas"),
                   help="conflict pick for scripts")
    p.add_argument("--save-login", action="store_true",
                   help="store GAS email+password (chmod 600)")
    p.add_argument("--forget", action="store_true", help="delete stored login")
    p.set_defaults(func=cmd_setoran)

    # ponytail: 8-command core (human path); 18 old names stay above/below.
    p = sub.add_parser("ses", help="all sessions, pick number to resume")
    p.add_argument("--open", action="store_true", help="open sessions only")
    p.add_argument("--all", action="store_true", help="all sessions")
    p.add_argument("--new", action="store_true", help="open a new session")
    p.add_argument("--close", action="store_true", help="close active session")
    p.add_argument("--watch", action="store_true", help="watch after new/resume")
    p.add_argument("--resume", metavar="ID", help="reopen a closed session")
    p.add_argument("--delete", metavar="ID", help="delete a closed session")
    p.add_argument("--session", metavar="ID", help="session id (default active)")
    p.add_argument("--interval", type=int, default=2, help="poll seconds")
    p.set_defaults(func=cmd_ses, open=False, all=False, new=False,
                   close=False, watch=False, resume=None, delete=None,
                   session=None, interval=2)
    p = sub.add_parser("watch", help="live view, q stops, session stays open")
    p.add_argument("--session", metavar="ID", help="session id (default active)")
    p.add_argument("--interval", type=int, default=2, help="poll seconds")
    p.add_argument("--once", action="store_true", help="show once, no poll")
    p.set_defaults(func=cmd_watch)
    p = sub.add_parser("count", help="count + optional print in one screen")
    p.add_argument("spec", nargs="?",
                   help="e.g. 100k*5,50k*2 (asks when empty on TTY)")
    p.add_argument("--session", metavar="ID", help="session id (default active)")
    p.add_argument("--expense", type=int, default=0, help="expense amount")
    p.add_argument("--note", default="", help="expense note")
    p.add_argument("--print", dest="print", action="store_true",
                   help="send recap to PC printer")
    p.add_argument("--preview", dest="preview", action="store_true",
                   help="show 32-col receipt preview")
    p.add_argument("--no-preview", dest="preview", action="store_false",
                   help="skip receipt preview")
    p.set_defaults(func=cmd_count, print=False, preview=True)
    p = sub.add_parser("fix", help="correct anything (edit or fill auto)")
    p.add_argument("key", help="server id or DAY|N, e.g. 42")
    p.add_argument("--tunai", type=int, required=True)
    p.add_argument("--nontunai", type=int, required=True)
    p.add_argument("--session", metavar="ID", help="session id (default active)")
    p.set_defaults(func=cmd_fix)
    p = sub.add_parser("pc", help="all PC admin in one door")
    p.add_argument("sub", help="status/log/watcher/port/pin/wipe/off")
    p.add_argument("value", nargs="?", help="port number for port sub")
    p.add_argument("--on", action="store_true")
    p.add_argument("--off", action="store_true")
    p.add_argument("--tail", type=int, default=200)
    p.add_argument("--set", type=int, default=0, metavar="PORT")
    p.add_argument("--new", default="", metavar="NEW_PIN")
    p.add_argument("--confirm", default="")
    p.add_argument("--yes", action="store_true")
    p.add_argument("--pin", help="PIN (else hidden prompt on TTY)")
    p.set_defaults(func=cmd_pc)

    p = sub.add_parser("meta", help="stored shop details for print")
    p.add_argument("--show", action="store_true")
    p.add_argument("--kasir")
    p.add_argument("--id-kasir")
    p.add_argument("--cabang")
    p.add_argument("--shift")
    p.set_defaults(func=cmd_meta)
    return parser


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ALIASES:
        argv = ALIASES[argv[0]] + argv[1:]
    json_flag = False
    if "--json" in argv:  # accept flag before or after the subcommand
        argv = [a for a in argv if a != "--json"]
        json_flag = True
    parser = build_parser()
    args = parser.parse_args(argv)
    args.json = args.json or json_flag
    if getattr(args, "cmd", None) is None:
        if sys.stdin.isatty():
            from cncli import tui
            return tui.main()
        parser.print_help()
        return 0
    return args.func(args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
