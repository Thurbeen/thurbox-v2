import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // xterm-headless references `window` for its TaskQueue's
    // `requestIdleCallback` fallback. Node 24 has no `window` global, so we
    // give it `globalThis` — that's enough to satisfy the reference; xterm
    // falls back to `setTimeout` for scheduling, which works headless.
    setupFiles: ['./tests/setup.ts'],
  },
});
