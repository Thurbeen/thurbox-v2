/**
 * Multi-instance change detection via `PRAGMA data_version`.
 *
 * SQLite's WAL mode allows concurrent readers + a single writer. When any
 * connection (including another thurbox process) commits, `data_version`
 * increments. Each running thurbox polls it ~4x/sec; on a change, the
 * caller refetches whichever lists it cares about and dispatches refresh
 * actions through the Zustand store.
 */

import type { DB } from './db.ts';

export class SyncPoller {
  private lastVersion: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DB,
    private readonly onChange: () => void,
    private readonly intervalMs = 250,
  ) {
    this.lastVersion = db.dataVersion();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const v = this.db.dataVersion();
      if (v !== this.lastVersion) {
        this.lastVersion = v;
        try {
          this.onChange();
        } catch {
          // a buggy listener must not stop polling
        }
      }
    }, this.intervalMs);
    // Don't let the poller pin the event loop alive.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
