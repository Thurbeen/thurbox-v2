/**
 * Ink renderer for a terminal pane snapshot.
 *
 * Each row becomes a `<Box>` containing one `<Text>` per styled run. We
 * never re-render the whole grid as one string; the per-run breakdown gives
 * ratatui-style color/bold/italic at near-zero cost, and React's reconciler
 * keeps redraws cheap because untouched runs stay equal-by-reference.
 */

import { Box, Text } from 'ink';
import type { CellRun, Snapshot } from '../daemon/terminal.ts';

interface Props {
  snapshot: Snapshot;
  /** Optional fixed height; if omitted the box grows with rows. */
  height?: number;
  /** Optional fixed width — typically the cols passed to PaneTerminal. */
  width?: number;
}

export function Terminal({ snapshot, height, width }: Props) {
  return (
    <Box flexDirection="column" height={height} width={width}>
      {snapshot.rows.map((row, y) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: row index is stable for a fixed-size grid
        <Box key={y}>
          {row.runs.length === 0 ? (
            <Text> </Text>
          ) : (
            row.runs.map((run, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: run index is stable per-row
              <RunText key={i} run={run} />
            ))
          )}
        </Box>
      ))}
    </Box>
  );
}

function RunText({ run }: { run: CellRun }) {
  // Ink's `dimColor` is a separate boolean, not an opacity — apply only when
  // dim is set so default text doesn't get washed out.
  return (
    <Text
      color={run.color}
      backgroundColor={run.backgroundColor}
      bold={run.bold}
      italic={run.italic}
      underline={run.underline}
      inverse={run.inverse}
      dimColor={run.dim}
    >
      {run.text}
    </Text>
  );
}
