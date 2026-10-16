"""cncli entry point. Bare `cncli` on a TTY opens the interactive menu."""

import argparse
import getpass
import os
import sys
import time

from cncli import __version__
from cncli import out as _out

ALIASES = {"st": ["status"], "conn": ["connect"], "hist": ["history"]}


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


def cmd_start(args):
    from cncli import lan, store
    del lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
    conn = store.open_db()
    if args.resume:
        s = store.get_session(conn, args.resume)
        if s is None:
            print("error: unknown session %s" % args.resume)
            return 1
        store.patch_session(conn, args.resume,
                            {"status": "open", "closed_at": None})
        sid = args.resume
    else:
        h = __import__("cncli.lan", fromlist=["health"]).health(base)
        s = store.create_session(conn, base)
        if not h["ok"]:
            store.patch_session(conn, s["id"], {"complete": 0})
        sid = s["id"]
    print("session %s" % sid)
    ok, err = _drain(conn, sid, base)
    if not ok:
        print("drain incomplete: %s" % err)
    interval = args.interval or 2
    try:
        while True:
            ok, err = _drain(conn, sid, base)
            total, cash, noncash = store.session_totals(conn, sid)
            print("tx total Rp %d (cash Rp %d, non-cash Rp %d)%s"
                  % (total, cash, noncash,
                     "" if ok else " -- incomplete: %s" % err))
            time.sleep(interval)
    except KeyboardInterrupt:
        print("watch stopped, session %s still open" % sid)
    return 0


def cmd_live(args):
    from cncli import store
    conn = store.open_db()
    rows = [dict(s) for s in store.list_sessions(conn, 50)
            if s["status"] == "open"]
    _out.emit(rows, args.json)
    return 0


def cmd_stop(args):
    from cncli import store
    conn = store.open_db()
    s = _active_session(conn, args.session)
    if s is None:
        print("error: no open session")
        return 1
    store.close_session(conn, s["id"], bool(s["complete"]))
    _out.emit({"closed": s["id"]}, args.json)
    return 0


def cmd_history(args):
    from cncli import store
    conn = store.open_db()
    rows = []
    for s in store.list_sessions(conn, 50):
        d = dict(s)
        if not s["complete"]:
            d["flag"] = "incomplete"
        rows.append(d)
    _out.emit(rows, args.json)
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


def cmd_calculate(args):
    args.print = False
    return run_count(args)


def cmd_print(args):
    args.print = True
    return run_count(args, force_send=True)


def cmd_edit(args):
    from cncli import store
    conn = store.open_db()
    s = _active_session(conn, args.session)
    if s is None:
        print("error: no open session (use --session ID)")
        return 1
    row = store.patch_tx(conn, s["id"], args.server_id,
                         args.tunai, args.nontunai)
    if row is None:
        print("error: bad id or negative amount")
        return 1
    _out.emit(dict(row), args.json)
    return 0


def cmd_fill(args):
    from cncli import store
    conn = store.open_db()
    s = _active_session(conn, args.session)
    if s is None:
        print("error: no open session (use --session ID)")
        return 1
    if "|" not in (args.key or ""):
        print('error: key format is DAY|N, e.g. 2026-10-16|12')
        return 2
    day, _, num = args.key.rpartition("|")
    row = store.upsert_fill(conn, s["id"], day, num,
                            args.tunai, args.nontunai)
    if row is None:
        print("error: bad key or negative amount")
        return 1
    _out.emit(dict(row), args.json)
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


def cmd_watcher(args):
    from cncli import lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
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


def cmd_log(args):
    from cncli import lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
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


def cmd_port(args):
    from cncli import lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
    pin = _pin(args)
    if pin is None:
        return 2
    r = lan.port_set(base, pin, args.set)
    if not r["ok"]:
        print("error: %s" % r.get("error"))
        return 1
    _out.emit(r["data"] or {}, args.json)
    return 0


def cmd_pin(args):
    from cncli import lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
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


def cmd_wipe(args):
    from cncli import lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
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


def cmd_shutdown(args):
    from cncli import lan
    base = _saved_base()
    if not base:
        print("no PC saved (run `cncli connect <base_url>`)")
        return 2
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


