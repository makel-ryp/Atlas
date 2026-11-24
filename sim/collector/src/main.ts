import { startProgram } from './program.js';

// Starts the collector from the environment (SIM_GSPRO_FILE, SIM_HUB_URL, SIM_COLLECTOR_DATA). It reads GSPro's
// round file, never writes it, and sends only to this PC.
const collector = startProgram(process.env, {
  log: (l) => console.log(l),
  error: (l) => console.error(l),
  exit: (n) => process.exit(n),
});
if (collector) {
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => void collector.stop().then(() => process.exit(0)));
  }
}
