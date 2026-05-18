/**
 * M2 acceptance smoke test:
 *  - Spawn a tmux pane running `echo HELLO; sleep 30`
 *  - Read the pane's output through control mode
 *  - Assert HELLO_FROM_TMUX appears
 *  - Discover the session and verify it shows up
 *  - Kill it cleanly and tear down the test server
 *
 * Uses an isolated tmux socket (`thurbox-v2-smoke`) so it doesn't collide
 * with the user's v1 `thurbox` socket.
 *
 * Run: bun run scripts/smoke-tmux.ts (or `npx tsx scripts/smoke-tmux.ts`)
 */
import { spawnSync } from 'node:child_process';
import { LocalTmuxBackend } from '../src/daemon/backends/LocalTmuxBackend.ts';

const TEST_SOCKET = 'thurbox-v2-smoke';
const TEST_SESSION = 'thurbox-v2-smoke';

function killServer(): void {
  spawnSync('tmux', ['-L', TEST_SOCKET, 'kill-server'], { stdio: 'ignore' });
}

killServer();

const backend = new LocalTmuxBackend({ socket: TEST_SOCKET, session: TEST_SESSION });
await backend.checkAvailable();
await backend.ensureReady();
console.log('[smoke] control mode booted');

const session = await backend.spawn({
  windowName: 'smoke',
  command: 'sh',
  args: ['-c', 'echo HELLO_FROM_TMUX; exec sleep 30'],
  rows: 24,
  cols: 80,
});
console.log(`[smoke] spawned pane ${session.backendId}`);

let collected = '';
const deadline = Date.now() + 5000;
for await (const chunk of session.output) {
  collected += new TextDecoder().decode(chunk);
  if (collected.includes('HELLO_FROM_TMUX')) {
    console.log('[smoke] OK — saw HELLO_FROM_TMUX in output');
    break;
  }
  if (Date.now() > deadline) {
    console.error('[smoke] TIMEOUT waiting for HELLO_FROM_TMUX');
    killServer();
    process.exit(1);
  }
}

const sessions = await backend.discover();
const found = sessions.find((s) => s.name === 'smoke');
if (!found) {
  console.error('[smoke] FAIL — discover() did not list our session');
  console.error('[smoke] discover returned:', sessions);
  killServer();
  process.exit(1);
}
console.log(`[smoke] discover() found: ${JSON.stringify(found)}`);

await backend.kill(session.backendId);
await backend.shutdown();
killServer();
console.log('[smoke] all checks passed');
process.exit(0);
