// A starter for the lock race test: waits for a given moment, tries to take the data folder's lock, says what happened,
// and (if it won) keeps holding the lock until its input is closed. Started by hub.test.ts, never by hand.
import { takeLock } from '../src/lock.ts';

const [dir, startAt] = process.argv.slice(2);
while (Date.now() < Number(startAt)) {
  // spin: all the starters of one trial leave the line together
}
let said = 'REFUSED';
try {
  takeLock(dir, () => undefined);
  said = 'WON';
} catch {
  said = 'REFUSED';
}
process.stdout.write(`${said}\n`);
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
