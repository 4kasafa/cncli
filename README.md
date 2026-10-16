# cncli

Termux-first CLI for **CNdesktop LAN + GAS setoran**. Stdlib only (no heavy deps).
Bare `cncli` opens a hacking-tool style interactive menu; flags stay scriptable.

> Status v020: all backends live — store (SQLite) + lan (10s) + gas (20s),
> 18 commands + interactive menu + `--json`. See [`CLI-FLOW.md`](CLI-FLOW.md) §F.

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
cncli                    # interactive banner + menu (TTY only)
cncli menu               # same menu, explicit
cncli connect http://192.168.1.5:8765   # save PC address (one WiFi, port 8765)
cncli status             # check PC health (needs connect first)
cncli --help             # all commands
```

Menu map (all inside `cncli`):

| Key | Group | Does |
|-----|-------|------|
| 01 | SESSION | list/select/open/close/watch sessions (2s poll) |
| 02 | CASH | count denominations (`100k*5,50k*2`), diff vs PC, optional print |
| 03 | SETORAN | GAS dashboard, 5 days, conflict asks local/gas |
| 04 | PC ADMIN | status/log/watcher/port/pin/wipe/off |
| 00 | EXIT | back one level / quit (`Ctrl+C` also quits) |

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
