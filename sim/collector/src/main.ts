import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollectorError, createCollector, statusLine } from './collector.js';

// Starts the collector from the environment. It reads GSPro's round file, never writes it, and sends only to this PC.
const gsproFile = process.env.SIM_GSPRO_FILE || join(process.env.USERPROFILE || homedir(), 'AppData', 'LocalLow', 'GSPro', 'currentRound.dat');
const hubUrl = process.env.SIM_HUB_URL || 'http://127.0.0.1:5077';
const dataDir = process.env.SIM_COLLECTOR_DATA || join(dirname(fileURLToPath(import.meta.url)), '..', '.data');

function fail(message: string): never {
  console.error(`sim collector did not start: ${message}`);
  process.exit(1);
}

try {
  const collector = createCollector({
    gsproFile,
    dataDir,
    hubUrl,
    // Counts and states only. Never a name, an id or anything else from the file.
    onStatus: (s) => console.log(statusLine(s)),
    onError: (e) => {
      console.error(`sim collector stopped: ${e.message}`);
      process.exit(1);
    },
  });
  console.log('sim collector started: reads the GSPro round file, never writes it, sends to this PC only');
  collector.start();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => void collector.stop().then(() => process.exit(0)));
  }
} catch (e) {
  fail(e instanceof CollectorError ? e.message : 'unknown error');
}
