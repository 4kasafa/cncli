# cncli

Termux-first CLI for **CNdesktop LAN + GAS setoran**. React OpenTUI menu
(`tui/`, node/bun) with plain wizard fallback for pipe/`--json` or when the
TUI runtime is missing. Bare `cncli` opens the menu on a TTY; flags stay scriptable.

> Status v040: 8 commands (`connect/status/ses/watch/count/fix/setoran/pc`)
> + 18 old names as hidden aliases + React TUI + `--json`.
> See [`CLI-FLOW.md`](CLI-FLOW.md) §F-§G.

## Install (Termux)

```sh
pkg install python git nodejs-lts   # node >= 26.4, or: pkg install bun
git clone https://github.com/4kasafa/cncli && cd cncli
pip install -e .
cd tui && npm install && cd ..      # once; bun users run src/ directly
cncli
```

QR scan (optional): Termux:API app + `pkg install termux-api zbar`, then `termux-setup-storage`.

Update later: `cd cncli && git pull`. Node users also run `cd tui && npm run build`.

## Install (Windows dev)

```powershell
git clone https://github.com/4kasafa/cncli; Set-Location cncli
python -m pip install -e .
cd tui; npm install; npm run build; cd ..   # or: bun src/index.tsx (dev)
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

Menu map (the React TUI inside `cncli`) — ranger-style root page, `enter/l`
open, `esc/h` back, `q` quit:

| Key | View | Does |
|-----|------|------|
| 1 / s | Live | open/close/resume session, pulls tx every 2s, fill missing (!), fix rows, history |
| 2 / p | Print | 11 denominations (digits type straight in), expense + note, 58/80 receipt preview, send to PC printer |
| 3 / c | Computers | PC list + status, add/edit forms, control page: watcher/log/wipe (PIN on demand) |
| 4 / d | Deposits | GAS sign-in, archive cache-first, conflict diff page local/gas, account |
| ? | help | full help page (`1-4` or `s p c d` jump anywhere) |

Plain fallback (no node/bun runtime, or pipe): `01 SESSION` / `02 CASH` /
`03 SETORAN` / `04 PC ADMIN` wizards with `00` back.
Rules: PIN is always via hidden prompt, never `--pin`
(keeps it out of shell history). `WIPE` needs typed `HAPUS`,
shutdown needs typed `YES`. Data lives in `~/.cncli/`
(config + SQLite + chmod-600 credentials; TUI state under `~/.cncli/tui/`).

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
