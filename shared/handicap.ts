/**
 * The one place that knows how a handicap index crosses the wire and how it is shown.
 *
 * ── The convention, because it is the whole reason this file exists ──────────────────────────
 * A handicap index BETTER than scratch is stored as a NEGATIVE number and WRITTEN with a plus:
 * an index of -2.1 is "a plus 2.1 handicap", printed `+2.1`. The sign flips between storage and
 * display, which is exactly the kind of rule that gets re-derived slightly differently in each
 * file until two screens disagree.
 *
 * ── What went wrong without it (2026-09-01, user test) ──────────────────────────────────────
 * `ProfileStage.hcpForEngine` correctly normalised "+2.1" to the string "-2.1" and the intake
 * stored it. Then the completion handler tested it with `/^\d+(\.\d+)?$/`, which does not match a
 * leading minus — so `hcpNumeric` came back null and the value was written to NEITHER
 * `golf.player_profile` NOR `golf.handicap_history`. The golfer typed their handicap, the intake
 * accepted it, and the dashboard silently kept the old number. Reported as "the dashboard is
 * defaulting my + to disappear next to my handicap", which is precisely what happened.
 *
 * A wrong number in front of a coach is the worst thing this product can produce (HANDOFF §6), so
 * parsing and formatting live together here rather than being spelled out at each call site.
 */

/** Widest sane index: +10 (better than scratch) through 54, the USGA maximum. */
const PLUS_LIMIT = -10
const MAX_INDEX = 54

/**
 * Anything a golfer or the client can send → a signed number, or null.
 *
 * Accepts `"4.2"`, `"-2.1"` (the client's normalised plus handicap), `"+2.1"` (what a person
 * types) and a bare number. Returns null for the sentinels ("I don't have one") and for anything
 * that is not a number — null means "no index", never zero, because zero is scratch.
 */
export function parseHandicapIndex(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s === '') return null
  // A leading '+' means BETTER than scratch, so it becomes negative.
  if (!/^[+-]?\d{1,3}(\.\d+)?$/.test(s)) return null
  const n = s.startsWith('+') ? -Number(s.slice(1)) : Number(s)
  return Number.isFinite(n) ? n : null
}

/** True for an index inside the range a real golfer can hold. Advisory — never a signup gate. */
export function isPlausibleIndex(n: number): boolean {
  return n >= PLUS_LIMIT && n <= MAX_INDEX
}

/**
 * A signed index → what a golfer expects to read. -2.1 → "+2.1", 4.2 → "4.2", 0 → "0.0".
 * Null/absent → the caller's placeholder, so this never invents a number.
 */
export function formatHandicapIndex(value: string | number | null | undefined): string | null {
  const n = parseHandicapIndex(value ?? null)
  if (n === null) return null
  const shown = Math.abs(n).toFixed(1)
  return n < 0 ? `+${shown}` : shown
}
