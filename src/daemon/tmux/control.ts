/**
 * Tmux control-mode (`-C`) client.
 *
 * Spawns `tmux -L thurbox -C attach` (creating the session if needed) and
 * runs a single long-lived process:
 *  - Writes commands to stdin, line-delimited.
 *  - Reads notifications from stdout, line-delimited.
 *  - Demultiplexes `%output %<paneId>` chunks into per-pane queues so multiple
 *    panes can be read concurrently.
 *  - Serializes commands through a FIFO of pending response promises; each
 *    command's response is bracketed by `%begin` / `%end` (or `%error`).
 *
 * Design notes (ported from v1):
 *  - We use `-C` (single C), NOT `-CC`. `-CC` requires a TTY on its stdin
 *    (it's the "interactive" mode for users typing tmux commands); `-C`
 *    works with piped stdin and is the protocol-only mode. Using `-C` lets
 *    us drive control mode through plain pipes without node-pty.
 *  - One `%begin`/`%end` pair per command. The notification stream interleaves
 *    these freely with `%output`, so we route lines to "currently-collecting
 *    response" vs "broadcast to pane" based on which bracket marker is in
 *    flight.
 *  - `send-keys -H` is the only way to forward arbitrary bytes safely; we
 *    never shell-quote user input.
 */

import { type ChildProcessByStdio, spawn as cpSpawn, spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { formatSendKeys, parseNotification } from './protocol.ts';

/** Default tmux server socket name (matches v1). */
export const DEFAULT_TMUX_SOCKET = 'thurbox';

/** Default tmux session name inside the server. */
export const DEFAULT_TMUX_SESSION = 'thurbox';

/** Configuration for a control-mode connection. Defaults match v1. */
export interface ControlModeOptions {
  socket?: string;
  session?: string;
  rows?: number;
  cols?: number;
}

type Resolver<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };

interface PendingResponse {
  lines: string[];
  isError: boolean;
}

/**
 * Per-pane output queue: producers (the control-mode reader) push chunks via
 * `push`, consumers (`AsyncIterable` returned to backends) await `next()`.
 * Backpressure is intentional and bounded: we hold a soft cap and drop chunks
 * older than the cap to keep memory from runaway sessions in check.
 */
class PaneQueue {
  private queue: Uint8Array[] = [];
  private waiters: Resolver<IteratorResult<Uint8Array>>[] = [];
  private closed = false;
  private readonly softCap = 4096;

  push(chunk: Uint8Array): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) {
      w.resolve({ value: chunk, done: false });
      return;
    }
    if (this.queue.length >= this.softCap) {
      // Drop oldest to keep latency bounded if a consumer falls behind.
      this.queue.shift();
    }
    this.queue.push(chunk);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length) {
      const w = this.waiters.shift();
      w?.resolve({ value: undefined as unknown as Uint8Array, done: true });
    }
  }

  iterator(): AsyncIterableIterator<Uint8Array> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<Uint8Array>> {
        const queued = self.queue.shift();
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false });
        }
        if (self.closed) {
          return Promise.resolve({ value: undefined as unknown as Uint8Array, done: true });
        }
        return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          self.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

type TmuxChild = ChildProcessByStdio<Writable, Readable, Readable>;

export class ControlMode {
  readonly socket: string;
  readonly session: string;
  private proc: TmuxChild | null = null;
  private readonly panes = new Map<string, PaneQueue>();
  private readonly pending: { resolver: Resolver<PendingResponse>; response: PendingResponse }[] =
    [];
  private currentResponse: PendingResponse | null = null;
  private lineBuffer = '';
  private started = false;
  private exited = false;

  constructor(opts: ControlModeOptions = {}) {
    this.socket = opts.socket ?? DEFAULT_TMUX_SOCKET;
    this.session = opts.session ?? DEFAULT_TMUX_SESSION;
  }

