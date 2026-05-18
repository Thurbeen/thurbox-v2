/**
 * Tmux control-mode (`tmux -CC`) wire protocol.
 *
 * Pure parsing/encoding helpers. No I/O. Easy to unit-test.
 *
 * References:
 *  - tmux(1) — CONTROL MODE
 *  - thurbox v1: src/agent/control_mode.rs
 */

/** Discriminated union of notifications tmux emits on its control stream. */
export type Notification =
  | { kind: 'output'; paneId: string; data: Uint8Array }
  | { kind: 'begin' }
  | { kind: 'end' }
  | { kind: 'error' }
  | { kind: 'pause'; paneId: string }
  | { kind: 'other'; line: string };

/**
 * Decode tmux's `%output` octal escapes.
 *
 * `\NNN` (backslash followed by exactly three octal digits 0-7) becomes a
 * single byte with value NNN. Everything else passes through as its UTF-8
 * bytes. Tmux uses this so a single line of ASCII can carry arbitrary binary.
 */
export function decodeOctal(input: string): Uint8Array {
  const out: number[] = [];
  const bytes = new TextEncoder().encode(input);
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x5c /* \\ */ && i + 3 < bytes.length) {
      const d0 = bytes[i + 1] as number;
      const d1 = bytes[i + 2] as number;
      const d2 = bytes[i + 3] as number;
      if (isOctal(d0) && isOctal(d1) && isOctal(d2)) {
        const val = (d0 - 0x30) * 64 + (d1 - 0x30) * 8 + (d2 - 0x30);
        out.push(val & 0xff);
        i += 4;
        continue;
      }
    }
    out.push(b as number);
    i += 1;
  }
  return new Uint8Array(out);
}

function isOctal(b: number): boolean {
  return b >= 0x30 && b <= 0x37;
}

/**
 * Parse a single line from tmux's control-mode stream into a structured
 * notification.
 *
 * Lines that don't match a known prefix are returned as `Other` so the caller
 * can either treat them as command-response payload (between `%begin` and
 * `%end`) or log them.
 */
export function parseNotification(line: string): Notification {
  if (line.startsWith('%output ')) {
    // %output %<pane> <octal-encoded>
    const rest = line.slice('%output '.length);
    const sp = rest.indexOf(' ');
    if (sp >= 0) {
      return {
        kind: 'output',
        paneId: rest.slice(0, sp),
        data: decodeOctal(rest.slice(sp + 1)),
      };
    }
  }

  if (line.startsWith('%extended-output ')) {
    // %extended-output %<pane> <age> : <octal-encoded>
    const rest = line.slice('%extended-output '.length);
    const sep = rest.indexOf(' : ');
    if (sep >= 0) {
      const meta = rest.slice(0, sep);
      const data = decodeOctal(rest.slice(sep + 3));
      const sp = meta.indexOf(' ');
      if (sp >= 0) {
        return { kind: 'output', paneId: meta.slice(0, sp), data };
      }
    }
  }

  if (line.startsWith('%begin ')) return { kind: 'begin' };
  if (line.startsWith('%end ')) return { kind: 'end' };
  if (line.startsWith('%error ')) return { kind: 'error' };
  if (line.startsWith('%pause ')) {
    return { kind: 'pause', paneId: line.slice('%pause '.length).trim() };
  }

  return { kind: 'other', line };
}

/**
 * Format a `send-keys -t <pane> -H AA BB CC ...\n` command.
 *
 * Tmux's `-H` mode treats each space-separated token as a single byte expressed
 * in two hex digits. This is the only safe way to forward arbitrary bytes from
 * the TUI into the PTY: it bypasses shell escaping entirely.
 */
export function formatSendKeys(paneId: string, bytes: Uint8Array): string {
  let out = `send-keys -t ${paneId} -H`;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += ' ';
    out += (b >> 4).toString(16);
    out += (b & 0x0f).toString(16);
  }
  out += '\n';
  return out;
}

/**
 * Quote an arbitrary string for use as a single argument inside a tmux
 * command-string sent over control mode.
 *
 * Tmux parses command strings with its own quoting rules (close to /bin/sh).
 * We wrap in single quotes and escape embedded single quotes via the standard
 * `'\''` trick, which is safe for every byte.
 */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
