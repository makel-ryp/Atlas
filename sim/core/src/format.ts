import type { HoleScore, RoundBook, RoundScore } from './book.js';

const REVIEW = ' (needs review)';

/**
 * Text from the file is untrusted: control, format and line or paragraph separator characters
 * (Unicode Cc, Cf, Zl, Zp) become one space each, and the length is capped at 64 code points
 * (never splitting a pair), so a crafted name cannot forge lines or reorder what is shown.
 */
function safeText(s: string): string {
  return Array.from(s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')).slice(0, 64).join('');
}

function holeText(h: HoleScore): string {
  const mark = h.needsReview ? REVIEW : '';
  if (h.status === 'in_play') {
    return `hole ${h.hole}: in play (${h.strokesSoFar} ${h.strokesSoFar === 1 ? 'stroke' : 'strokes'})${mark}`;
  }
  return `hole ${h.hole}: ${h.strokes}${mark}`;
}

/** Plain text, one line per player per round, under a line naming the round. */
export function formatScorecard(source: RoundBook | readonly RoundScore[]): string {
  const rounds: readonly RoundScore[] = Array.isArray(source) ? source : (source as RoundBook).rounds();
  const lines: string[] = [];
  for (const r of rounds) {
    lines.push(`Round ${r.roundId}  ${r.courseKeys.map(safeText).join(' / ')}${r.needsReview ? `  ${REVIEW.trim()}` : ''}`);
    const shown = r.players.map((p) => safeText(p.name));
    for (const [i, p] of r.players.entries()) {
      const parts = p.holes.map(holeText);
      parts.push(`total ${p.total}${p.needsReview ? REVIEW : ''}`);
      // two players with one name: the last four characters of the id tell the lines apart
      const sameName = shown.filter((n) => n === shown[i]).length > 1;
      const name = sameName ? `${shown[i]} [${safeText(Array.from(p.userGuid).slice(-4).join(''))}]` : shown[i];
      lines.push(`${name}  ${parts.join('  ')}`);
    }
  }
  const range = !Array.isArray(source) ? (source as RoundBook).rangeShots : 0;
  if (range > 0) lines.push(`Practice range shots (in no round): ${range}`);
  return lines.join('\n');
}
