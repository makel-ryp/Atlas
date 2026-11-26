import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub } from './server.js';

// Starts the hub from the environment. It listens on 127.0.0.1 only, with no sign-in.
const rawPort = process.env.SIM_HUB_PORT;
const port = rawPort === undefined || rawPort === '' ? 5077 : Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('SIM_HUB_PORT must be a whole number from 1 to 65535');
  process.exit(1);
}
const dataDir = process.env.SIM_HUB_DATA || join(dirname(fileURLToPath(import.meta.url)), '..', '.data');

const hub = createHub({ dataDir, port });
try {
  const a = await hub.listen();
  console.log(`sim hub listening on http://${a.host}:${a.port} (this PC only, no sign-in)`);
} catch (e) {
  console.error(`sim hub did not start: ${e instanceof Error ? e.message : 'unknown error'}`);
  process.exit(1);
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void hub.close().then(() => process.exit(0)));
}
