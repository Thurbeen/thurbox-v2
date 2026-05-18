import { render } from 'ink';
import { App } from './ui/App.tsx';

// Enter the alternate screen buffer so the TUI takes over the whole
// terminal and we can fully restore the user's shell scrollback on exit.
// (Ink doesn't do this by default — it just renders inline.)
// Only enter if we're attached to an actual TTY; under `script` or pipes
// we leave the user's screen alone.
const isTty = process.stdout.isTTY;
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';

if (isTty) process.stdout.write(ENTER_ALT_SCREEN);

const cleanup = () => {
  if (isTty) process.stdout.write(LEAVE_ALT_SCREEN);
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

render(<App />);
