// A starter for the lock tests: waits for a given moment, tries to take the data folder's lock, says what happened, and
// (if it won) keeps holding the lock until its input is closed. Started by hub.test.ts, never by hand.
// Modes: plain; slow (says PAUSED at the hook between the listing and the link, then waits until the given file exists);
// crash (exits at that hook, with no close). It ends on its own after 60 seconds whatever happens.
import { existsSync, writeSync } from 'node:fs';
import { takeLock } from '../src/lock.ts';

const [dir, startAt, mode = 'plain', arg = ''] = process.argv.slice(2);
setTimeout(() => process.exit(0), 60000);

const say = (text) => writeSync(1, `${text}\n`);
const hooks = {};
if (mode === 'slow') {
  hooks.beforeLink = () => {
    say('PAUSED');
    const until = Date.now() + 30000;
    while (!existsSync(arg) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  };
}
if (mode === 'crash') {
  hooks.beforeLink = () => process.exit(0);
}

while (Date.now() < Number(startAt)) {
  // spin: all the starters of one trial leave the line together
}
try {
  takeLock(dir, () => undefined, hooks);
  say('WON');
} catch {
  say('REFUSED');
}
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
