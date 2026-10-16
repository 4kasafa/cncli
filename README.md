# cncli

Termux-first CLI for **CNdesktop LAN + GAS setoran**. Textual full-TUI
(opencode-style block banner) with plain fallback for pipe/`--json`.
Bare `cncli` opens the interactive menu on a TTY; flags stay scriptable.

> Status v030: 8 commands (`connect/status/ses/watch/count/fix/setoran/pc`)
> + 18 old names as hidden aliases + Textual TUI + `--json`.
> See [`CLI-FLOW.md`](CLI-FLOW.md) §F-§G.

## Install (Termux)

```sh
pkg install python git
git clone https://github.com/4kasafa/cncli && cd cncli
pip install -e .
cncli
```

Update later: `cd cncli && git pull`.

## Install (Windows dev)

```powershell
git clone https://github.com/4kasafa/cncli; Set-Location cncli
python -m pip install -e .
python -m cncli --help
```

## Usage

```text
cncli                    # full-TUI banner + menu (TTY only)
cncli menu               # same menu, explicit (TTY only)
cncli connect http://192.168.1.5:8765   # save PC address (one WiFi, port 8765)
cncli status             # check PC health (needs connect first)
cncli ses                # all sessions (*=open !=incomplete, --new/--close)
cncli watch --once       # live view once (default polls 2s, q stops)
cncli count 100k*5,50k*2 --print  # stepper in TUI, one-shot in CLI
cncli fix 42 --tunai 50000 --nontunai 0  # edit id or fill missing number
cncli setoran            # GAS dashboard cache-first, conflict local/gas
cncli pc status          # all PC admin behind one door
cncli --help             # all commands (8 + hidden aliases)
cncli -v                 # install check (prints version)
```

Menu map (all inside `cncli`):

| Key | Group | Does |
|-----|-------|------|
| 01 | SESSION | ses list (*=open), number resumes+watch, new/close inline |
| 02 | CASH | stepper per denom (Back keeps input), live diff, preview 32-col, send |
| 03 | SETORAN | cache-first auto sync, offline banner, conflict local/gas sheet |
| 04 | PC ADMIN | pc status/log/watcher/port/pin/wipe/off, loaders everywhere |
| 00 | EXIT | back one level / quit (`q` stops watch, `Ctrl+C` also quits) |

Rules: `00` goes back. PIN is always via hidden prompt, never `--pin`
(keeps it out of shell history). `WIPE` needs typed `HAPUS`,
shutdown needs typed `YES`. Data lives in `~/.cncli/`
(config + SQLite + chmod-600 credentials).

## Examples

```text
$ cncli connect http://192.168.1.5:8765
saved http://192.168.1.5:8765

$ cncli                 # pick 02, then:
denominations: 100k*5,50k*2,10k*10
physical total: Rp 700000
print recap to PC printer? [y/N]: y
[= cncli count '100k*5,50k*2,10k*10' --print]
```

Every menu action prints its `[= cncli ...]` equivalent so you can
learn the scriptable form. Full flows + design notes: [`CLI-FLOW.md`](CLI-FLOW.md).
