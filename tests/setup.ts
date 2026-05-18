// xterm-headless references `window` in its idle-callback scheduling. In
// Node 24 (Vitest's default env) there is no `window`. Aliasing to
// `globalThis` is enough — the code path only checks for the existence of
// `window.requestIdleCallback` and falls back to `setTimeout` when missing.
// biome-ignore lint/suspicious/noExplicitAny: shimming a browser global onto Node
(globalThis as any).window = globalThis;
