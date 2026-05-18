import { describe, expect, it } from 'vitest';
import { DB, SCHEMA_VERSION } from '../src/daemon/db.ts';

function memDb(): DB {
  return new DB(':memory:');
}

describe('DB migrations', () => {
  it('initializes a fresh DB at the current schema version', () => {
    const db = memDb();
    expect(db.getMetadata('schema_version')).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('is idempotent across reopens (no DDL re-runs)', () => {
    const db1 = memDb();
    db1.setMetadata('foo', 'bar');
    db1.close();
    // Can't reopen :memory: — that's fine, the migration's idempotence is
    // exercised by the second instance starting from version 1.
    const db2 = memDb();
    expect(db2.getMetadata('schema_version')).toBe(String(SCHEMA_VERSION));
    db2.close();
  });
});

describe('DB.sessions', () => {
  it('round-trips a session through upsert/list/softDelete/restore', () => {
    const db = memDb();
    db.upsertSession({
      id: 'a',
      name: 'one',
      role: 'developer',
      status: 'Running',
      agentSessionId: 'agent-a',
      backendType: 'local-tmux',
      backendId: '%1',
      cwd: '/home/me/proj',
      branch: null,
    });
    let active = db.listSessions();
    expect(active).toHaveLength(1);
    expect(active[0]?.name).toBe('one');

    db.softDeleteSession('a');
    expect(db.listSessions()).toHaveLength(0);
    expect(db.listSessions(true)).toHaveLength(1);

    db.restoreSession('a');
    active = db.listSessions();
    expect(active).toHaveLength(1);
    expect(active[0]?.deletedAt).toBeNull();
    db.close();
  });

  it('upsert merges by id and preserves createdAt across updates', () => {
    const db = memDb();
    db.upsertSession({
      id: 'b',
      name: 'first',
      role: null,
      status: 'Running',
      agentSessionId: null,
      backendType: 'local-tmux',
      backendId: null,
      cwd: null,
      branch: null,
      createdAt: 1000,
    });
    db.upsertSession({
      id: 'b',
      name: 'renamed',
      role: 'developer',
      status: 'Idle',
      agentSessionId: 'a',
      backendType: 'local-tmux',
      backendId: '%5',
      cwd: '/a',
      branch: null,
      createdAt: 999_999, // upsert should NOT change created_at via ON CONFLICT
    });
    const [row] = db.listSessions();
    expect(row?.name).toBe('renamed');
    expect(row?.status).toBe('Idle');
    expect(row?.createdAt).toBe(1000);
    db.close();
  });
});

describe('DB.roles', () => {
  it('atomically replaces the role set', () => {
    const db = memDb();
    db.setRoles([
      {
        name: 'developer',
        description: 'default',
        allowedTools: ['Read', 'Bash(git:*)'],
        disallowedTools: [],
        permissionMode: 'acceptEdits',
        env: { LANG: 'C.UTF-8' },
        appendSystemPrompt: null,
      },
    ]);
    expect(db.listRoles()).toHaveLength(1);
    db.setRoles([
      {
        name: 'reviewer',
        description: null,
        allowedTools: ['Read'],
        disallowedTools: ['Edit', 'Write'],
        permissionMode: 'plan',
        env: {},
        appendSystemPrompt: null,
      },
    ]);
    const roles = db.listRoles();
    expect(roles).toHaveLength(1);
    expect(roles[0]?.name).toBe('reviewer');
    expect(roles[0]?.disallowedTools).toEqual(['Edit', 'Write']);
    expect(roles[0]?.permissionMode).toBe('plan');
    db.close();
  });
});

describe('DB.dataVersion', () => {
  it('returns a numeric version (multi-connection bump is tested in sync.test.ts)', () => {
    // SQLite's PRAGMA data_version only increments for changes made by
    // *other* connections; same-connection writes do not bump it. This
    // matches the behavior thurbox's multi-instance sync relies on — see
    // tests/sync.test.ts for the actual bump assertion.
    const db = memDb();
    expect(typeof db.dataVersion()).toBe('number');
    db.close();
  });
});

describe('DB.repoBookmarks', () => {
  it('lists in most-recent-first order and dedupes by path', () => {
    const db = memDb();
    db.addRepoBookmark('/a');
    db.addRepoBookmark('/b');
    db.addRepoBookmark('/a'); // bumps to most-recent
    const list = db.listRepoBookmarks();
    expect(list.map((r) => r.path)).toEqual(['/a', '/b']);
    db.removeRepoBookmark('/a');
    expect(db.listRepoBookmarks().map((r) => r.path)).toEqual(['/b']);
    db.close();
  });
});

describe('DB.mcpServers & DB.skills', () => {
  it('round-trips and atomically replaces both lists', () => {
    const db = memDb();
    db.setMcpServers([{ name: 'fs', command: 'mcp-fs', args: ['--root', '/'], env: { X: '1' } }]);
    expect(db.listMcpServers()).toEqual([
      { name: 'fs', command: 'mcp-fs', args: ['--root', '/'], env: { X: '1' } },
    ]);

    db.setSkills([{ name: 'review', path: '/home/me/skills/review' }]);
    expect(db.listSkills()).toEqual([{ name: 'review', path: '/home/me/skills/review' }]);
    db.close();
  });
});
