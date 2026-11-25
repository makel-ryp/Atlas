/** Control, format and line or paragraph separator characters (Unicode Cc, Cf, Zl, Zp). */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Those characters become one space each. */
export function cleanText(s: string): string {
  return s.replace(UNPRINTABLE, ' ');
}

/** The bar and its look-alikes: broken bar, dental click, divides sign, parallel to, box-drawing verticals, full-width bar and the like. */
const BAR_LIKE = /[|¦ǀ∣∥│┃┆┇┊┋╎╏║❘⏐｜￤]/g;

/** Letters that print as nothing: the Hangul fillers and the braille blank. */
const BLANK_LOOKING = /[ᅟᅠㅤﾠ⠀]/g;

/**
 * Text from the file is untrusted: cleaned as above, every bar (and look-alike of the bar) replaced by a space (the formatter puts a bar
 * between a name and the scores, so nothing from a file can put text to the right of it), and capped at
 * 64 code points (never splitting a pair), so a crafted name cannot forge lines or reorder what is shown.
 */
export function safeText(s: string): string {
  return Array.from(cleanText(s).replace(BAR_LIKE, ' ')).slice(0, 64).join('');
}

/**
 * A name as a person's eye would compare it, as far as plain rules can tell: format characters (zero-width
 * characters, the soft hyphen) removed, other control and separator characters turned into spaces, every
 * dash-like character and the minus sign taken as a plain hyphen, compatibility normalisation, accents
 * dropped (decompose, remove combining marks), runs of spaces collapsed, trimmed, lower-cased.
 * Letters from different alphabets that only look alike are not detected. Only the comparison changes;
 * the printed name does not.
 */
export function normalisedName(name: string): string {
  return cleanText(name.replace(/\p{Cf}/gu, ''))
    .replace(BLANK_LOOKING, ' ')
    .replace(/[\p{Pd}−﹣－]/gu, '-')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
