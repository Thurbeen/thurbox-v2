/**
 * Local tmux backend — talks to a dedicated tmux server (`tmux -L thurbox`)
 * via control mode. Each thurbox session is one tmux window inside the
 * `thurbox` session; window names are prefixed with `tb-` so discovery can
 * filter them.
 *
 * Mirrors thurbox v1's `LocalTmuxBackend` (src/agent/tmux.rs), minus the
 * SSH/VM tunneling path.
 */

import { spawnSync } from 'node:child_process';
import { ControlMode, type ControlModeOptions } from '../tmux/control.ts';
import { shellEscape } from '../tmux/protocol.ts';
import type {
  AdoptedSession,
  DiscoveredSession,
  SessionBackend,
  SpawnParams,
  SpawnedSession,
} from './SessionBackend.ts';

const WINDOW_PREFIX = 'tb-';

export class LocalTmuxBackend implements SessionBackend {
  readonly name = 'local-tmux';
  private control: ControlMode | null = null;

  constructor(private readonly options: ControlModeOptions = {}) {}

  /** Verify `tmux` is on PATH; we run a trivial `-V` and check the output. */
  async checkAvailable(): Promise<void> {
    const r = spawnSync('tmux', ['-V'], { encoding: 'utf-8' });
    if (r.status !== 0 || !r.stdout?.startsWith('tmux ')) {
      throw new Error('tmux not found on PATH (need 3.2+)');
    }
  }

  /** Lazily start the long-lived control-mode connection. */
  async ensureReady(): Promise<void> {
    if (!this.control || this.control.isExited()) {
      this.control = new ControlMode(this.options);
      await this.control.start();
    }
  }

  async spawn(p: SpawnParams): Promise<SpawnedSession> {
    const ctrl = this.requireControl();
    const windowName = `${WINDOW_PREFIX}${p.windowName}`;

    // Build the command-to-run as a quoted single string for tmux's `new-window -d`.
    const envPrefix = Object.entries(p.env ?? {})
      .map(([k, v]) => `${k}=${shellEscape(v)}`)
      .join(' ');
    const argList = [p.command, ...p.args].map(shellEscape).join(' ');
    const shellCmd = envPrefix.length > 0 ? `${envPrefix} ${argList}` : argList;

    const cwdFlag = p.cwd ? ` -c ${shellEscape(p.cwd)}` : '';
    const cmd = `new-window -d -P -F '#{pane_id}' -n ${shellEscape(windowName)}${cwdFlag} ${shellEscape(shellCmd)}`;

    const lines = await ctrl.sendCommand(cmd);
    const paneId = lines[0]?.trim();
    if (!paneId || !paneId.startsWith('%')) {
      throw new Error(`unexpected new-window response: ${lines.join('\n')}`);
    }

    // Best-effort initial resize.
    await this.resize(paneId, p.rows, p.cols).catch(() => undefined);

    return {
      backendId: paneId,
      output: ctrl.subscribe(paneId),
      write: (b) => ctrl.sendBytes(paneId, b),
    };
  }

  async adopt(backendId: string, rows: number, cols: number): Promise<AdoptedSession> {
    const ctrl = this.requireControl();
    // Forcing a resize triggers SIGWINCH inside the pane and causes most TUIs
    // to repaint, which gives us "pixel perfect" rendering once vt100 catches
    // up with the stream. v1 also uses an initial `capture-pane` for a quick
    // approximation; we defer that to M3 once the vt100 layer needs it.
    await this.resize(backendId, rows, cols);
    return {
      output: ctrl.subscribe(backendId),
      write: (b) => ctrl.sendBytes(backendId, b),
    };
  }

  async discover(): Promise<DiscoveredSession[]> {
    const ctrl = this.requireControl();
    // Tmux's `-F` format strings do NOT interpret backslash escapes — `\t` in
    // the format string is emitted as a literal two-character `\t` sequence.
    // We use that as our field separator since it can't appear in the
    // formatted values themselves (pane_id is `%N`, window_name is sanitized).
    const fmt = "'#{pane_id}\\t#{window_name}\\t#{pane_dead}'";
    const lines = await ctrl.sendCommand(`list-windows -t ${ctrl.session} -F ${fmt}`);

    const out: DiscoveredSession[] = [];
    for (const line of lines) {
      const [paneId, name, dead] = line.split('\\t');
      if (!paneId || !name) continue;
      if (!name.startsWith(WINDOW_PREFIX)) continue;
      out.push({
        backendId: paneId,
        name: name.slice(WINDOW_PREFIX.length),
        isAlive: dead !== '1',
      });
    }
    return out;
  }

  async resize(backendId: string, rows: number, cols: number): Promise<void> {
    const ctrl = this.requireControl();
    await ctrl.sendCommand(`resize-window -t ${backendId} -x ${cols} -y ${rows}`);
  }

  async isDead(backendId: string): Promise<boolean> {
    const ctrl = this.requireControl();
    const lines = await ctrl.sendCommand(`display-message -p -t ${backendId} '#{pane_dead}'`);
    return lines[0]?.trim() === '1';
  }

  async kill(backendId: string): Promise<void> {
    const ctrl = this.requireControl();
    await ctrl.sendCommand(`kill-pane -t ${backendId}`);
  }

  async detach(_backendId: string): Promise<void> {
    // Detaching one pane means stopping the read-side iterator. For now we
    // leave the pane registered with the control-mode multiplexer — there's
    // no cost beyond a queue object. M4 can revisit this if memory becomes
    // an issue at high session counts.
  }

  /** Tear down the entire control-mode connection. Used on app shutdown. */
  async shutdown(): Promise<void> {
    this.control?.stop();
    this.control = null;
  }

  private requireControl(): ControlMode {
    if (!this.control || this.control.isExited()) {
      throw new Error('LocalTmuxBackend.ensureReady() was not called or tmux exited');
    }
    return this.control;
  }
}
