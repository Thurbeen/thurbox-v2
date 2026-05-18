/**
 * Theme picker modal. j/k or arrows navigate, Enter selects, Esc closes.
 *
 * Persists the choice through the Zustand store; the store's `setTheme`
 * action propagates to every consumer of `useTheme()` immediately. The
 * SQLite persist hook in App.tsx writes the choice to metadata so it
 * survives restarts.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useApp } from '../store.ts';
import { THEMES, type Theme, themeFor } from './themes.ts';

const KEYS = Object.keys(THEMES);

interface Props {
  theme: Theme;
}

export function ThemePicker({ theme }: Props) {
  const closeModal = useApp((s) => s.closeModal);
  const setTheme = useApp((s) => s.setTheme);
  const current = useApp((s) => s.theme);
  const startIdx = Math.max(0, KEYS.indexOf(current));
  const [cursor, setCursor] = useState(startIdx);

  useInput((input, key) => {
    if (key.escape) {
      closeModal();
      return;
    }
    if (key.return) {
      const sel = KEYS[cursor];
      if (sel) setTheme(sel);
      closeModal();
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((i) => Math.min(KEYS.length - 1, i + 1));
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((i) => Math.max(0, i - 1));
    }
  });

  // Live-preview: render each row in its own theme's accent so the user
  // sees the palette without committing.
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.borderFocused}
      paddingX={2}
      paddingY={1}
      width={40}
    >
      <Text bold color={theme.accent}>
        Pick a theme
      </Text>
      <Text color={theme.muted} dimColor>
        ↑/↓ navigate · Enter select · Esc cancel
      </Text>
      <Box marginTop={1} flexDirection="column">
        {KEYS.map((k, i) => {
          const t = themeFor(k);
          const sel = i === cursor;
          return (
            <Box key={k}>
              <Text color={sel ? t.accent : theme.text} bold={sel}>
                {sel ? '▶ ' : '  '}
                {t.label}
              </Text>
              <Text color={t.muted}> </Text>
              <Text color={t.branch}>●</Text>
              <Text color={t.statusRunning}>●</Text>
              <Text color={t.statusError}>●</Text>
              <Text color={t.accent}>●</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
