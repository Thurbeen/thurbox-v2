/**
 * SQLite-backed persistent state.
 *
 * Mirrors v1's storage layer (src/storage/) at a much smaller scale: only
 * the tables for surviving features (sessions, worktrees, roles, MCP
 * servers, skills, repo bookmarks, metadata). Uses WAL mode for safe
 * multi-instance access; external changes are detected via
 * `PRAGMA data_version` polling — same mechanism v1 uses, same 250ms
 * cadence the App reads at.
 *
 * Schema version is recorded in the `metadata` table under
 * `schema_version`. The constructor runs all migrations from the current
 * stored version forward to SCHEMA_VERSION inside a single transaction.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_FILE } from './paths.ts';

// Bun's built-in `bun:sqlite` is a near drop-in for `better-sqlite3`. We
// renamed the locally-used type so the rest of the file reads the same.
type DatabaseInstance = Database;

export const SCHEMA_VERSION = 1;

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
export type SessionStatus = 'Running' | 'Idle' | 'Error';

export interface SessionRow {
  id: string;
  name: string;
  role: string | null;
  status: SessionStatus;
  agentSessionId: string | null;
  backendType: string;
  backendId: string | null;
  cwd: string | null;
  branch: string | null;
  createdAt: number;
  deletedAt: number | null;
}

export interface WorktreeRow {
  sessionId: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
}

export interface RoleRow {
  name: string;
  description: string | null;
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: PermissionMode;
  env: Record<string, string>;
  appendSystemPrompt: string | null;
}

export interface McpServerRow {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface SkillRow {
  name: string;
  path: string;
}

export interface RepoBookmarkRow {
  path: string;
  lastUsedAt: number;
}

/**
 * Thin wrapper around `better-sqlite3`. Synchronous API by design — every
 * call is fast (microseconds for indexed reads), so the main event loop
 * blocking on the DB is fine. M6/M8 will move to a worker thread if needed.
 */
export class DB {
  private readonly db: DatabaseInstance;

  constructor(path: string = DATABASE_FILE) {
    if (!existsSync(dirname(path))) {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /** Returns the current data_version — increments on commits by OTHER connections. */
  dataVersion(): number {
    const row = this.db.query('PRAGMA data_version').get() as { data_version: number } | null;
    return row?.data_version ?? 0;
  }

  // ---------- sessions ----------

  upsertSession(s: Omit<SessionRow, 'createdAt' | 'deletedAt'> & { createdAt?: number }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, name, role, status, agent_session_id, backend_type, backend_id, cwd, branch, created_at, deleted_at)
         VALUES ($id, $name, $role, $status, $agentSessionId, $backendType, $backendId, $cwd, $branch, $createdAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           role = excluded.role,
           status = excluded.status,
           agent_session_id = excluded.agent_session_id,
           backend_type = excluded.backend_type,
           backend_id = excluded.backend_id,
           cwd = excluded.cwd,
           branch = excluded.branch,
           deleted_at = NULL`,
      )
      .run({
        $id: s.id,
        $name: s.name,
        $role: s.role,
        $status: s.status,
        $agentSessionId: s.agentSessionId,
        $backendType: s.backendType,
        $backendId: s.backendId,
        $cwd: s.cwd,
        $branch: s.branch,
        $createdAt: s.createdAt ?? now,
      });
  }

  listSessions(includeDeleted = false): SessionRow[] {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    const rows = this.db
      .prepare(`SELECT * FROM sessions ${where} ORDER BY created_at ASC`)
      .all() as Array<{
      id: string;
      name: string;
      role: string | null;
      status: SessionStatus;
      agent_session_id: string | null;
      backend_type: string;
      backend_id: string | null;
      cwd: string | null;
      branch: string | null;
      created_at: number;
      deleted_at: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      status: r.status,
      agentSessionId: r.agent_session_id,
      backendType: r.backend_type,
      backendId: r.backend_id,
      cwd: r.cwd,
      branch: r.branch,
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
    }));
  }

  softDeleteSession(id: string): void {
    this.db.prepare('UPDATE sessions SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
  }

  restoreSession(id: string): void {
    this.db.prepare('UPDATE sessions SET deleted_at = NULL WHERE id = ?').run(id);
  }

  hardDeleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  // ---------- worktrees ----------

  setWorktree(w: WorktreeRow): void {
    this.db
      .prepare(
        `INSERT INTO worktrees (session_id, repo_path, worktree_path, branch)
         VALUES ($sessionId, $repoPath, $worktreePath, $branch)
         ON CONFLICT(session_id, repo_path) DO UPDATE SET
           worktree_path = excluded.worktree_path,
           branch = excluded.branch`,
      )
      .run({
        $sessionId: w.sessionId,
        $repoPath: w.repoPath,
        $worktreePath: w.worktreePath,
        $branch: w.branch,
      });
  }

  getWorktreesForSession(sessionId: string): WorktreeRow[] {
    const rows = this.db
      .prepare('SELECT * FROM worktrees WHERE session_id = ?')
      .all(sessionId) as Array<{
      session_id: string;
      repo_path: string;
      worktree_path: string;
      branch: string;
    }>;
    return rows.map((r) => ({
      sessionId: r.session_id,
      repoPath: r.repo_path,
      worktreePath: r.worktree_path,
      branch: r.branch,
    }));
  }

  // ---------- roles ----------

  /** Atomically replace the role set. */
  setRoles(roles: RoleRow[]): void {
    const tx = this.db.transaction((rs: RoleRow[]) => {
      this.db.prepare('DELETE FROM roles').run();
      const ins = this.db.prepare(
        `INSERT INTO roles (name, description, allowed_tools, disallowed_tools, permission_mode, env_json, append_system_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rs) {
        ins.run(
          r.name,
          r.description,
          JSON.stringify(r.allowedTools),
          JSON.stringify(r.disallowedTools),
          r.permissionMode,
          JSON.stringify(r.env),
          r.appendSystemPrompt,
        );
      }
    });
    tx(roles);
  }

