/**
 * Translate Ink's `useInput` key events into raw bytes for the PTY.
 *
 * Ink gives us a structured `Key` object; the PTY wants raw bytes. xterm's
 * sequences are the canonical encoding (arrow keys → CSI A/B/C/D, function
 * keys → escape sequences, …). v1 did the same in src/agent/input.rs; this
 * is the JS port.
 */

import type { Key } from 'ink';

const enc = new TextEncoder();

/**
 * Return the bytes a PTY should receive for this key event, or null if the
 * key is consumed by the host (no forwarding).
 *
 * Caller decides whether to forward (terminal focus) or treat as a global
 * hotkey first.
 */
export function keyEventToBytes(input: string, key: Key): Uint8Array | null {
  if (key.escape) return new Uint8Array([0x1b]);
  if (key.return) return new Uint8Array([0x0d]); // CR — most shells expect this
  if (key.tab) return new Uint8Array([0x09]);
  if (key.backspace) return new Uint8Array([0x7f]);
  if (key.delete) return enc.encode('\x1b[3~');

  if (key.upArrow) return enc.encode('\x1b[A');
  if (key.downArrow) return enc.encode('\x1b[B');
  if (key.rightArrow) return enc.encode('\x1b[C');
  if (key.leftArrow) return enc.encode('\x1b[D');

  if (key.pageUp) return enc.encode('\x1b[5~');
  if (key.pageDown) return enc.encode('\x1b[6~');

  if (key.ctrl && input) {
    // Ctrl+<letter> = byte (letter & 0x1f). Ink lowercases the char.
    const code = input.charCodeAt(0);
    if (code >= 0x61 && code <= 0x7a) {
      return new Uint8Array([code & 0x1f]);
    }
  }

  if (key.meta && input) {
    // Alt/Meta + key → ESC followed by the key bytes.
    const out = new Uint8Array(1 + input.length);
    out[0] = 0x1b;
    out.set(enc.encode(input), 1);
    return out;
  }

  if (input && !key.ctrl && !key.meta) {
    return enc.encode(input);
  }

  return null;
}
