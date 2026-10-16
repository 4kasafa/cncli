"""Bundled banners: opencode-style block + compact + plain. Stdlib only."""

# ponytail: pre-rendered strings, no figlet/textual import here.
# FULL for wide (>=40 cols), COMPACT reuses legacy 30-col figlet,
# PLAIN for NO_COLOR/narrow/non-TTY. Textual adds markup on top.
BANNER = "\n".join([
    "  ____ _   _ ____ _     ___",
    " / ___| \\ | / ___| |   |_ _|",
    " | |   |  \\| | |   | |    | |",
    " | |___| |\\  | |___| |___ | |",
    "  \\____|_| \\_|\\____|_____|___|",
])

BANNER_PLAIN = "CNCLI"

BANNER_COMPACT = BANNER

# opencode-like block wordmark, two-tone + drop shadow in markup variant.
# Raw stays <=38 cols so it fits 40+ screens without wrap.
BANNER_FULL_RAW = "\n".join([
    " █████ █   █ █████ █     █",
    " █     ██  █ █     █     █",
    " █     █ █ █ █     █     █",
    " █████ █  ██ █████ █████ █",
])

FOOTER_HINT = "01-04 select - 00 back - q stop - arrows+Enter - Ctrl+C exit"


def _markup_two_tone(raw):
    # ponytail: one markup pass, no gradient dep; NO_COLOR strips it anyway.
    lines = []
    for ln in raw.splitlines():
        if not ln.strip():
            lines.append(ln)
            continue
        half = len(ln) // 2
        lines.append("[dim cyan]%s[/][bold white]%s[/]" % (ln[:half], ln[half:]))
    return "\n".join(lines)


BANNER_FULL_MARKUP = _markup_two_tone(BANNER_FULL_RAW)


def pick_banner(width=80, no_color=False):
    """Return (text, use_markup). Narrow/NO_COLOR -> plain, never wraps."""
    try:
        w = int(width or 80)
    except (TypeError, ValueError):
        w = 80
    if no_color or w < 40:
        if w < 30:
            return (BANNER_PLAIN, False)
        return (BANNER_COMPACT, False)
    return (BANNER_FULL_MARKUP, True)
