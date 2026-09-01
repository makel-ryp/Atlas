/**
 * A glance back before committing — §3: "Review step before each result (edit any answer
 * before scoring)."
 *
 * Cheap to build and worth it: it's the last moment a golfer can correct a mis-tap, and a
 * mis-tap on a 12-item instrument moves the result. Tapping a row jumps back to that
 * question rather than opening a separate editor, so there's one way to answer a question,
 * not two.
 */

import type { Answers } from './contract';
import { LIKERT_LABELS, type QuizItem } from '../../../shared/practice-dna/items';

/** How a stored answer reads back to a human. Mirrors the controls in QuestionControls. */
function answerText(item: QuizItem, value: Answers[string] | undefined): string {
  if (value === undefined) return 'Not answered';
  if (typeof value !== 'number') return '—'; // alloc, which this runner never asks

  switch (item.type) {
    case 'likert':
      // Stored 0/25/50/75/100 → back to the label the golfer actually tapped.
      return LIKERT_LABELS[Math.round(value / 25)] ?? String(value);
    case 'stepper':
      return value >= 7 ? '7+ times a week' : `${value} times a week`;
    case 'bipolar':
      return item.poles ? `${value} — ${item.poles.left} ↔ ${item.poles.right}` : String(value);
    default:
      return String(value);
  }
}

export function ReviewStep({
  items,
  answers,
  busy,
  doneLabel,
  onEdit,
  onConfirm,
}: {
  items: QuizItem[];
  answers: Answers;
  busy: boolean;
  doneLabel: string;
  onEdit: (index: number) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mx-auto max-w-md">
      <p className="mb-2 text-xl leading-snug font-medium">Before we score it — look right?</p>
      <p className="mb-8 text-sm text-muted">Tap any answer to change it.</p>

      <ul className="mb-8 divide-y divide-ink/10">
        {items.map((item, i) => (
          <li key={item.code}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onEdit(i)}
              className="w-full py-3 text-left transition-colors hover:bg-ink/5 disabled:opacity-50"
            >
              <span className="block text-sm leading-snug text-ink/70">{item.text}</span>
              <span className="mt-0.5 block text-sm font-medium">
                {answerText(item, answers[item.code])}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className="w-full rounded-lg bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40"
      >
        {busy ? 'Scoring…' : doneLabel}
      </button>
    </div>
  );
}
