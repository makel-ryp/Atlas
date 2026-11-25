import { closeSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export const LOCK_NAME = 'hub.lock';

/**
 * Test hooks, called at fixed points of takeLock so a test can make another starter's work happen in between. Nothing outside the
 * tests passes them: createHub does not, and no setting or environment variable turns them on.
 */
export interface LockHooks {
  /** Between the listing and the read of the current lock. */
  beforeRead?: () => void;
  /** After the temporary file is written, just before the link. */
  beforeLink?: () => void;
  /** Right after a successful link, before the temporary file is removed. */
  afterLink?: (target: string) => void;
}

/**
 * The lock's look has three answers. HELD: the file was read and holds this hub's id and token. GONE: the file is not there (ENOENT), or it
 * was read and holds anything else. CANNOT TELL: the read failed for any other reason (EBUSY, EPERM, EACCES and every other code): another
 * program may be holding the file for a moment. Nothing but a successful read of this hub's own content is ever held.
 */
export type LockLook = { state: 'held' } | { state: 'gone' } | { state: 'cannot'; code: string };

export interface HeldLock {
  /** The lock file's name (never its path). */
  readonly name: string;
  /**
   * Looks at the lock once, with no pause and no second try (the bay program sends the post again, and that is the second try).
   * `read` is a replaceable read of the file, for tests only: reachable only through a hand-built call to createHub.
   */
  look(read?: (path: string) => string): LockLook;
  /** Removes this hub's own lock file, only if it still holds this hub's own process id and token. */
  release(): void;
  /** True while this hub's own lock file is still there and still holds this hub's own process id and token. */
  stillHeld(): boolean;
}

/** The tokens of the locks the hubs of THIS process hold. A lock naming this process with any other token is a leftover. */
const heldTokens = new Set<string>();

/** A lock number above this is not followed: something other than this hub made it. */
const MAX_LOCK_NUMBER = 1_000_000_000;

/** A refusal with a plain message. It names a file by its name only, never the data folder's path. */
class LockRefused extends Error {}

const NUMBERED = /^hub\.lock\.([1-9][0-9]*)$/;
const TEMPORARY = /^hub\.lock\.tmp-([0-9]+)-/;
const CONTENT = /^([1-9][0-9]*) ([0-9a-f]{24})\n$/;

/** True when a process with this id is running (a process we may not signal still counts as running). */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function codeOf(e: unknown): string {
  const c = (e as NodeJS.ErrnoException | undefined)?.code;
  return typeof c === 'string' ? c : 'error';
}

/** The numbers of the lock files in the folder, highest first. Other names (a plain hub.lock, hub.lock.takeover) are not locks. */
function lockNumbers(dir: string): number[] {
  const out: number[] = [];
  for (const name of readdirSync(dir)) {
    const m = NUMBERED.exec(name);
    if (m !== null) {
      const n = Number(m[1]);
      if (Number.isSafeInteger(n)) out.push(n);
    }
  }
  return out.sort((a, b) => b - a);
}

/**
 * Takes the data folder's lock. The lock is a numbered series of files, hub.lock.<n>; the current lock is the one with the
 * highest n, and no file is ever deleted and re-created under the same name. A starter lists the folder; with no lock the
 * target is 1; with a lock whose holder is running it is refused; with a lock whose holder is gone the target is n + 1.
 * It writes its whole lock (process id and token) to a temporary file of its own and then makes the target with a hard link,
 * which is created whole or not at all and fails if the name is taken, so a lock file is never seen half-written and only
 * one starter can ever create a given number. If the name was taken, the starter starts again from the listing.
 *
 * Nothing of this takes a file name from the folder and prints a path: a failure is a plain message with a file's name.
 */
export function takeLock(dir: string, say: (line: string) => void, hooks?: LockHooks): HeldLock {
  try {
    return takeNumberedLock(dir, say, hooks);
  } catch (e) {
    if (e instanceof LockRefused) throw e;
    // a file-system error that is not a race: a plain refusal, with no path in it
    throw new LockRefused(`could not take the lock in the data folder (${codeOf(e)}); check the folder set by SIM_HUB_DATA`);
  }
}

function takeNumberedLock(dir: string, say: (line: string) => void, hooks?: LockHooks): HeldLock {
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(12).toString('hex');
  const mine = `${process.pid} ${token}\n`;
  const giveUpAt = Date.now() + 5000;
  // What the last look-again was for, so that the refusal after five seconds can say what kept coming. On Windows a file another
  // starter is deleting or linking fails with EPERM or EACCES for a moment: those are races and are looked at again.
  let lastRead: { name: string; code: string } | undefined;
  let lastLink: { name: string; code: string } | undefined;
  const giveUp = (): LockRefused => {
    if (lastLink !== undefined) {
      return new LockRefused(`another hub is starting on this data folder (the SIM_HUB_DATA setting), or the folder cannot hold hard links (${lastLink.code}, ${lastLink.name})`);
    }
    if (lastRead !== undefined) {
      return new LockRefused(`${lastRead.name} cannot be read (${lastRead.code}); if no hub is running, delete it (the folder is set by SIM_HUB_DATA)`);
    }
    return new LockRefused('another hub is starting on this data folder (the SIM_HUB_DATA setting); try again in a moment');
  };
  for (;;) {
    if (Date.now() > giveUpAt) throw giveUp();
    const numbers = lockNumbers(dir);
    let target = 1;
    let replaced: number | undefined;
    let leftoverOwn: string | undefined;
    const current = numbers[0];
    if (current !== undefined) {
      const name = `${LOCK_NAME}.${current}`;
      if (current > MAX_LOCK_NUMBER) {
        throw new LockRefused(`${name} has a number too large to follow; a hub may be running under that lock and must be stopped first; then delete ${name} and start again (the folder is set by SIM_HUB_DATA)`);
      }
      let text: string;
      try {
        hooks?.beforeRead?.();
        text = readFileSync(join(dir, name), 'utf8');
      } catch (e) {
        if (codeOf(e) === 'ENOENT' || codeOf(e) === 'EPERM') {
          // its hub just let go of it (on Windows a file being deleted may answer EPERM): look again from the listing
          lastRead = { name, code: codeOf(e) };
          pause(10);
          continue;
        }
        throw new LockRefused(`${name} cannot be read (${codeOf(e)}); if no hub is running, delete it (the folder is set by SIM_HUB_DATA)`);
      }
      const m = CONTENT.exec(text);
      if (m === null) throw new LockRefused(`${name} is not a lock this hub wrote; if no hub is running, delete it (the folder is set by SIM_HUB_DATA)`);
      const pid = Number(m[1]);
      if (pid === process.pid && !heldTokens.has(m[2] as string)) {
        // this very process, but no hub in it holds that token: nothing here can be the holder, so it is a leftover of an earlier run
        leftoverOwn = name;
      } else if (isRunning(pid)) {
        // the id of a running process is all the lock can tell: it cannot say whether that process is a hub
        throw new LockRefused(
          `${name} says process ${pid} holds this data folder (the SIM_HUB_DATA setting). If ${pid} is a hub, stop it or give this hub its own folder. If the PC restarted or the hub crashed, ${pid} may be another program: stop nothing, delete ${name} and start again.`,
        );
      }
      target = current + 1;
      replaced = pid;
    }
    const targetName = `${LOCK_NAME}.${target}`;
    const tmpName = `${LOCK_NAME}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    const tmpPath = join(dir, tmpName);
    const fd = openSync(tmpPath, 'wx');
    try {
      writeSync(fd, mine);
    } finally {
      closeSync(fd);
    }
    let linked = false;
    try {
      hooks?.beforeLink?.();
      linkSync(tmpPath, join(dir, targetName));
      linked = true;
      hooks?.afterLink?.(join(dir, targetName));
    } catch (e) {
      if (codeOf(e) === 'EPERM' || codeOf(e) === 'EACCES') {
        lastLink = { name: targetName, code: codeOf(e) }; // a name still being deleted, or a folder with no hard links: look again, and say so if it persists
      } else if (codeOf(e) !== 'EEXIST') {
        throw new LockRefused(`the file system of the data folder refused to make ${targetName} (${codeOf(e)}); the lock needs hard links, so this folder cannot be used (set SIM_HUB_DATA to another)`);
      }
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // already gone
      }
    }
    if (!linked) {
      pause(10); // the name was taken by another starter: start again from the listing
      continue;
    }
    // THE RE-LIST: NEITHER THIS CHECK NOR THE KEPT PREDECESSOR IN cleanUp MAY BE REMOVED; EACH COVERS A CASE THE OTHER DOES NOT.
    // A starter whose listing is two or more generations old aims at a number that later clean-ups have since removed, so its link to that
    // free name succeeds although a newer lock (the live hub's) exists. The kept predecessor cannot help it. Only this look after the link
    // can: if a higher number exists, this lock is not the current one, so it is given back and the starter starts again from the listing
    // (and then finds the live holder and is refused). Tested with a starter that sleeps at the beforeLink hook while generations pass.
    if ((lockNumbers(dir)[0] ?? target) > target) {
      try {
        if (readFileSync(join(dir, targetName), 'utf8') === mine) unlinkSync(join(dir, targetName));
      } catch {
        // gone already
      }
      continue;
    }
    cleanUp(dir, target);
    if (leftoverOwn !== undefined) say(`${leftoverOwn} named this very process with a token no hub here holds: a leftover of an earlier run; its lock was replaced`);
    else if (replaced !== undefined) say(`${LOCK_NAME}: the hub that held the last lock (process ${replaced}) is gone; its lock was replaced`);
    heldTokens.add(token);
    return {
      release() {
        // only this hub's own number, and only while it still holds this hub's id and token: another hub's lock is left alone
        heldTokens.delete(token);
        const path = join(dir, targetName);
        try {
          if (readFileSync(path, 'utf8') !== mine) return;
          unlinkSync(path);
        } catch {
          // already gone
        }
      },
      name: targetName,
      look(read = (path: string): string => readFileSync(path, 'utf8')): LockLook {
        try {
          return read(join(dir, targetName)) === mine ? { state: 'held' } : { state: 'gone' };
        } catch (e) {
          const code = codeOf(e);
          return code === 'ENOENT' ? { state: 'gone' } : { state: 'cannot', code };
        }
      },
      stillHeld() {
        return this.look().state === 'held';
      },
    };
  }
}

/**
 * The winner of number n removes every lock lower than n - 1, and the temporary files of starters that are gone. It keeps n - 1 on
 * purpose, for ONE of the two reasons the lock is safe: while lock n is held, lock n - 1 exists, so a folder listing taken while n was
 * being created always shows at least n - 1, and that starter's link to n fails because n is taken. (Were n - 1 removed too, such a
 * starter could aim at n - 1, find the name free and link it.) The OTHER reason is the re-list after the link in takeNumberedLock, which
 * covers a starter whose listing is two or more generations old. Neither may be removed.
 */
function cleanUp(dir: string, n: number): void {
  try {
    for (const name of readdirSync(dir)) {
      const numbered = NUMBERED.exec(name);
      const tmp = TEMPORARY.exec(name);
      const remove = (numbered !== null && Number(numbered[1]) < n - 1) || (tmp !== null && Number(tmp[1]) !== process.pid && !isRunning(Number(tmp[1])));
      if (!remove) continue;
      try {
        unlinkSync(join(dir, name));
      } catch {
        // another starter is removing it too
      }
    }
  } catch {
    // clean-up is best effort: a file another starter is removing too is not a failure
  }
}
