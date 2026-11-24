import type { HoleScore, RoundBook, RoundScore } from './book.js';
import { safeText } from './text.js';

const REVIEW = ' (needs review)';

function holeText(h: HoleScore): string {
  const mark = h.needsReview ? REVIEW : '';
  if (h.status === 'in_play') {
    return `hole ${h.hole}: in play (${h.strokesSoFar} ${h.strokesSoFar === 1 ? 'stroke' : 'strokes'})${mark}`;
  }
  return `hole ${h.hole}: ${h.strokes}${mark}`;
}

/**
 * Plain text, one line per player per round, under a line naming the round. Every player line starts with
 * the player's number in the round (P1, P2, ...), so two lines in one round are never identical and no part
 * of an id is printed.
 */
export function formatScorecard(source: RoundBook | readonly RoundScore[]): string {
  const rounds: readonly RoundScore[] = Array.isArray(source) ? source : (source as RoundBook).rounds();
  const lines: string[] = [];
  for (const r of rounds) {
    lines.push(`Round ${r.roundId}  ${r.courseKeys.map(safeText).join(' / ')}${r.needsReview ? `  ${REVIEW.trim()}` : ''}`);
    for (const p of r.players) {
      const parts = p.holes.map(holeText);
      parts.push(`total ${p.total}${p.needsReview ? REVIEW : ''}`);
      lines.push(`P${p.playerNumber} ${safeText(p.name)} | ${parts.join('  ')}`);
    }
  }
  const range = !Array.isArray(source) ? (source as RoundBook).rangeShots : 0;
  if (range > 0) lines.push(`Practice range shots (in no round): ${range}`);
  return lines.join('\n');
}
