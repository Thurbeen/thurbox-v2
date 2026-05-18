/**
 * Root component.
 *
 * Layout (matches v1 thurbox):
 *
 *   ┌ header (1 row, brand + version, no border)
 *   │ ┌ sidebar (28 cols) ┐  ┌ terminal (rest) ──────────┐
 *   │ │ Sessions          │  │                            │
 *   │ │ ▶ demo-1 ●        │  │  thurbox-v2$               │
 *   │ │                   │  │                            │
 *   │ └───────────────────┘  └────────────────────────────┘
 *   └ footer (1 row, keybind hints, no border)
 *
 * The terminal size is computed from the host screen via `useStdout()` so
 * the PaneTerminal is created with the correct rows/cols and resizes when
 * the user resizes their terminal.
 *
 * Side effects (PTY, xterm, DB) live in refs; React Fast Refresh tears
 * down the View tree but never the refs.
 */

import { Box, Text, useApp as useInkApp, useInput, useStdout } from 'ink';
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

const SIDEBAR_WIDTH = 28;
const HEADER_HEIGHT = 1;
const FOOTER_HEIGHT = 1;
const BORDERS_OVERHEAD = 2; // top + bottom border of the terminal panel
const SNAPSHOT_FPS = 30;

type Status = 'booting' | 'ready' | 'error';

interface Size {
  rows: number;
  cols: number;
}

/** Compute the inner terminal-pane dimensions from the host screen size. */
function terminalSize(host: Size): Size {
  const rows = Math.max(5, host.rows - HEADER_HEIGHT - FOOTER_HEIGHT - BORDERS_OVERHEAD);
  // Sidebar takes its width + its own two borders + 1 col gap.
  const cols = Math.max(20, host.cols - SIDEBAR_WIDTH - BORDERS_OVERHEAD);
  return { rows, cols };
}

export function App() {
  const { exit } = useInkApp();
  const { stdout } = useStdout();
  const theme = useTheme();
  const [bootStatus, setBootStatus] = useState<Status>('booting');
  const [error, setError] = useState<string | null>(null);
  const [hostSize, setHostSize] = useState<Size>({
    rows: stdout?.rows ?? 24,
    cols: stdout?.columns ?? 80,
  });

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

  // Track host resizes.
  useEffect(() => {
    if (!stdout) return;
    const update = () => setHostSize({ rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 });
    stdout.on('resize', update);
    return () => {
      stdout.off('resize', update);
    };
  }, [stdout]);

  const termSize = terminalSize(hostSize);

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

        await spawnDemoSession(backend, 'demo-1', termSize);
        setBootStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBootStatus('error');
      }
    })();
    return () => {
      cancelled = true;
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

  // Resize all panes when the host screen changes.
  useEffect(() => {
    if (bootStatus !== 'ready') return;
    const b = backendRef.current;
    for (const handle of sessionHandles.values()) {
      handle.pane.resize(termSize.rows, termSize.cols);
      b?.resize(handle.backendSession.backendId, termSize.rows, termSize.cols).catch(
        () => undefined,
      );
    }
  }, [bootStatus, termSize.rows, termSize.cols]);

  // Persist theme changes to SQLite.
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

  // Global key handler.
  useInput((input, key) => {
    if (modal !== 'none') return;
    if (key.ctrl && input === 'q') return exit();
    if (key.ctrl && input === 'y') return openModal('themePicker');

    if (focusedPane === 'list') {
      if (input === '/') return openModal('fuzzySearch');
      if (key.ctrl && input === 'j') return cycleSession(1);
      if (key.ctrl && input === 'k') return cycleSession(-1);
      if (key.ctrl && input === 'l') return focus('terminal');
      if (key.ctrl && input === 'h') return focus('list');
      if (key.return) return focus('terminal');
      if (key.ctrl && input === 'n') {
        const b = backendRef.current;
        if (b) spawnDemoSession(b, `demo-${sessions.length + 1}`, termSize).catch(() => undefined);
        return;
      }
      if (key.ctrl && input === 'd' && activeId) return closeSession(activeId);
      return;
    }

    if (focusedPane === 'terminal') {
      if (key.ctrl && input === 'h') return focus('list');
      if (key.ctrl && input === 'j') return cycleSession(1);
      if (key.ctrl && input === 'k') return cycleSession(-1);
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

  async function spawnDemoSession(b: SessionBackend, name: string, size: Size): Promise<void> {
    const id = crypto.randomUUID();
    const s = await b.spawn({
      windowName: name,
      command: 'sh',
      args: ['-i'],
      env: { PS1: 'thurbox-v2$ ' },
      rows: size.rows,
      cols: size.cols,
    });
    const pane = new PaneTerminal(size.rows, size.cols);
    pane.attach(s.output);
    sessionHandles.set(id, { backendSession: s, pane });
    addSession({ id, name, role: null, branch: null, status: 'Running', cwd: null });
  }

  if (bootStatus === 'booting') {
    return (
      <Box>
        <Text color={theme.accent}>booting…</Text>
      </Box>
    );
  }
  if (bootStatus === 'error') {
    return (
      <Box flexDirection="column">
        <Text color={theme.statusError}>error: {error}</Text>
        <Text color={theme.muted} dimColor>
          Ctrl+Q to exit.
        </Text>
      </Box>
    );
  }

  // Main layout: header row, body row (sidebar + terminal), footer row.
  const sidebarFocused = focusedPane === 'list' && modal === 'none';
  const terminalFocused = focusedPane === 'terminal' && modal === 'none';

  return (
    <Box flexDirection="column" width={hostSize.cols} height={hostSize.rows}>
      {/* Header */}
      <Box height={HEADER_HEIGHT}>
        <Text bold color={theme.accent}>
          {' thurbox'}
        </Text>
        <Text color={theme.muted}>{'  Multi-Session Agent Orchestrator'}</Text>
        <Text color={theme.muted} dimColor>
          {'  v0.0.0-dev'}
        </Text>
      </Box>

      {/* Body */}
      <Box flexGrow={1}>
        <SessionList theme={theme} focused={sidebarFocused} width={SIDEBAR_WIDTH} />
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor={terminalFocused ? theme.borderFocused : theme.borderUnfocused}
          paddingX={0}
        >
          {snapshot ? (
            <TerminalView snapshot={snapshot} width={termSize.cols} height={termSize.rows} />
          ) : (
            <Text color={theme.muted}>(no active session)</Text>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box height={FOOTER_HEIGHT}>
        <Text color={theme.muted} dimColor>
          {sidebarFocused
            ? 'Ctrl+J/K · Enter focus · / search · Ctrl+N new · Ctrl+D close · Ctrl+Y theme · Ctrl+Q quit'
            : 'Ctrl+H back · Ctrl+J/K switch · keys forward to PTY · Ctrl+Q quit'}
        </Text>
      </Box>

      {modal === 'themePicker' && (
        <Box
          position="absolute"
          marginTop={3}
          marginLeft={Math.max(2, Math.floor(hostSize.cols / 2) - 20)}
        >
          <ThemePicker theme={theme} />
        </Box>
      )}
      {modal === 'fuzzySearch' && (
        <Box
          position="absolute"
          marginTop={3}
          marginLeft={Math.max(2, Math.floor(hostSize.cols / 2) - 25)}
        >
          <FuzzySearch theme={theme} />
        </Box>
      )}
    </Box>
  );
}
