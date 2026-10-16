"""cncli entry point. Bare `cncli` on a TTY opens the interactive menu."""

import argparse
import os
import sys

from cncli import __version__


def _config_path():
    home = os.path.expanduser("~")
    return os.path.join(home, ".cncli", "config")


def cmd_connect(args):
    base = (args.base_url or "").strip().rstrip("/")
    if not base.startswith("http"):
        print("error: base_url must start with http(s), e.g. http://192.168.1.5:8765",
              file=sys.stderr)
        return 2
    path = _config_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(base + "\n")
    except OSError as exc:
        print("error: cannot save config: %s" % exc, file=sys.stderr)
        return 1
    print("saved %s" % base)
    print("hint: run `cncli status` to verify the PC, or bare `cncli` for the menu.")
    return 0


def cmd_status(_args):
    try:
        from cncli import lan as lan_mod
    except Exception:
        lan_mod = None
    if lan_mod is None:
        print("status backend not wired yet (store milestone).")
        print("saved PC: ", end="")
        try:
            with open(_config_path(), encoding="utf-8") as fh:
                print(fh.read().strip() or "--")
        except OSError:
            print("-- (run `cncli connect <base_url>`)")
        return 2
    return lan_mod.status_main()


def cmd_menu(_args):
    from cncli import tui
    return tui.main()


def build_parser():
    parser = argparse.ArgumentParser(
        prog="cncli",
        description="CNcli v%s: Termux CLI for CNdesktop LAN + GAS setoran. "
                    "No args on a TTY opens the interactive menu." % __version__,
    )
    sub = parser.add_subparsers(dest="cmd", metavar="<command>")
    p_menu = sub.add_parser("menu", help="open interactive banner + menu")
    p_menu.set_defaults(func=cmd_menu)
    p_status = sub.add_parser("status", help="check PC health (needs connect first)")
    p_status.set_defaults(func=cmd_status)
    p_conn = sub.add_parser("connect", help="save PC base_url, e.g. http://IP:8765")
    p_conn.add_argument("base_url", help="PC base URL including port")
    p_conn.set_defaults(func=cmd_connect)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "cmd", None) is None:
        if sys.stdin.isatty():
            from cncli import tui
            return tui.main()
        parser.print_help()
        return 0
    return args.func(args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
