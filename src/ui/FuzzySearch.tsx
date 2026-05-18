/**
 * Fuzzy session search. Triggered by `/` on the session list; types into a
 * single-line field, Enter selects the top match and focuses the terminal,
 * Esc cancels.
 *
 * Indexes against name + role + branch + cwd so the user can hit by any
 * attribute — same fields v1 indexes.
 */

import Fuse from 'fuse.js';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { type SessionEntry, useApp } from '../store.ts';
import type { Theme } from './themes.ts';

interface Props {
  theme: Theme;
}

export function FuzzySearch({ theme }: Props) {
  const sessions = useApp((s) => s.sessions);
  const closeModal = useApp((s) => s.closeModal);
  const setActiveSession = useApp((s) => s.setActiveSession);
  const focus = useApp((s) => s.focus);
  const [query, setQuery] = useState('');

  const fuse = new Fuse(sessions, {
    keys: ['name', 'role', 'branch', 'cwd'],
    threshold: 0.4,
    ignoreLocation: true,
  });
  const matches: SessionEntry[] =
    query.length === 0 ? sessions : fuse.search(query).map((r) => r.item);

  useInput((input, key) => {
    if (key.escape) {
      closeModal();
      return;
    }
    if (key.return) {
      const first = matches[0];
      if (first) {
        setActiveSession(first.id);
        focus('terminal');
      }
      closeModal();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.borderFocused}
      paddingX={2}
      paddingY={1}
      width={50}
    >
      <Text bold color={theme.accent}>
        Find session
      </Text>
      <Box>
        <Text color={theme.muted}>{'> '}</Text>
        <Text color={theme.text}>{query}</Text>
        <Text color={theme.accent}>▏</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {matches.length === 0 ? (
          <Text color={theme.muted} dimColor>
            no matches
          </Text>
        ) : (
          matches.slice(0, 8).map((m, i) => (
            <Box key={m.id}>
              <Text color={i === 0 ? theme.accent : theme.text} bold={i === 0}>
                {i === 0 ? '▶ ' : '  '}
                {m.name}
              </Text>
              {m.role && <Text color={theme.muted}> · {m.role}</Text>}
              {m.branch && <Text color={theme.branch}> [{m.branch}]</Text>}
            </Box>
          ))
        )}
      </Box>
      <Text color={theme.muted} dimColor>
        Enter to jump · Esc to cancel
      </Text>
    </Box>
  );
}
