/**
 * Sidebar listing all sessions.
 *
 * Selection is driven by the Zustand store (`activeSessionId`). When the
 * sidebar is focused, Ctrl+J / Ctrl+K move selection; pressing `/` opens
 * the fuzzy search modal.
 */

import { Box, Text } from 'ink';
import { useApp } from '../store.ts';
import { type Theme, themeFor } from './themes.ts';

interface Props {
  theme: Theme;
  /** Active when this panel has focus. */
  focused: boolean;
  /** Pre-filtered list (when fuzzy search is active) or undefined to show all. */
  filtered?: ReturnType<typeof useApp.getState>['sessions'];
  /** Outer width in cells, including the border. */
  width: number;
}

export function SessionList({ theme, focused, filtered, width }: Props) {
  const sessions = useApp((s) => s.sessions);
  const activeId = useApp((s) => s.activeSessionId);
  const visible = filtered ?? sessions;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? theme.borderFocused : theme.borderUnfocused}
      paddingX={1}
      width={width}
    >
      <Text bold color={focused ? theme.accent : theme.text}>
        Sessions
      </Text>
      {visible.length === 0 ? (
        <Text color={theme.muted} dimColor>
          (none — Ctrl+N to create)
        </Text>
      ) : (
        visible.map((s) => (
          <Row
            key={s.id}
            theme={theme}
            name={s.name}
            role={s.role}
            branch={s.branch}
            status={s.status}
            active={s.id === activeId}
          />
        ))
      )}
    </Box>
  );
}

function Row({
  theme,
  name,
  role,
  branch,
  status,
  active,
}: {
  theme: Theme;
  name: string;
  role: string | null;
  branch: string | null;
  status: 'Running' | 'Idle' | 'Error';
  active: boolean;
}) {
  const pillColor =
    status === 'Running'
      ? theme.statusRunning
      : status === 'Error'
        ? theme.statusError
        : theme.statusIdle;
  return (
    <Box>
      <Text color={active ? theme.accent : theme.text} bold={active}>
        {active ? '▶ ' : '  '}
        {name}
      </Text>
      {role && (
        <>
          <Text color={theme.muted}> · </Text>
          <Text color={theme.muted}>{role}</Text>
        </>
      )}
      {branch && (
        <>
          <Text color={theme.muted}> </Text>
          <Text color={theme.branch}>[{branch}]</Text>
        </>
      )}
      <Text color={theme.muted}> </Text>
      <Text color={pillColor}>●</Text>
    </Box>
  );
}

/**
 * Convenience hook for the active theme — keeps the type plumbing tidy at
 * call sites.
 */
export function useTheme(): Theme {
  const themeKey = useApp((s) => s.theme);
  return themeFor(themeKey);
}
