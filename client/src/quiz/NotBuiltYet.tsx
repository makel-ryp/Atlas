/**
 * A deliberate, honest gap.
 *
 * The shell routes to all nine stages today; only `email` has a real screen. Rather than
 * fake the missing ones (fake data would flow into the engine and produce a fake result
 * that looks real), each unbuilt stage renders this and says what it still needs.
 *
 * DELETE THIS FILE once the last screen lands. If it is still here, something is unbuilt.
 */

export function NotBuiltYet({ title, needs }: { title: string; needs: string }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-dashed border-muted p-6">
      <p className="mb-2 text-xs tracking-[0.2em] text-muted uppercase">Not built yet</p>
      <h2 className="mb-3 text-xl font-bold tracking-tight">{title}</h2>
      <p className="text-sm leading-relaxed text-ink/70">{needs}</p>
    </div>
  );
}
