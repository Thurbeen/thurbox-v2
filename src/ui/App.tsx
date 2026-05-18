import { Box, Text, useApp, useInput } from 'ink';
import { useState } from 'react';

export function App() {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);

  useInput((input, key) => {
    if (key.ctrl && input === 'q') exit();
    if (input === ' ') setTick((n) => n + 1);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">
        thurbox v2
      </Text>
      <Text dimColor>TypeScript · Ink · Bun · tmux-persistent</Text>
      <Box marginTop={1}>
        <Text>Edit </Text>
        <Text color="yellow">src/ui/App.tsx</Text>
        <Text> and save — Bun&apos;s --hot will redraw this box.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>tick: </Text>
        <Text color="green">{tick}</Text>
        <Text dimColor> (Space to bump · Ctrl+Q to quit)</Text>
      </Box>
    </Box>
  );
}
