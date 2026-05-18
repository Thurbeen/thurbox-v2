/**
 * Root component.
 *
 * Boots the tmux backend + SQLite DB, spawns one demo session so the M6
 * milestone has something to navigate, runs the snapshot poll loop, and
 * dispatches global keybindings.
 *
 * Global keys (mirrors v1's vim-inspired set):
 *   Ctrl+Q  quit
 *   Ctrl+N  new session (M6b — currently spawns a 2nd demo shell)
 *   Ctrl+J  next session in sidebar
 *   Ctrl+K  prev session
 *   Ctrl+L  focus terminal
 *   Ctrl+H  focus sidebar
 *   Ctrl+D  close active session
 *   Ctrl+Y / F4  theme picker
 *   /       (sidebar focus) open fuzzy search
 *
 * Input forwarding: when the terminal pane is focused, every keystroke
 * goes through `keyEventToBytes` and is written to the active session.
 */

import { Box, Text, useApp as useInkApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { LocalTmuxBackend } from '../daemon/backends/LocalTmuxBackend.ts';
import type { SessionBackend } from '../daemon/backends/SessionBackend.ts';
import { DB } from '../daemon/db.ts';
import { PaneTerminal } from '../daemon/terminal.ts';
import { sessionHandles, useApp } from '../store.ts';
import { FuzzySearch } from './FuzzySearch.tsx';
import { SessionList, useTheme } from './SessionList.tsx';
import { Terminal as TerminalView } from './Terminal.tsx';
import { ThemePicker } from './ThemePicker.tsx';
import { keyEventToBytes } from './keymap.ts';

const ROWS = 20;
const COLS = 80;
const SNAPSHOT_FPS = 30;

type Status = 'booting' | 'ready' | 'error';

export function App() {
  const { exit } = useInkApp();
  const theme = useTheme();
  const [bootStatus, setBootStatus] = useState<Status>('booting');
  const [error, setError] = useState<string | null>(null);

  const sessions = useApp((s) => s.sessions);
  const activeId = useApp((s) => s.activeSessionId);
  const modal = useApp((s) => s.modal);
  const focusedPane = useApp((s) => s.focusedPane);
  const snapshot = useApp((s) => s.activeSnapshot);
  const addSession = useApp((s) => s.addSession);
  const removeSession = useApp((s) => s.removeSession);
  const setActiveSession = useApp((s) => s.setActiveSession);
  const setSnapshot = useApp((s) => s.setSnapshot);
  const focus = useApp((s) => s.focus);
  const openModal = useApp((s) => s.openModal);
  const setTheme = useApp((s) => s.setTheme);

  const backendRef = useRef<SessionBackend | null>(null);
  const dbRef = useRef<DB | null>(null);

  // Boot: tmux backend + SQLite + initial demo session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap runs once; Zustand setters are stable refs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = new DB();
        dbRef.current = db;
        const persistedTheme = db.getMetadata('active_theme');
        if (persistedTheme) setTheme(persistedTheme);

        const backend = new LocalTmuxBackend({ socket: 'thurbox-v2', session: 'thurbox-v2' });
        await backend.checkAvailable();
        await backend.ensureReady();
        if (cancelled) return;
        backendRef.current = backend;

        await spawnDemoSession(backend, 'demo-1');
        setBootStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBootStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      // Kill all live sessions on app exit. We don't `detach()` here because
      // that would leave tmux state behind; for the M6 demo a hard kill is
      // fine. M8 wires Ctrl+Q to detach instead.
      const b = backendRef.current;
      if (b) {
        for (const [id, h] of sessionHandles.entries()) {
          h.pane.dispose();
          b.kill(h.backendSession.backendId).catch(() => undefined);
          sessionHandles.delete(id);
        }
      }
      dbRef.current?.close();
    };
  }, []);

  // Persist theme changes to SQLite (debounced via the next-tick microtask
  // — the store update + a single fast DB write is cheap).
  const themeKey = useApp((s) => s.theme);
  useEffect(() => {
    if (bootStatus !== 'ready') return;
    dbRef.current?.setMetadata('active_theme', themeKey);
  }, [themeKey, bootStatus]);

  // Snapshot poll: 30Hz from the active pane.
  useEffect(() => {
    if (bootStatus !== 'ready' || !activeId) return;
    const handle = sessionHandles.get(activeId);
    if (!handle) return;
    setSnapshot(handle.pane.snapshot());
    const id = setInterval(
      () => {
        const h = sessionHandles.get(activeId);
        if (h) setSnapshot(h.pane.snapshot());
      },
      Math.floor(1000 / SNAPSHOT_FPS),
    );
    return () => clearInterval(id);
  }, [bootStatus, activeId, setSnapshot]);

  // Global key handler. Order matters: modal handlers swallow keys first
  // (their own `useInput` runs because they're mounted children of App).
  useInput((input, key) => {
    if (modal !== 'none') return;

    // Ctrl+Q quit
    if (key.ctrl && input === 'q') {
      exit();
      return;
    }
    // Ctrl+Y or F4: theme picker
    if (key.ctrl && input === 'y') {
      openModal('themePicker');
      return;
    }
    // (F4 isn't exposed by Ink's Key — handled via raw escape sequence in M6b)

    // Sidebar-focused navigation
    if (focusedPane === 'list') {
      if (input === '/') {
        openModal('fuzzySearch');
        return;
      }
      if (key.ctrl && input === 'j') {
        cycleSession(1);
        return;
      }
      if (key.ctrl && input === 'k') {
        cycleSession(-1);
        return;
      }
      if (key.ctrl && (input === 'l' || input === 'h')) {
        focus(input === 'l' ? 'terminal' : 'list');
        return;
      }
      if (key.return) {
        focus('terminal');
        return;
      }
      // Ctrl+N: spawn another demo session (M6b replaces with the modal flow)
      if (key.ctrl && input === 'n') {
        const b = backendRef.current;
        if (b) spawnDemoSession(b, `demo-${sessions.length + 1}`).catch(() => undefined);
        return;
      }
      if (key.ctrl && input === 'd' && activeId) {
        closeSession(activeId);
        return;
      }
      return;
    }

    // Terminal-focused: forward to PTY.
    if (focusedPane === 'terminal') {
      // Ctrl+H exits terminal focus back to the sidebar.
      if (key.ctrl && input === 'h') {
        focus('list');
        return;
      }
      // Ctrl+J / Ctrl+K still cycle sessions even when terminal is focused.
      if (key.ctrl && input === 'j') {
        cycleSession(1);
        return;
      }
      if (key.ctrl && input === 'k') {
        cycleSession(-1);
        return;
      }
      if (!activeId) return;
      const handle = sessionHandles.get(activeId);
      if (!handle) return;
      const bytes = keyEventToBytes(input, key);
      if (bytes) handle.backendSession.write(bytes).catch(() => undefined);
    }
  });

  function cycleSession(delta: number): void {
    if (sessions.length === 0) return;
    const idx = sessions.findIndex((s) => s.id === activeId);
    const next = (idx + delta + sessions.length) % sessions.length;
    const nextId = sessions[next]?.id;
    if (nextId) setActiveSession(nextId);
  }

  async function closeSession(id: string): Promise<void> {
    const handle = sessionHandles.get(id);
    const b = backendRef.current;
    if (handle && b) {
      handle.pane.dispose();
      await b.kill(handle.backendSession.backendId).catch(() => undefined);
      sessionHandles.delete(id);
    }
    removeSession(id);
  }

  async function spawnDemoSession(b: SessionBackend, name: string): Promise<void> {
    const id = crypto.randomUUID();
    const s = await b.spawn({
      windowName: name,
      command: 'sh',
      args: ['-i'],
      env: { PS1: 'thurbox-v2$ ' },
      rows: ROWS,
      cols: COLS,
    });
    const pane = new PaneTerminal(ROWS, COLS);
    pane.attach(s.output);
    sessionHandles.set(id, { backendSession: s, pane });
    addSession({
      id,
      name,
      role: null,
      branch: null,
      status: 'Running',
      cwd: null,
    });
  }

  if (bootStatus === 'booting') {
    return (
      <Box borderStyle="round" borderColor={theme.borderFocused} padding={1}>
        <Text color={theme.accent}>booting…</Text>
      </Box>
    );
  }
  if (bootStatus === 'error') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.statusError} padding={1}>
        <Text color={theme.statusError}>error: {error}</Text>
        <Text color={theme.muted} dimColor>
          Ctrl+Q to exit.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <SessionList theme={theme} focused={focusedPane === 'list' && modal === 'none'} />
        <Box flexDirection="column" marginLeft={1} flexGrow={1}>
          <Box
            borderStyle="round"
            borderColor={
              focusedPane === 'terminal' && modal === 'none'
                ? theme.borderFocused
                : theme.borderUnfocused
            }
          >
            {snapshot ? (
              <TerminalView snapshot={snapshot} width={COLS} />
            ) : (
              <Text color={theme.muted}>(no active session)</Text>
            )}
          </Box>
        </Box>
      </Box>
      <Box>
        <Text color={theme.muted} dimColor>
          {focusedPane === 'list'
            ? 'Ctrl+J/K · Enter focus pane · / search · Ctrl+N new · Ctrl+D close · Ctrl+Y theme · Ctrl+Q quit'
            : 'Ctrl+H back · Ctrl+J/K switch session · keys forward to PTY · Ctrl+Q quit'}
        </Text>
      </Box>
      {modal === 'themePicker' && (
        <Box marginTop={1}>
          <ThemePicker theme={theme} />
        </Box>
      )}
      {modal === 'fuzzySearch' && (
        <Box marginTop={1}>
          <FuzzySearch theme={theme} />
        </Box>
      )}
    </Box>
  );
}
