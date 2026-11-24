import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatScorecard, issuesLine, loadRecording, type BookIssue, type RoundScore } from '../../core/src/index.js';

const RECORDING = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');

/** Posts the recorded copies in order to a running hub, then reads /v0/rounds and returns the scorecard text. */
export async function runReplay(baseUrl: string): Promise<string> {
  const base = baseUrl.replace(/\/+$/, '');
  for (const copy of loadRecording(RECORDING)) {
    const res = await fetch(`${base}/v0/shots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: copy.records }),
    });
    await res.arrayBuffer();
    if (res.status !== 200) throw new Error(`copy ${copy.number}: the hub answered ${res.status}`);
  }
  const res = await fetch(`${base}/v0/rounds`);
  if (res.status !== 200) throw new Error(`/v0/rounds: the hub answered ${res.status}`);
  const data = (await res.json()) as { rounds: RoundScore[]; rangeShots: number; issues: BookIssue[] };
  const lines = [formatScorecard(data.rounds)];
  if (data.rangeShots > 0) lines.push(`Practice range shots (in no round): ${data.rangeShots}`);
  const extra = issuesLine(data.issues);
  if (extra !== undefined) lines.push(extra);
  return lines.join('\n');
}

const argv = process.argv.slice(2);
let url = 'http://127.0.0.1:5077';
const at = argv.indexOf('--url');
if (at >= 0) {
  const v = argv[at + 1];
  if (v === undefined) {
    console.error('--url needs a value');
    process.exit(1);
  }
  url = v;
}
try {
  console.log(await runReplay(url));
} catch (e) {
  console.error(`replay failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  process.exit(1);
}
