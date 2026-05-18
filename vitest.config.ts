import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // xterm-headless references `window` for its TaskQueue's
    // `requestIdleCallback` fallback. Node 24 has no `window` global, so we
    // give it `globalThis` — that's enough to satisfy the reference; xterm
    // falls back to `setTimeout` for scheduling, which works headless.
    setupFiles: ['./tests/setup.ts'],
    // better-sqlite3 is a native CJS module; Vite's transformer can't bundle
    // it. Externalize so Vitest uses Node's resolver to load the .node file.
    server: {
      deps: {
        external: ['better-sqlite3'],
      },
    },
  },
});
