/**
 * Per-session terminal emulator: feeds bytes from a `SpawnedSession.output`
 * into xterm-headless, exposes a row-by-row snapshot the UI can render.
 *
 * The shape mirrors v1's `vt100::Parser` + `tui_term::PseudoTerminal` pair:
 * the parser owns the cell grid; the UI asks for a snapshot per frame and
 * renders.
 */

// xterm-headless evaluates `window` at module load time. Node has no
// `window` global; we shim it before requiring xterm. We must use `require`
// (not `import`) so the shim runs as a statement *before* xterm is loaded
// — ES module imports hoist above statements.
// biome-ignore lint/suspicious/noExplicitAny: shimming a browser global onto Node
if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = globalThis;

import { createRequire } from 'node:module';
import type { Terminal as XtermTerminal } from 'xterm-headless';
const _require = createRequire(import.meta.url);
const xtermHeadless: typeof import('xterm-headless') = _require('xterm-headless');
const { Terminal } = xtermHeadless;
import type { SpawnedSession } from './backends/SessionBackend.ts';

/** A run of cells that share styling — emitted as one `<Text>` in Ink. */
export interface CellRun {
  /** Visible text of the run. */
  text: string;
  /** Resolved foreground (Ink color name or `#rrggbb`), or undefined for default. */
  color?: string;
  /** Resolved background, or undefined for default. */
  backgroundColor?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  dim: boolean;
}

/** One screen row, broken into styled runs. */
export interface Row {
  runs: CellRun[];
}

/** Full visible-region snapshot. */
export interface Snapshot {
  rows: Row[];
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
}

/**
 * xterm color-mode flag values. xterm packs the mode into the high bits of
 * a 32-bit attrs word; `getFgColorMode()` returns the masked value. The
 * docstring in `IBufferCell` doesn't spell these out, so we discovered them
 * empirically (see scripts/probe-cell.ts).
 */
const COLOR_MODE_DEFAULT = 0;
const COLOR_MODE_PALETTE16 = 0x01000000;
const COLOR_MODE_PALETTE256 = 0x02000000;
const COLOR_MODE_RGB = 0x03000000;

/**
 * The 16 standard ANSI palette colors as Ink-compatible names. Ink resolves
 * named colors through its own theme so terminals display them correctly
 * regardless of user palette.
 */
const PALETTE_16: readonly string[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray', // bright black
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
];

/**
 * Convert an xterm color (mode + number) into an Ink-friendly color spec.
 * Returns `undefined` for the default-color sentinel so Ink falls back to
 * the terminal's default fg/bg.
 */
function resolveColor(mode: number, value: number): string | undefined {
  if (mode === COLOR_MODE_DEFAULT) return undefined;
  if (mode === COLOR_MODE_PALETTE16) {
    return PALETTE_16[value & 0x0f];
  }
  if (mode === COLOR_MODE_PALETTE256) {
    // The first 16 are the standard palette; the rest get hex from the
    // standard 256-color table (6x6x6 cube + grayscale ramp).
    if (value < 16) return PALETTE_16[value];
    if (value < 232) {
      const idx = value - 16;
      const r = Math.floor(idx / 36) % 6;
      const g = Math.floor(idx / 6) % 6;
      const b = idx % 6;
      const ramp = [0, 95, 135, 175, 215, 255];
      return rgbHex(ramp[r] ?? 0, ramp[g] ?? 0, ramp[b] ?? 0);
    }
    // 232..255 grayscale ramp (8, 18, 28, ..., 238)
    const gray = 8 + (value - 232) * 10;
    return rgbHex(gray, gray, gray);
  }
  if (mode === COLOR_MODE_RGB) {
    const r = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    return rgbHex(r, g, b);
  }
  return undefined;
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

function hex2(n: number): string {
  return (n & 0xff).toString(16).padStart(2, '0');
}

/** Read one cell into a lightweight style descriptor. */
interface CellStyle {
  fg: string | undefined;
  bg: string | undefined;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  dim: boolean;
}

function styleEquals(a: CellStyle, b: CellStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.dim === b.dim
  );
}

/**
 * Owns one xterm-headless Terminal instance and exposes feed/snapshot.
 */
