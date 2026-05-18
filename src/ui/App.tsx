/**
 * Root component. M3 milestone: boot a LocalTmuxBackend, spawn one session
 * (`sh -i`), feed its bytes through PaneTerminal, render the snapshot.
 *
 * Side effects (PTY, tmux, xterm) live in a `useEffect` that runs once;
 * the heavy state (`PaneTerminal`, `SpawnedSession`) is held in `useRef`
 * so React re-renders don't recreate them. Snapshots are pulled at a fixed
 * cadence (30Hz is plenty for a terminal; matches v1's tick rate).
 */

import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { LocalTmuxBackend } from '../daemon/backends/LocalTmuxBackend.ts';
import type { SessionBackend, SpawnedSession } from '../daemon/backends/SessionBackend.ts';
import { PaneTerminal, type Snapshot } from '../daemon/terminal.ts';
import { Terminal } from './Terminal.tsx';

const ROWS = 20;
const COLS = 80;
const SNAPSHOT_FPS = 30;

type Status = 'booting' | 'ready' | 'error';

export function App() {
  const { exit } = useApp();
  const [status, setStatus] = useState<Status>('booting');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const backendRef = useRef<SessionBackend | null>(null);
  const sessionRef = useRef<SpawnedSession | null>(null);
  const paneRef = useRef<PaneTerminal | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const backend = new LocalTmuxBackend({
          socket: 'thurbox-v2',
          session: 'thurbox-v2',
        });
        await backend.checkAvailable();
        await backend.ensureReady();
        if (cancelled) return;
        backendRef.current = backend;

        const session = await backend.spawn({
          windowName: 'demo',
          command: 'sh',
          args: ['-i'],
          rows: ROWS,
          cols: COLS,
          env: { PS1: 'thurbox-v2$ ' },
        });
        if (cancelled) return;
        sessionRef.current = session;

        const pane = new PaneTerminal(ROWS, COLS);
        pane.attach(session.output);
        paneRef.current = pane;
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      paneRef.current?.dispose();
      const s = sessionRef.current;
      const b = backendRef.current;
      if (s && b) {
        b.kill(s.backendId).catch(() => undefined);
      }
    };
  }, []);

  // Sample the snapshot at SNAPSHOT_FPS while a pane exists.
  useEffect(() => {
    if (status !== 'ready') return;
    const id = setInterval(
      () => {
        const pane = paneRef.current;
        if (pane) setSnapshot(pane.snapshot());
      },
      Math.floor(1000 / SNAPSHOT_FPS),
    );
    return () => clearInterval(id);
  }, [status]);

  useInput((input, key) => {
    if (key.ctrl && input === 'q') {
      exit();
      return;
    }
    // For M3 the terminal is read-only — input wiring lands in M6 with key
    // translation (Ctrl+key handling, function-key sequences, etc.). For
    // now any key just dismisses (won't reach here unless we add it).
  });

  if (status === 'booting') {
    return (
      <Box borderStyle="round" borderColor="cyan" padding={1}>
        <Text color="cyan">booting tmux + xterm…</Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
        <Text color="red">error: </Text>
        <Text>{error}</Text>
        <Text dimColor>Ctrl+Q to exit.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">
          thurbox v2
        </Text>
        <Text dimColor> — read-only demo · Ctrl+Q to quit</Text>
      </Box>
      <Box borderStyle="round" borderColor="cyan">
        {snapshot ? (
          <Terminal snapshot={snapshot} width={COLS} />
        ) : (
          <Text dimColor>(no output yet)</Text>
        )}
      </Box>
    </Box>
  );
}
