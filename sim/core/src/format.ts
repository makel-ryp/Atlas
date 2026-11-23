import type { HoleScore, RoundBook, RoundScore } from './book.js';

/** Text from the file is untrusted: control characters become spaces and the length is capped, so a crafted name cannot forge lines. */
function safeText(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 64);
}

function holeText(h: HoleScore): string {
  if (h.status === 'in_play') {
    return `hole ${h.hole}: in play (${h.strokesSoFar} ${h.strokesSoFar === 1 ? 'stroke' : 'strokes'})`;
  }
  return `hole ${h.hole}: ${h.strokes}${h.needsReview ? ' (needs review)' : ''}`;
}

/** Plain text, one line per player per round, under a line naming the round. */
export function formatScorecard(source: RoundBook | readonly RoundScore[]): string {
  const rounds: readonly RoundScore[] = Array.isArray(source) ? source : (source as RoundBook).rounds();
  const lines: string[] = [];
  for (const r of rounds) {
    lines.push(`Round ${r.roundId}  ${r.courseKeys.map(safeText).join(' / ')}${r.needsReview ? '  (needs review: more than one course)' : ''}`);
    for (const p of r.players) {
      const parts = p.holes.map(holeText);
      parts.push(`total ${p.total}`);
      lines.push(`${safeText(p.name)}  ${parts.join('  ')}`);
    }
  }
  const range = !Array.isArray(source) ? (source as RoundBook).rangeShots : 0;
  if (range > 0) lines.push(`Practice range shots (in no round): ${range}`);
  return lines.join('\n');
}