export class PaneTerminal {
  private readonly term: XtermTerminal;
  private readerTask: Promise<void> | null = null;
  private stopRequested = false;

  constructor(rows: number, cols: number) {
    this.term = new Terminal({
      rows,
      cols,
      scrollback: 5000,
      allowProposedApi: true,
    });
  }

  /** Feed raw bytes from the backend into the emulator. */
  write(chunk: Uint8Array): void {
    this.term.write(chunk);
  }

  /**
   * Feed bytes and resolve once the parser has fully processed them. Useful
   * for tests and for the "force redraw after adopt" path where we need the
   * grid to be up-to-date before snapshotting.
   */
  writeSync(chunk: Uint8Array | string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.term.write(chunk, () => resolve());
    });
  }

  /** Run a background reader loop that pulls from `output` until exhausted. */
  attach(output: AsyncIterable<Uint8Array>): void {
    if (this.readerTask) return;
    this.readerTask = (async () => {
      for await (const chunk of output) {
        if (this.stopRequested) break;
        this.write(chunk);
      }
    })();
  }

  /** Stop the reader loop (the iterator drains independently). */
  detach(): void {
    this.stopRequested = true;
  }

  /** Forward a host resize down to the emulator. */
  resize(rows: number, cols: number): void {
    this.term.resize(cols, rows);
  }

  dispose(): void {
    this.detach();
    this.term.dispose();
  }

  /** Take a snapshot of the visible viewport, packed into styled runs per row. */
  snapshot(): Snapshot {
    const buf = this.term.buffer.active;
    const rows: Row[] = [];
    const visibleRows = this.term.rows;
    const cols = this.term.cols;

    for (let y = 0; y < visibleRows; y++) {
      // `viewportY` is 0 at the top of the visible region; absolute Y is
      // `baseY + viewportY`, but xterm's `buffer.active.getLine(line)` takes
      // an absolute index. We want the visible viewport, so start at the
      // current viewport top.
      const absY = buf.viewportY + y;
      const line = buf.getLine(absY);
      if (!line) {
        rows.push({ runs: [] });
        continue;
      }

      const runs: CellRun[] = [];
      let runText = '';
      let runStyle: CellStyle | null = null;
      const cell = line.getCell(0);
      if (!cell) {
        rows.push({ runs: [] });
        continue;
      }

      for (let x = 0; x < cols; x++) {
        const c = line.getCell(x, cell);
        if (!c) continue;
        // Skip the second half of wide characters (width = 0).
        if (c.getWidth() === 0) continue;
        const chars = c.getChars() || ' ';
        const style: CellStyle = {
          fg: resolveColor(c.getFgColorMode(), c.getFgColor()),
          bg: resolveColor(c.getBgColorMode(), c.getBgColor()),
          bold: c.isBold() !== 0,
          italic: c.isItalic() !== 0,
          underline: c.isUnderline() !== 0,
          inverse: c.isInverse() !== 0,
          dim: c.isDim() !== 0,
        };

        if (runStyle === null) {
          runStyle = style;
          runText = chars;
        } else if (styleEquals(runStyle, style)) {
          runText += chars;
        } else {
          runs.push(makeRun(runText, runStyle));
          runStyle = style;
          runText = chars;
        }
      }

      if (runStyle !== null && runText.length > 0) {
        runs.push(makeRun(runText, runStyle));
      }
      rows.push({ runs });
    }

    return {
      rows,
      cursorX: buf.cursorX,
      cursorY: buf.cursorY,
      // xterm-headless does not surface a cursor-visible flag directly; the
      // TUI will hide the cursor when the user has scrolled into history.
      // Always visible for now; M6 wires the scrolled-up check.
      cursorVisible: true,
    };
  }
}

function makeRun(text: string, style: CellStyle): CellRun {
  return {
    text,
    color: style.fg,
    backgroundColor: style.bg,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    inverse: style.inverse,
    dim: style.dim,
  };
}

/** Wire a fresh PaneTerminal to a spawned session. Convenience helper. */
export function attachPane(session: SpawnedSession, rows: number, cols: number): PaneTerminal {
  const pane = new PaneTerminal(rows, cols);
  pane.attach(session.output);
  return pane;
}
