import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || join(HOME, '.local', 'share');
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(HOME, '.config');

/** Root directory for all persistent thurbox data. */
export const DATA_DIR = join(XDG_DATA_HOME, 'thurbox');

/** SQLite database file. */
export const DATABASE_FILE = join(DATA_DIR, 'thurbox.db');

/** Daily-rotated log file. */
export const LOG_DIR = DATA_DIR;
export const LOG_FILE = join(LOG_DIR, 'thurbox.log');

/** Admin session working directory (also home for .mcp.json). */
export const ADMIN_DIR = join(DATA_DIR, 'admin');

/** Skills directory (auto-discovered skills live under subfolders). */
export const SKILLS_DIR = join(ADMIN_DIR, 'skills');

/** Optional user keybindings override. */
export const KEYBINDINGS_FILE = join(XDG_CONFIG_HOME, 'thurbox', 'keybindings.json');
