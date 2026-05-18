import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DB } from '../src/daemon/db.ts';
import { SyncPoller } from '../src/daemon/sync.ts';

/**
 * SyncPoller needs two SQLite *connections* observing the same file to
 * exercise multi-instance change detection. `:memory:` databases are
 * per-connection so we use a temp file.
 */

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thurbox-v2-sync-'));
  dbPath = join(dir, 'thurbox.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SyncPoller', () => {
  it('fires onChange after another connection commits', async () => {
    const reader = new DB(dbPath);
    const writer = new DB(dbPath);

    let bumps = 0;
    const poller = new SyncPoller(reader, () => bumps++, 25);
    poller.start();

    writer.upsertSession({
      id: 's',
      name: 's',
      role: null,
      status: 'Running',
      agentSessionId: null,
      backendType: 'local-tmux',
      backendId: null,
      cwd: null,
      branch: null,
    });

    // Allow the poller a couple of intervals to observe.
    await new Promise((r) => setTimeout(r, 150));
    poller.stop();
    reader.close();
    writer.close();
    expect(bumps).toBeGreaterThanOrEqual(1);
  });

  it('does not fire when nothing has changed', async () => {
    const reader = new DB(dbPath);
    let bumps = 0;
    const poller = new SyncPoller(reader, () => bumps++, 25);
    poller.start();
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();
    reader.close();
    expect(bumps).toBe(0);
  });
});