  listRoles(): RoleRow[] {
    const rows = this.db.prepare('SELECT * FROM roles ORDER BY name ASC').all() as Array<{
      name: string;
      description: string | null;
      allowed_tools: string;
      disallowed_tools: string;
      permission_mode: PermissionMode;
      env_json: string;
      append_system_prompt: string | null;
    }>;
    return rows.map((r) => ({
      name: r.name,
      description: r.description,
      allowedTools: JSON.parse(r.allowed_tools) as string[],
      disallowedTools: JSON.parse(r.disallowed_tools) as string[],
      permissionMode: r.permission_mode,
      env: JSON.parse(r.env_json) as Record<string, string>,
      appendSystemPrompt: r.append_system_prompt,
    }));
  }

  // ---------- mcp servers ----------

  setMcpServers(servers: McpServerRow[]): void {
    const tx = this.db.transaction((ms: McpServerRow[]) => {
      this.db.prepare('DELETE FROM mcp_servers').run();
      const ins = this.db.prepare(
        `INSERT INTO mcp_servers (name, command, args_json, env_json)
         VALUES (?, ?, ?, ?)`,
      );
      for (const m of ms) {
        ins.run(m.name, m.command, JSON.stringify(m.args), JSON.stringify(m.env));
      }
    });
    tx(servers);
  }

  listMcpServers(): McpServerRow[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY name ASC').all() as Array<{
      name: string;
      command: string;
      args_json: string;
      env_json: string;
    }>;
    return rows.map((r) => ({
      name: r.name,
      command: r.command,
      args: JSON.parse(r.args_json) as string[],
      env: JSON.parse(r.env_json) as Record<string, string>,
    }));
  }

  // ---------- skills ----------

  setSkills(skills: SkillRow[]): void {
    const tx = this.db.transaction((ss: SkillRow[]) => {
      this.db.prepare('DELETE FROM skills').run();
      const ins = this.db.prepare('INSERT INTO skills (name, path) VALUES (?, ?)');
      for (const s of ss) ins.run(s.name, s.path);
    });
    tx(skills);
  }

  listSkills(): SkillRow[] {
    return this.db.prepare('SELECT * FROM skills ORDER BY name ASC').all() as SkillRow[];
  }

  // ---------- repo bookmarks ----------

  addRepoBookmark(path: string): void {
    this.db
      .prepare(
        `INSERT INTO repo_bookmarks (path, last_used_at) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at`,
      )
      .run(path, Date.now());
  }

  listRepoBookmarks(): RepoBookmarkRow[] {
    const rows = this.db
      .prepare('SELECT path, last_used_at FROM repo_bookmarks ORDER BY last_used_at DESC')
      .all() as Array<{ path: string; last_used_at: number }>;
    return rows.map((r) => ({ path: r.path, lastUsedAt: r.last_used_at }));
  }

  removeRepoBookmark(path: string): void {
    this.db.prepare('DELETE FROM repo_bookmarks WHERE path = ?').run(path);
  }

  // ---------- metadata (k/v) ----------

  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  // ---------- migrations ----------

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;
    `);

    const stored = Number(this.getMetadata('schema_version') ?? '0');
    if (stored >= SCHEMA_VERSION) return;

    const migrations: Array<(db: DatabaseInstance) => void> = [
      // v0 -> v1: initial schema.
      (db) => {
        db.exec(`
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT,
            status TEXT NOT NULL,
            agent_session_id TEXT,
            backend_type TEXT NOT NULL,
            backend_id TEXT,
            cwd TEXT,
            branch TEXT,
            created_at INTEGER NOT NULL,
            deleted_at INTEGER
          );
          CREATE INDEX sessions_active_idx ON sessions (created_at) WHERE deleted_at IS NULL;

          CREATE TABLE worktrees (
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            repo_path TEXT NOT NULL,
            worktree_path TEXT NOT NULL,
            branch TEXT NOT NULL,
            PRIMARY KEY (session_id, repo_path)
          ) WITHOUT ROWID;

          CREATE TABLE roles (
            name TEXT PRIMARY KEY,
            description TEXT,
            allowed_tools TEXT NOT NULL,
            disallowed_tools TEXT NOT NULL,
            permission_mode TEXT NOT NULL,
            env_json TEXT NOT NULL,
            append_system_prompt TEXT
          ) WITHOUT ROWID;

          CREATE TABLE mcp_servers (
            name TEXT PRIMARY KEY,
            command TEXT NOT NULL,
            args_json TEXT NOT NULL,
            env_json TEXT NOT NULL
          ) WITHOUT ROWID;

          CREATE TABLE skills (
            name TEXT PRIMARY KEY,
            path TEXT NOT NULL
          ) WITHOUT ROWID;

          CREATE TABLE repo_bookmarks (
            path TEXT PRIMARY KEY,
            last_used_at INTEGER NOT NULL
          ) WITHOUT ROWID;
        `);
      },
    ];

    const tx = this.db.transaction(() => {
      for (let v = stored; v < SCHEMA_VERSION; v++) {
        const fn = migrations[v];
        if (!fn) throw new Error(`missing migration for version ${v}`);
        fn(this.db);
      }
      this.setMetadata('schema_version', String(SCHEMA_VERSION));
    });
    tx();
  }
}
