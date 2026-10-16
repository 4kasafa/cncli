"""Bundled ASCII banner (figlet-style, static, zero runtime dependency)."""

# ponytail: pre-rendered block, max 30 cols for small Termux screens.
# Never shell out to `figlet`; keep stdlib-only install.
BANNER = "\n".join([
    "  ____ _   _ ____ _     ___",
    " / ___| \\ | / ___| |   |_ _|",
    " | |   |  \\| | |   | |    | |",
    " | |___| |\\  | |___| |___ | |",
    "  \\____|_| \\_|\\____|_____|___|",
])
