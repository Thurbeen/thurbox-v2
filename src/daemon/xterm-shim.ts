/**
 * xterm-headless evaluates `window` at module load time inside its TaskQueue
 * (it looks for `window.requestIdleCallback` and falls back to `setTimeout`
 * when missing). Node has no `window`, so we alias `window` to `globalThis`
 * — that's enough for the reference to be safe; the `requestIdleCallback`
 * branch is never taken since `globalThis.requestIdleCallback` is undefined.
 *
 * This file MUST be imported before `xterm-headless`. ES module imports
 * hoist above other statements within the same file, so we put the shim in
 * its own module and import it first.
 */
// biome-ignore lint/suspicious/noExplicitAny: shimming a browser global onto Node
if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = globalThis;