  /**
   * Boot tmux in control mode. Resolves once tmux has emitted its initial
   * `%begin`/`%end` attach response and the baseline `set -g` commands have
   * been acknowledged.
   */
  async start(opts: { rows?: number; cols?: number } = {}): Promise<void> {
    if (this.started) return;
    this.started = true;

    const rows = opts.rows ?? 24;
    const cols = opts.cols ?? 80;

    // 1. Ensure the named tmux server + session exists (idempotent).
    //    Attach refuses to create a missing session, so we new-session first
    //    with `-d` (detached). If it already exists, tmux returns an error
    //    which we ignore. We use Node's `child_process` here because Bun's
    //    native `Bun.spawn` on WSL2 (1.3.14) breaks tmux daemon detachment —
    //    the server exits with "server exited unexpectedly". Node's spawn
    //    behaves correctly. Both are available under Bun's compat layer, so
    //    this only affects the runtime path, not the build.
    const env = tmuxEnv();

    // Sweep stale socket files. `tmux kill-server` exits 0 ("no server") and
    // does NOT unlink the socket inode. If a previous tmux server crashed
    // mid-attach, that stale file pins the socket name into "server exited
    // unexpectedly" state — every subsequent operation on this socket fails
    // immediately until the file is removed. We detect that by trying a
    // benign `list-sessions`: a healthy/missing server returns code 1 with
    // "no server running" on stderr; a stale socket returns code 1 with
    // "server exited unexpectedly".
    const probe = spawnSync('tmux', ['-L', this.socket, 'list-sessions'], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf-8',
    });
    if (probe.stderr?.includes('server exited unexpectedly')) {
      const socketPath = join(tmpdir(), `tmux-${process.getuid?.() ?? 0}`, this.socket);
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
          // best-effort; new-session below will surface the real error
        }
      }
    }

    const ns = spawnSync(
      'tmux',
      [
        '-L',
        this.socket,
        'new-session',
        '-d',
        '-s',
        this.session,
        '-x',
        String(cols),
        '-y',
        String(rows),
      ],
      { env, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf-8' },
    );
    if (ns.status !== 0 && !ns.stderr?.includes('duplicate session')) {
      throw new Error(`tmux new-session failed: ${ns.stderr?.trim() ?? 'unknown error'}`);
    }

    // 2. Attach in control mode via plain pipes.
    this.proc = cpSpawn('tmux', ['-L', this.socket, '-C', 'attach-session', '-t', this.session], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wire stdout into our line-based state machine.
    this.proc.stdout.setEncoding('utf-8');
    this.proc.stdout.on('data', (chunk: string) => this.feedString(chunk));
    this.proc.stdout.on('end', () => this.onExit());

    // Stderr is drained but only logged if non-empty when the process exits.
    let stderrBuf = '';
    this.proc.stderr.setEncoding('utf-8');
    this.proc.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });

    this.proc.on('exit', (code) => {
      // Non-zero exit + non-empty stderr is the interesting case; surface it
      // on the next pending response (if any). M4 will route this through a
      // proper file logger so it shows up in the TUI status bar too.
      if (code !== 0 && stderrBuf.length > 0 && this.pending.length > 0) {
        const head = this.pending.shift();
        head?.resolver.reject(new Error(`tmux exited: ${stderrBuf.trim()}`));
      }
      this.onExit();
    });

    // 3. Synchronize: send `refresh-client` and wait for its %begin/%end.
    //    This drains tmux's implicit attach response too — any %begin/%end
    //    pair that arrives gets matched in order against pending waiters.
    await this.sendCommand('refresh-client');

    // 4. Match v1's baseline settings. Issued one at a time (each waits for
    //    its own %begin/%end) so tmux processes them in order with no race
    //    against the new-session window's startup.
    await this.sendCommand('set -g remain-on-exit on');
    await this.sendCommand('set -g status off');
    await this.sendCommand('set -g history-limit 5000');
  }

  /** True if tmux has exited and the client should be discarded. */
  isExited(): boolean {
    return this.exited;
  }

  /** Forcefully stop the tmux control connection. Does not kill the server. */
  stop(): void {
    try {
      this.proc?.stdin.end();
    } catch {
      // already closed
    }
    try {
      this.proc?.kill();
    } catch {
      // already dead
    }
    this.proc = null;
    this.exited = true;
  }

  /**
   * Subscribe to a pane's output stream. Iteration ends when the pane is
   * closed or the control connection exits.
   */
  subscribe(paneId: string): AsyncIterableIterator<Uint8Array> {
    return this.paneQueue(paneId).iterator();
  }

  /** Send raw bytes to a pane's PTY via `send-keys -H`. */
  async sendBytes(paneId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    await this.sendCommand(formatSendKeys(paneId, bytes).trimEnd());
  }

  /**
   * Send a control-mode command (text after the prompt, no trailing newline)
   * and resolve with the response lines (the body of the `%begin`/`%end`
   * envelope).
   */
  async sendCommand(cmd: string): Promise<string[]> {
    if (!this.proc || this.exited) {
      throw new Error('control mode not started or already exited');
    }
    const responsePromise = this.expectResponse();
    this.proc.stdin.write(`${cmd}\n`);
    const resp = await responsePromise;
    if (resp.isError) {
      throw new Error(`tmux command failed: ${cmd}\n${resp.lines.join('\n')}`);
    }
    return resp.lines;
  }

  private expectResponse(): Promise<PendingResponse> {
    return new Promise<PendingResponse>((resolve, reject) => {
      this.pending.push({
        resolver: { resolve, reject },
        response: { lines: [], isError: false },
      });
    });
  }

  private paneQueue(paneId: string): PaneQueue {
    let q = this.panes.get(paneId);
    if (!q) {
      q = new PaneQueue();
      this.panes.set(paneId, q);
    }
    return q;
  }

  /**
   * Feed a string chunk from tmux's stdout into the line-based state machine.
   *
   * The control-mode protocol is ASCII; `%output` payloads embed binary as
   * `\NNN` octal escapes which our parser decodes back into Uint8Array.
   */
  private feedString(chunk: string): void {
    this.lineBuffer += chunk;
    while (true) {
      const nl = this.lineBuffer.indexOf('\n');
      if (nl < 0) break;
      const raw = this.lineBuffer.slice(0, nl);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      this.handleLine(line);
    }
  }

  /** Called once tmux exits or its stdout closes. Idempotent. */
  private onExit(): void {
    if (this.exited) return;
    this.exited = true;
    for (const q of this.panes.values()) q.close();
    while (this.pending.length) {
      const p = this.pending.shift();
      p?.resolver.reject(new Error('tmux control mode exited'));
    }
  }

  private handleLine(line: string): void {
    if (line.length === 0) return;

    const n = parseNotification(line);
    switch (n.kind) {
      case 'output': {
        this.paneQueue(n.paneId).push(n.data);
        return;
      }
      case 'begin': {
        if (!this.currentResponse) {
          const head = this.pending[0];
          this.currentResponse = head ? head.response : { lines: [], isError: false };
        }
        return;
      }
      case 'end':
      case 'error': {
        if (this.currentResponse) {
          this.currentResponse.isError = n.kind === 'error';
        }
        const head = this.pending.shift();
        if (head) head.resolver.resolve(head.response);
        this.currentResponse = null;
        return;
      }
      case 'pause': {
        // M2b: re-enable the pane with `refresh-client -f pause-after=N`.
        return;
      }
      case 'other': {
        if (this.currentResponse) this.currentResponse.lines.push(line);
        return;
      }
    }
  }
}

/**
 * Build an env for tmux subprocesses that strips inherited tmux state.
 *
 * Specifically, drop `TMUX` and `TMUX_PANE` so the child tmux doesn't think
 * it's nested inside another tmux session. This matters when thurbox is
 * launched from inside a tmux pane (the common case for v1 users) — without
 * scrubbing, the child server greets us with "%exit server exited
 * unexpectedly" because it refuses to attach a control client into what it
 * believes is its own ancestor.
 */
function tmuxEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'TMUX' && k !== 'TMUX_PANE') env[k] = v;
  }
  return env;
}
