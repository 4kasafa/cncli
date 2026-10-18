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

`1/s` setoran · `2/l` live · `3/p` print · `4/c` comp · `?` help · `^C` quit.

## Test

```sh
npm test    # node --test test/*.test.ts (tests run against dist/, build first)
```

Pure-logic tests cover store (sessions/tx/fills), txmerge gap chains, conflict
merge/resolve, and receipt width/validation; UI compiles under `npm run build`.
