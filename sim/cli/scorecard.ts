import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScorecard } from '../core/src/command.js';

// Reads files and prints. No network, no file written. The work is in core/src/command.ts.
const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/gspro-4.1.13/2026-11-23');
const res = runScorecard(process.argv[2], { size: (p) => statSync(p).size, read: (p) => readFileSync(p, 'utf8') }, dir);
if (res.stdout !== '') console.log(res.stdout);
if (res.stderr !== '') console.error(res.stderr);
process.exitCode = res.exitCode;
