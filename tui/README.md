# cncli-tui

React OpenTUI app for `cncli` (Termux-first). TypeScript + `@opentui/react`,
imports aliased as `@opentui/core` / `@opentui/react` so the native Termux
build (`@androidtui/core-android-arm64`) installs via npm aliases.

## Requirements

- node >= 26.4 (`node --experimental-ffi`) **or** bun >= 1.3.14
- one-time: `npm install` in this folder
- node runtime also needs a build: `npm run build` (emits `dist/`)

## Run

```sh
bun src/index.tsx            # dev / Termux with bun
npm run build && npm start   # node --experimental-ffi dist/index.js
```

Bare `cncli` / `cncli menu` launches this automatically (node then bun, plain
wizard fallback). Override state dir with `CNCLI_TUI_DIR` (default
`~/.cncli/tui/`): sessions, tx, fills, creds, comps, archive, print-meta.

## Views

Ranger-style root page (logo + tagline `cash note cli | vX` + 4 boxes) →
views: `1/s` live · `2/p` print · `3/c` computers · `4/d` reports. Root
boxes show: session head + tx total + last tx, print kasir/cabang in two
lines, session computers with ip, last report (date/status, K/F totals,
sync time). Tall screens show every line; short screens collapse each box
to a single line. `enter`/`l` descend, `esc`/`h` ascend,
`q` quit, `?` help page. Hints cap at 4 keys per screen; layout is safe
at 40-60 cols (clipped single-line rows, boxes only on the root menu,
adaptive KPI grid).

## Test

```sh
npm test    # node --test test/*.test.ts (tests run against dist/, build first)
```

Pure-logic tests cover store (sessions/tx/fills), txmerge gap chains, conflict
merge/resolve, receipt width/validation, and root menu budget/lines; UI
compiles under `npm run build`.
