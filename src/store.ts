/**
 * Zustand store — the App model.
 *
 * Equivalent to v1's TEA `App` struct + `update()` reducer. Every event
 * funnels through a typed action; reducers are pure functions over the
 * previous state. Side-effect-heavy values (PaneTerminal, SpawnedSession,
 * the backend handle) live OUTSIDE the store in a refs object so React
 * Fast Refresh doesn't tear down PTYs on hot reload.
 */

import { create } from 'zustand';
import type { SpawnedSession } from './daemon/backends/SessionBackend.ts';
import type { PaneTerminal, Snapshot } from './daemon/terminal.ts';

export type ActiveModal = 'none' | 'themePicker' | 'fuzzySearch' | 'newSession';
export type FocusedPane = 'list' | 'terminal';

export interface SessionEntry {
  /** Stable UUID for the session — generated client-side at spawn time. */
  id: string;
  /** Human-readable name shown in the sidebar. */
  name: string;
  /** Role name (or null for sessions that didn't pick one). */
  role: string | null;
  /** Optional branch label (worktree mode). */
  branch: string | null;
  /** Display status. Driven by the backend (Running while bytes are flowing, Idle on prompt). */
  status: 'Running' | 'Idle' | 'Error';
  /** Working directory passed to the agent at spawn. */
  cwd: string | null;
}

export interface AppState {
  sessions: SessionEntry[];
  activeSessionId: string | null;
  /** Latest snapshot for the active session — sampled at ~30Hz by the UI loop. */
  activeSnapshot: Snapshot | null;
  focusedPane: FocusedPane;
  modal: ActiveModal;
  /** Active theme key (one of the keys in `themes.ts`). */
  theme: string;
  /** Current fuzzy filter string (empty when search isn't open). */
  searchQuery: string;
  /** Transient status message (auto-clears after a few seconds). */
  statusMessage: string | null;
}

export interface AppActions {
  addSession: (s: SessionEntry) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  setSnapshot: (snap: Snapshot | null) => void;
  setStatus: (id: string, status: SessionEntry['status']) => void;
  focus: (pane: FocusedPane) => void;
  openModal: (m: ActiveModal) => void;
  closeModal: () => void;
  setTheme: (name: string) => void;
  setSearchQuery: (q: string) => void;
  setStatusMessage: (msg: string | null) => void;
}

const initialState: AppState = {
  sessions: [],
  activeSessionId: null,
  activeSnapshot: null,
  focusedPane: 'list',
  modal: 'none',
  theme: 'default',
  searchQuery: '',
  statusMessage: null,
};

export const useApp = create<AppState & AppActions>((set) => ({
  ...initialState,

  addSession: (s) =>
    set((state) => ({
      sessions: [...state.sessions, s],
      activeSessionId: state.activeSessionId ?? s.id,
    })),

  removeSession: (id) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id);
      const nextActive =
        state.activeSessionId === id ? (remaining[0]?.id ?? null) : state.activeSessionId;
      return { sessions: remaining, activeSessionId: nextActive };
    }),

  setActiveSession: (id) => set({ activeSessionId: id, activeSnapshot: null }),

  setSnapshot: (snap) => set({ activeSnapshot: snap }),

  setStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, status } : s)),
    })),

  focus: (pane) => set({ focusedPane: pane }),

  openModal: (m) => set({ modal: m, searchQuery: '' }),

  closeModal: () => set({ modal: 'none', searchQuery: '' }),

  setTheme: (name) => set({ theme: name }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  setStatusMessage: (msg) => set({ statusMessage: msg }),
}));

/**
 * Side-effect handles tied to a session id. These DO NOT live in the
 * Zustand store because they hold non-serializable resources (PTY handles,
 * xterm instances) that must survive React Fast Refresh and are not React
 * state. Anyone who needs to operate on a session's I/O looks up handles
 * here; the UI reads only the serializable `SessionEntry` from the store.
 */
export const sessionHandles = new Map<
  string,
  {
    backendSession: SpawnedSession;
    pane: PaneTerminal;
  }
>();