def build_parser():
    parser = argparse.ArgumentParser(
        prog="cncli",
        description="CNcli v%s: Termux CLI for CNdesktop LAN + GAS setoran. "
                    "No args on a TTY opens the interactive menu." % __version__,
    )
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

    p = sub.add_parser("start", help="open session and watch live")
    p.add_argument("--resume", metavar="ID",
                   help="reopen a closed session instead of a new one")
    p.add_argument("--interval", type=int, default=2,
                   help="poll seconds (default 2)")
    p.set_defaults(func=cmd_start)
    p = sub.add_parser("live", help="list open sessions")
    p.set_defaults(func=cmd_live)
    p = sub.add_parser("stop", help="close the active session")
    p.add_argument("--session", metavar="ID", help="session id (default active)")
    p.set_defaults(func=cmd_stop)
    p = sub.add_parser("history", help="list all sessions")
    p.set_defaults(func=cmd_history)

    for name, help_text in (
            ("calculate", "count drawer denominations vs session"),
            ("print", "count then send recap to the PC printer")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("spec", nargs="?",
                       help="e.g. 100k*5,50k*2 (asks when empty on TTY)")
        p.add_argument("--session", metavar="ID", help="session id (default active)")
        p.add_argument("--expense", type=int, default=0, help="expense amount")
        p.add_argument("--note", default="", help="expense note")
        p.add_argument("--preview", dest="preview", action="store_true",
                       help="show 32-col receipt preview")
        p.add_argument("--no-preview", dest="preview", action="store_false",
                       help="skip receipt preview")
        p.set_defaults(func=cmd_calculate if name == "calculate"
                       else cmd_print, print=False)
    p = sub.add_parser("edit", help="correct a transaction locally")
    p.add_argument("server_id", type=int, help="transaction server id")
    p.add_argument("--tunai", type=int, required=True)
    p.add_argument("--nontunai", type=int, required=True)
    p.add_argument("--session", metavar="ID", help="session id (default active)")
    p.set_defaults(func=cmd_edit)
    p = sub.add_parser("fill", help="fill a missing HILANG number locally")
    p.add_argument("key", help="DAY|N, e.g. 2026-10-16|12")
    p.add_argument("--tunai", type=int, required=True)
    p.add_argument("--nontunai", type=int, required=True)
    p.add_argument("--session", metavar="ID", help="session id (default active)")
    p.set_defaults(func=cmd_fill)

    p = sub.add_parser("setoran", help="GAS dashboard, auto login")
    p.add_argument("--prefer", choices=("local", "gas"),
                   help="conflict pick for scripts")
    p.add_argument("--save-login", action="store_true",
                   help="store GAS email+password (chmod 600)")
    p.add_argument("--forget", action="store_true", help="delete stored login")
    p.set_defaults(func=cmd_setoran)

    p = sub.add_parser("watcher", help="show or switch the PC watcher")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--on", action="store_true")
    g.add_argument("--off", action="store_true")
    p.add_argument("--pin", help="PIN (else hidden prompt on TTY)")
    p.set_defaults(func=cmd_watcher)
    p = sub.add_parser("log", help="tail the PC log")
    p.add_argument("--tail", type=int, default=200)
    p.add_argument("--pin", help="PIN (else hidden prompt on TTY)")
    p.set_defaults(func=cmd_log)
    p = sub.add_parser("port", help="change the PC port")
    p.add_argument("--set", type=int, required=True, metavar="PORT")
    p.add_argument("--pin", help="PIN (else hidden prompt on TTY)")
    p.set_defaults(func=cmd_port)
    p = sub.add_parser("pin", help="change the PC PIN")
    p.add_argument("--new", required=True, metavar="NEW_PIN")
    p.add_argument("--pin", help="current PIN (else hidden prompt on TTY)")
    p.set_defaults(func=cmd_pin)
    p = sub.add_parser("wipe", help="wipe PC data (no undo)")
    p.add_argument("--confirm", default="",
                   help="must be exactly HAPUS")
    p.add_argument("--pin", help="PIN (else hidden prompt on TTY)")
    p.set_defaults(func=cmd_wipe)
    p = sub.add_parser("shutdown", help="stop the PC connector")
    p.add_argument("--yes", action="store_true", help="required confirmation")
    p.add_argument("--pin", help="PIN (else hidden prompt on TTY)")
    p.set_defaults(func=cmd_shutdown)

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
