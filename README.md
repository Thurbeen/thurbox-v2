# thurbox v2

An agentic IDE and agent orchestrator for your terminal. Built on
Ink, hot-reloadable, tmux-persistent.

> Greenfield TypeScript rewrite of [thurbox](https://github.com/Thurbeen/thurbox).
> Same persistence model (sessions live in a dedicated tmux server),
> radically simpler core (pi.dev-style "primitives over features"),
> and a dev loop where editing a UI file repaints a running thurbox
> in under a second without losing sessions.

## Status

Pre-alpha. M1 (workspace bootstrap) landed; M2+ in progress.

## Prerequisites

- [Bun](https://bun.sh/) 1.3+ for development
- tmux 3.2+ (runtime; used from M2 onward)
- a recent Claude Code CLI (runtime; used from M2 onward)

End users will eventually download a single pre-compiled binary
(`bun build --compile`) and won't need Bun installed.

## Dev loop

```bash
bun install
bun run dev        # bun --hot run src/index.tsx
# Edit src/ui/App.tsx and save — the box repaints.
# Ctrl+Q to quit.
```

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Run with Bun's `--hot` (Fast Refresh) |
| `bun run start` | Run once, no watch |
| `bun run build` | Compile a static single-file binary into `dist/thurbox` |
| `bun run typecheck` | `tsc --noEmit` (strict mode) |
| `bun run lint` | Biome check (lint + format) |
| `bun run lint:fix` | Biome auto-fix |
| `bun test` | Vitest |

## License

MIT.
