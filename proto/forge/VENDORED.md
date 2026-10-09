# FORGE — vendored copy of Luke's delivery

Received **2026-09-30** as `~/Downloads/FORGE-package/`. Committed here **2026-10-09** because that
is not a git repository, nothing was backing it up, and this package is the **contract** the whole
FORGE port is built against. It is also the only copy of `forge-math.js`, which is the one piece of
Luke's delivery that is immediately usable.

## This copy is unmodified except for ONE line, and that line is deliberate

`build/forge-math.test.js:33` — the fixture's **input** changed from `225` to `245`.

The expectation (`7.5`) was always right; the input was wrong. 245 yd is the midpoint of the 10→5
step, not 225. Before the fix the suite was **56 passed, 1 failed**; after it:

```
57 passed, 0 failed
```

This was one of three disagreeing answers for `baselineHandicap(225)` — the Build Spec's §2.3 step
table said **15**, `forge-math.js` interpolates to **12.5**, the fixture expected **7.5**. Makel
signed off interpolation on 2026-10-07 and **Build Spec §2.3 is amended**, so the module is correct
and unchanged. See [`FORGE-ON-RYP-CORE.md`](../../docs/FORGE-ON-RYP-CORE.md)'s supersession table.

What decided it: under the step model **234 yd → 15 and 236 yd → 10** — two yards of carry, five
handicap strokes. Luke's own code comment makes that argument.

## Read these before treating anything here as the plan

| Document | What it is |
| --- | --- |
| [`docs/FORGE-ON-RYP-CORE.md`](../../docs/FORGE-ON-RYP-CORE.md) | **Supersedes Build Spec §1 and §6.2.** The Spec declares itself the contract — *"where the two disagree, this document wins"* — so without a document that outranks it, a reader follows §6.2 straight back to Supabase. |
| [`docs/FORGE-CONTEXT.md`](../../docs/FORGE-CONTEXT.md) | First-hand read of this package: what is usable, what is stubbed, which constants are unfitted. |
| [`docs/FORGE-MATH-ADOPTION.md`](../../docs/FORGE-MATH-ADOPTION.md) | Where `forge-math.js` lives, stored vs derived, and which numbers must not be shown until fitted. |
| [`docs/decisions/FORGE-PORT-ANSWERS-2026-10-06.md`](../../docs/decisions/FORGE-PORT-ANSWERS-2026-10-06.md) | Makel's 24 answers, and a standalone briefing on the database for anyone (or any AI) arriving with only the Build Spec. |

## ⚠️ Things about this package that are easy to misread

- **It persists to `localStorage['forge.v5']` and makes ZERO network calls.** Having the package is
  not the same as having a producer. Atlas's Transfer, Performance and Tomorrow card stay gated until
  the port actually runs.
- **`build/forge-math.js` is referenced by NONE of the three `.dc.html` files.** The shipped screens
  run their own duplicated copies, so **the tested module is not the code that renders.**
- **`support.js` is Luke's homemade mini-React and must never be edited** — same rule as the other
  prototypes in `proto/`.
- The eight-session demo seed, the preset handicap/carry/target, and the three "PRESCRIBED BY YOUR
  COACH" rows are all **fabricated defaults baked into `boot()`**. §6.4 flags the first; the rest were
  found by survey. None of it survives the port.
- `sw.js` makes this a PWA. A service worker caching an authenticated page is a real hazard and has
  not been cleared.
