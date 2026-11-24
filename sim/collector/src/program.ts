import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollectorError, createCollector, statusLine, type Collector, type CollectorOptions } from './collector.js';

export interface Io {
  log(line: string): void;
  error(line: string): void;
  exit(code: number): void;
}

export type Env = Record<string, string | undefined>;

/** `currentRound.dat` in the folder GSPro inside the folder GSPro under the user's AppData\LocalLow. Built at run time. */
export function defaultGsproFile(env: Env): string {
  return join(env.USERPROFILE || homedir(), 'AppData', 'LocalLow', 'GSPro', 'GSPro', 'currentRound.dat');
}

function watchingLine(file: string): string {
  return `sim collector watching this round file: ${file}`;
}

/**
 * Starts the collector from the environment and prints counts and states only, never a name, an id or anything else
 * from GSPro's file. Returns the collector, or undefined after printing why it did not start and asking to exit.
 */
export function startProgram(env: Env, io: Io, overrides: Partial<CollectorOptions> = {}): Collector | undefined {
  const gsproFile = env.SIM_GSPRO_FILE || defaultGsproFile(env);
  const hubUrl = env.SIM_HUB_URL || 'http://127.0.0.1:5077';
  const dataDir = env.SIM_COLLECTOR_DATA || join(dirname(fileURLToPath(import.meta.url)), '..', '.data');
  let announced = false;
  try {
    const collector = createCollector({
      gsproFile,
      dataDir,
      hubUrl,
      onStatus: (s) => {
        if (announced) io.log(statusLine(s));
      },
      onEvent: (e) => {
        if (e === 'not-found') io.log(watchingLine(gsproFile));
        else io.log('sim collector: one unfinished line at the end of the outbox was dropped');
      },
      onError: (e) => {
        io.error(`sim collector stopped: ${e.message}`);
        io.exit(1);
      },
      ...overrides,
    });
    collector.start();
    announced = true;
    io.log('sim collector started: reads the GSPro round file, never writes it, sends to this PC only');
    io.log(watchingLine(gsproFile));
    io.log(statusLine(collector.status()));
    return collector;
  } catch (e) {
    if (e instanceof CollectorError) {
      io.error(`sim collector did not start: ${e.message}`);
    } else {
      // Only the error's name and code, never its content.
      const code = (e as { code?: unknown } | null)?.code;
      const name = e instanceof Error ? e.name : 'Error';
      io.error(`sim collector did not start: ${name}${typeof code === 'string' ? ` ${code}` : ''}`);
    }
    io.exit(1);
    return undefined;
  }
}
