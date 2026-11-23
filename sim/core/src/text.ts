/** Control, format and line or paragraph separator characters (Unicode Cc, Cf, Zl, Zp). */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Those characters become one space each. */
export function cleanText(s: string): string {
  return s.replace(UNPRINTABLE, ' ');
}

/**
 * Text from the file is untrusted: cleaned as above and capped at 64 code points (never splitting a pair),
 * so a crafted name cannot forge lines or reorder what is shown.
 */
export function safeText(s: string): string {
  return Array.from(cleanText(s)).slice(0, 64).join('');
}

/**
 * A name as a person's eye would compare it, as far as plain rules can tell: cleaned as the formatter does,
 * Unicode compatibility normalisation (NFKC), runs of spaces collapsed, trimmed, lower-cased.
 * Letters from different alphabets that only look alike are not detected.
 */
export function normalisedName(name: string): string {
  return cleanText(name).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}
