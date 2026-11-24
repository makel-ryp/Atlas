import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
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
  /** Removes the lock file, only if this hub still holds it. */
  release(): void;
}

/**
 * Takes the data folder's lock: the file hub.lock, created with the exclusive flag and holding this process's id.
 * If the file exists and its process is still running, the start is refused and nothing in the folder is touched.
 * If that process is gone the lock is stale: it is replaced and `say` is called once. The messages carry nothing
 * from the file but the process id.
 */
export function takeLock(dir: string, say: (line: string) => void): HeldLock {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, LOCK_NAME);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, `${process.pid}\n`);
      } finally {
        closeSync(fd);
      }
      let held = true;
      return {
        release() {
          if (!held) return;
          held = false;
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
    let pid = NaN;
    try {
      pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    } catch {
      continue; // it vanished between the two calls: try again
    }
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`the data folder holds a ${LOCK_NAME} that cannot be read; if no hub is running, delete that file (the folder is set by SIM_HUB_DATA)`);
    }
    if (isRunning(pid)) {
      throw new Error(`another hub (process ${pid}) is already using this data folder (the SIM_HUB_DATA setting); stop it, or give this one its own folder`);
    }
    say(`${LOCK_NAME}: the hub that held it (process ${pid}) is gone; the stale lock was replaced`);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // another starter removed it first: the next attempt decides
    }
  }
  throw new Error(`could not take ${LOCK_NAME} in the data folder (the SIM_HUB_DATA setting)`);
}
