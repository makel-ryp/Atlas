import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export const LOCK_NAME = 'hub.lock';

/** True when a process with this id is running (a process we may not signal still counts as running). */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface HeldLock {
  /** Removes the lock file, only if it still holds this hub's own process id and token. */
  release(): void;
}

function readLock(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Takes the data folder's lock: the file hub.lock, created with the exclusive flag, holding this process's id and a
 * token only this hub knows. If the file exists and its process is still running, the start is refused and nothing
 * in the folder is touched.
 *
 * If that process is gone the lock is stale, and only one starter may deal with it. A starter that found it stale never
 * just deletes it and creates its own (two starters could then both win). It first creates hub.lock.takeover, exclusively,
 * so that one starter at a time handles the stale lock; under that guard it checks the file is still the stale lock it
 * read, moves it to a name of its own and removes it, and lets go of the guard. Then every starter tries the exclusive
 * create once more: whoever creates the file holds the lock, anyone else finds a live holder and is refused.
 */
export function takeLock(dir: string, say: (line: string) => void): HeldLock {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, LOCK_NAME);
  const guardFile = `${file}.takeover`;
  const mine = `${process.pid} ${randomBytes(12).toString('hex')}\n`;
  const giveUpAt = Date.now() + 5000;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, mine);
      } finally {
        closeSync(fd);
      }
      return {
        release() {
          // only a lock that is still this hub's own: another hub's lock, or one a person replaced, is left alone
          if (readLock(file) !== mine) return;
          try {
            unlinkSync(file);
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const seen = readLock(file);
    if (seen === undefined) continue; // it vanished between the two calls: try the create again
    const pid = Number.parseInt(seen.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`the data folder holds a ${LOCK_NAME} that cannot be read; if no hub is running, delete that file (the folder is set by SIM_HUB_DATA)`);
    }
    if (isRunning(pid)) {
      throw new Error(`another hub (process ${pid}) is already using this data folder (the SIM_HUB_DATA setting); stop it, or give this one its own folder`);
    }
    // stale: one starter at a time deals with it
    let guard: number;
    try {
      guard = openSync(guardFile, 'wx');
      writeSync(guard, `${process.pid}\n`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (Date.now() > giveUpAt) {
        // the guard has been held far too long: if its holder is gone it is a leftover of a crash
        const holder = Number.parseInt((readLock(guardFile) ?? '').trim(), 10);
        if (Number.isInteger(holder) && holder > 0 && !isRunning(holder)) {
          try {
            unlinkSync(guardFile);
          } catch {
            // already gone
          }
          continue;
        }
        throw new Error('another hub is starting on this data folder (the SIM_HUB_DATA setting); try again in a moment');
      }
      pause(25);
      continue;
    }
    try {
      if (readLock(file) === seen) {
        // still the stale lock that was judged: move it to a name of our own, then remove it
        const aside = `${file}.stale-${process.pid}-${randomBytes(6).toString('hex')}`;
        renameSync(file, aside);
        say(`${LOCK_NAME}: the hub that held it (process ${pid}) is gone; the stale lock was replaced`);
        try {
          unlinkSync(aside);
        } catch {
          // already gone
        }
      }
    } finally {
      closeSync(guard);
      try {
        unlinkSync(guardFile);
      } catch {
        // already gone
      }
    }
  }
}
