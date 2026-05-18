# CLAUDE.md

Project guidance for Claude Code when working in this repository.

## What this is

Thurbox v2 — TypeScript + Ink rewrite of the multi-session Claude
Code TUI orchestrator. Sessions persist in a dedicated tmux server
(`tmux -L thurbox`); the TUI renders them via xterm-headless inside
Ink components.

The design center is **the developer's edit/run cycle**. A change
to any file under `src/ui/` must repaint a running thurbox in under
a second, with sessions intact. The hot-reload boundary is the
daemon/ui split; the daemon never restarts.

## Stack

- Runtime: **Bun 1.3+** (we use `bun --hot`, `bun build --compile`)
- TUI: **Ink 5** (React renderer for terminals) + **React 18**
- Terminal emulation: **xterm-headless**
- PTY: **node-pty** (used only to talk to tmux control mode)
- Storage: **better-sqlite3** (sync API, WAL mode, multi-instance
  via `PRAGMA data_version` polling)
- MCP: **@modelcontextprotocol/sdk**, stdio transport only
- State: **Zustand** (TEA-style store + pure reducers)
- Lint/format: **Biome** (single tool, replaces eslint/prettier)
- Tests: **Vitest** + **ink-testing-library**

## Commands

```bash
bun install                # install deps
bun run dev                # bun --hot run src/index.tsx
bun run start              # one-shot run, no watch
bun run build              # bun build --compile → dist/thurbox
bun run typecheck          # tsc --noEmit (strict)
bun run lint               # biome check .
bun run lint:fix           # biome check --write .
bun test                   # vitest run
bun run test:watch         # vitest --watch
```

## Module layout (target — fills in as milestones land)

```text
src/
  index.tsx                # ink render(<App/>)
  daemon/                  # long-lived; NOT reloaded on hot save
    db.ts                  # better-sqlite3 + migrations
    backends/
      SessionBackend.ts    # interface
      LocalTmuxBackend.ts  # tmux -L thurbox
      registry.ts
    tmux.ts                # tmux -CC control mode client
    sessions.ts            # reader/writer loops + vt100 state
    mcp-stdio.ts           # embedded MCP server (deferred)
    git.ts                 # worktree create/sync
    paths.ts
  store.ts                 # Zustand + reducers (App model)
  ui/                      # reloads via Bun --hot + React Fast Refresh
    App.tsx
    SessionList.tsx
    Terminal.tsx
    InfoPanel.tsx
    FileViewer.tsx
    StatusBar.tsx
    modals/
    themes.ts
    keys.ts
    links.ts
    selection.ts
    fuzzy.ts
```

## Architecture rules

- **TEA via Zustand.** `Event → AppAction → reducer → store →
  Ink re-render`. No ad-hoc event handlers. No component-local
  mutable state beyond useState for view-only concerns.
- **Daemon vs UI split is the hot-reload boundary.** Anything
  mutable that must survive a hot reload lives in `src/daemon/` or
  in the Zustand store. Never put PTY handles, DB handles, or
  long-lived sockets inside React components.
- **No `any`.** Biome warns on `noExplicitAny`; treat as error in
  PR review.
- **Crash-free operation.** Errors surface in the status bar, not
  via `throw` from the React tree. Wrap async daemon calls; the UI
  only renders typed `AppState`.
- **Logging off stdout.** Anything written to stdout corrupts the
  TUI. Use a file logger (added in M4); never `console.log`.

## What we deliberately do NOT ship (pi.dev cuts from v1)

- VM backend (use thurbox inside a VM)
- Container backend (use thurbox inside a container)
- Plugin runtime (use shell scripts + MCP)
- Profiles (use a shell alias / 3-line script)
- Scheduled commands (`sleep N && tmux send-keys ...`)
- HTTP MCP transport (use SSH-forwarded stdio)
- Settings overlay (`Ctrl+E`) — Admin session edits everything
  conversationally

If a PR adds a feature that fits one of those patterns, push back.

## Native-module notes

`node-pty` and `better-sqlite3` are listed under
`optionalDependencies` so a workspace bootstrap doesn't fail if the
build environment lacks gyp. Bun usually picks prebuilt binaries.
If a build fails on your machine, install platform deps and re-run
`bun install --force`.

## Commit style

Conventional commits (cocogitto-compatible): `feat:`, `fix:`,
`refactor:`, `docs:`, `chore:`, `test:`, `ci:`, `perf:`. Scopes:
`ui`, `daemon`, `mcp`, `git`, `deps`, `docs`, `config`.

## Reference

- The v1 Rust codebase remains at `Thurbeen/thurbox` and is **not
  touched** by this rewrite. It is the reference for any feature
  spec; the cuts above are intentional, not oversights.
