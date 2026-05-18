/**
 * Session backend interface. The TUI talks to sessions only through this trait,
 * so a future backend (SSH+tmux, container, etc.) is a drop-in.
 *
 * Mirrors thurbox v1's `SessionBackend` trait (src/agent/backend.rs).
 */

/** A session discovered on startup (e.g., an existing tmux window). */
export interface DiscoveredSession {
  /** Backend-specific identifier (e.g., tmux pane_id `%42`). */
  backendId: string;
  /** Human-readable label (typically the tmux window name). */
  name: string;
  /** Whether the underlying process is still alive. */
  isAlive: boolean;
}

/** A newly-spawned session's I/O handles. */
export interface SpawnedSession {
  backendId: string;
  /** Async iterator of byte chunks emitted by the session's PTY. */
  output: AsyncIterable<Uint8Array>;
  /** Write a chunk of bytes to the session's PTY. Returns when the write is flushed. */
  write(bytes: Uint8Array): Promise<void>;
}

/** A re-adopted (existing) session's I/O handles. */
export interface AdoptedSession {
  output: AsyncIterable<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
}

/** Per-spawn parameters. */
export interface SpawnParams {
  /** Tmux window name (will be prefixed with `tb-`). */
  windowName: string;
  /** Command to run (e.g., `claude`). */
  command: string;
  /** Arguments. Never includes the command itself. */
  args: string[];
  /** Working directory for the new pane. */
  cwd?: string;
  /** Env overlay merged on top of the parent process's env. */
  env?: Record<string, string>;
  /** Initial PTY rows. */
  rows: number;
  /** Initial PTY columns. */
  cols: number;
}

export interface SessionBackend {
  /** Human-readable name (e.g., `local-tmux`). */
  readonly name: string;

  /** Resolve true once the backend's external tools are present and runnable. */
  checkAvailable(): Promise<void>;

  /** Bring the backend's external state to a known-good ready state. */
  ensureReady(): Promise<void>;

  /** Spawn a new session and return I/O handles. */
  spawn(params: SpawnParams): Promise<SpawnedSession>;

  /** Re-attach to an existing session by its backend ID. */
  adopt(backendId: string, rows: number, cols: number): Promise<AdoptedSession>;

  /** Enumerate sessions known to this backend (on TUI startup). */
  discover(): Promise<DiscoveredSession[]>;

  /** Resize a session's PTY. */
  resize(backendId: string, rows: number, cols: number): Promise<void>;

  /** Whether the session's process has exited. */
  isDead(backendId: string): Promise<boolean>;

  /** Destroy the session permanently. */
  kill(backendId: string): Promise<void>;

  /** Stop streaming this session without killing it (e.g., on Ctrl+Q quit). */
  detach(backendId: string): Promise<void>;
}
