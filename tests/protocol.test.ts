/**
 * Golden-test the tmux control-mode parser against v1's known-good cases
 * (src/agent/control_mode.rs, mod tests).
 */
import { describe, expect, it } from 'bun:test';
import {
  decodeOctal,
  formatSendKeys,
  parseNotification,
  shellEscape,
} from '../src/daemon/tmux/protocol.ts';

describe('decodeOctal', () => {
  it('passes ASCII through unchanged', () => {
    expect(Array.from(decodeOctal('hello'))).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('decodes a single \\NNN octal escape', () => {
    // \033 = 0x1b (ESC)
    expect(Array.from(decodeOctal('\\033'))).toEqual([0x1b]);
  });

  it('decodes mixed ASCII + escapes', () => {
    // hello\033[1m
    expect(Array.from(decodeOctal('hello\\033[1m'))).toEqual([
      0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x1b, 0x5b, 0x31, 0x6d,
    ]);
  });

  it('leaves a trailing backslash alone if not followed by 3 octal digits', () => {
    expect(Array.from(decodeOctal('foo\\'))).toEqual([0x66, 0x6f, 0x6f, 0x5c]);
  });

  it('does not consume a backslash followed by non-octal chars', () => {
    expect(Array.from(decodeOctal('\\n'))).toEqual([0x5c, 0x6e]);
  });
});

describe('parseNotification', () => {
  it('parses %output', () => {
    const n = parseNotification('%output %42 hello\\033[1m');
    expect(n.kind).toBe('output');
    if (n.kind !== 'output') return;
    expect(n.paneId).toBe('%42');
    expect(Array.from(n.data)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x1b, 0x5b, 0x31, 0x6d]);
  });

  it('parses %extended-output', () => {
    const n = parseNotification('%extended-output %3 17 : hi');
    expect(n.kind).toBe('output');
    if (n.kind !== 'output') return;
    expect(n.paneId).toBe('%3');
    expect(Array.from(n.data)).toEqual([0x68, 0x69]);
  });

  it('parses %begin / %end / %error', () => {
    expect(parseNotification('%begin 1234 7 0').kind).toBe('begin');
    expect(parseNotification('%end 1234 7 0').kind).toBe('end');
    expect(parseNotification('%error 1234 7 0').kind).toBe('error');
  });

  it('parses %pause and captures the pane id', () => {
    const n = parseNotification('%pause %5');
    expect(n.kind).toBe('pause');
    if (n.kind !== 'pause') return;
    expect(n.paneId).toBe('%5');
  });

  it('returns Other for unrecognized lines (response payload)', () => {
    const n = parseNotification('this is a response line');
    expect(n.kind).toBe('other');
  });

  it('returns Other for malformed %output (missing data)', () => {
    const n = parseNotification('%output %42');
    expect(n.kind).toBe('other');
  });
});

describe('formatSendKeys', () => {
  it('encodes each byte as two hex digits, space-separated', () => {
    // "A" = 0x41
    expect(formatSendKeys('%0', new Uint8Array([0x41]))).toBe('send-keys -t %0 -H 41\n');
  });

  it('handles multiple bytes and zero bytes', () => {
    // 0x00 must encode as "00" not "0"
    expect(formatSendKeys('%9', new Uint8Array([0x00, 0xff, 0x1b]))).toBe(
      'send-keys -t %9 -H 00 ff 1b\n',
    );
  });

  it('emits an empty key list for empty input (caller decides whether to skip)', () => {
    expect(formatSendKeys('%0', new Uint8Array())).toBe('send-keys -t %0 -H\n');
  });
});

describe('shellEscape', () => {
  it('wraps a plain string in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it("safely escapes embedded single quotes via '\\''", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('preserves spaces and shell metacharacters inside the quotes', () => {
    expect(shellEscape('foo bar; rm -rf /')).toBe("'foo bar; rm -rf /'");
  });
});
