import { describe, expect, it } from 'bun:test';
import { PaneTerminal } from '../src/daemon/terminal.ts';

const enc = new TextEncoder();

function bytes(s: string): Uint8Array {
  return enc.encode(s);
}

describe('PaneTerminal.snapshot', () => {
  it('captures plain ASCII into a single default-styled run per row', async () => {
    const t = new PaneTerminal(3, 10);
    await t.writeSync(bytes('hello'));
    const snap = t.snapshot();
    expect(snap.rows).toHaveLength(3);
    const row0 = snap.rows[0];
    // The first run holds "hello" with default styling.
    expect(row0?.runs[0]?.text.startsWith('hello')).toBe(true);
    expect(row0?.runs[0]?.color).toBeUndefined();
    expect(row0?.runs[0]?.bold).toBe(false);
    t.dispose();
  });

  it('breaks runs at color changes', async () => {
    const t = new PaneTerminal(2, 20);
    // red "AB", default "CD"
    await t.writeSync(bytes('\x1b[31mAB\x1b[0mCD'));
    const snap = t.snapshot();
    const row0 = snap.rows[0];
    // Find the first non-empty styled run with text "AB".
    const ab = row0?.runs.find((r) => r.text.startsWith('AB'));
    expect(ab?.color).toBe('red');
    const cd = row0?.runs.find((r) => r.text.startsWith('CD'));
    expect(cd?.color).toBeUndefined();
    t.dispose();
  });

  it('decodes 256-color palette into hex', async () => {
    const t = new PaneTerminal(2, 10);
    // 256-color: index 196 is bright red in the 6x6x6 cube
    await t.writeSync(bytes('\x1b[38;5;196mX\x1b[0m'));
    const snap = t.snapshot();
    const x = snap.rows[0]?.runs.find((r) => r.text.startsWith('X'));
    expect(x?.color).toMatch(/^#[0-9a-f]{6}$/);
    t.dispose();
  });

  it('decodes truecolor RGB sequences', async () => {
    const t = new PaneTerminal(2, 10);
    // 24-bit color: pure orange
    await t.writeSync(bytes('\x1b[38;2;255;165;0mY\x1b[0m'));
    const snap = t.snapshot();
    const y = snap.rows[0]?.runs.find((r) => r.text.startsWith('Y'));
    expect(y?.color).toBe('#ffa500');
    t.dispose();
  });

  it('marks bold and italic correctly', async () => {
    const t = new PaneTerminal(2, 10);
    await t.writeSync(bytes('\x1b[1mB\x1b[0m\x1b[3mI\x1b[0m'));
    const snap = t.snapshot();
    const b = snap.rows[0]?.runs.find((r) => r.text.startsWith('B'));
    const i = snap.rows[0]?.runs.find((r) => r.text.startsWith('I'));
    expect(b?.bold).toBe(true);
    expect(i?.italic).toBe(true);
    t.dispose();
  });

  it('handles CRLF and writes to subsequent rows', async () => {
    const t = new PaneTerminal(3, 10);
    await t.writeSync(bytes('a\r\nb\r\nc'));
    const snap = t.snapshot();
    expect(snap.rows[0]?.runs[0]?.text.startsWith('a')).toBe(true);
    expect(snap.rows[1]?.runs[0]?.text.startsWith('b')).toBe(true);
    expect(snap.rows[2]?.runs[0]?.text.startsWith('c')).toBe(true);
    t.dispose();
  });

  it('reports cursor position', async () => {
    const t = new PaneTerminal(3, 10);
    await t.writeSync(bytes('hi'));
    const snap = t.snapshot();
    expect(snap.cursorX).toBe(2);
    expect(snap.cursorY).toBe(0);
    t.dispose();
  });
});
