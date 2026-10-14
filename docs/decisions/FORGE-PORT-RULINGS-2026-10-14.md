# Rulings on the scoring module's open questions

**2026-10-14.** The differential verifier ran both modules over **151,331 calls** plus a 7.3M-input
exhaustive `drivingIndex` sweep and asked for a decision on each unauthorised divergence. None of
these is a product decision, so they are ruled here rather than sent to Makel.

The governing principle throughout: **this module is the one part of the system that can be
confidently, silently wrong.** Where a choice is between a crash, a null, and a plausible number,
the plausible number is always the worst option.

| # | Finding | Ruling |
| --- | --- | --- |
| 1 | `facetStrokesGained('bogus')` returns `NaN`; the original returned `0` | **Return `null`.** Neither original nor port was right. `0` is a silent lie — it reads as "gained no strokes". `NaN` propagates into a displayed handicap. `null` is the honest answer and the one every other "cannot compute" path here already gives. |
| 2 | `daysBetween` now throws where the original returned `NaN` — **and its validation is broken anyway**: `'2026-08-'` passes as day 0, `'2026-02-31'` rolls over | **Throw, and fix the validation properly** — `/^\d{4}-\d{2}-\d{2}$/` plus a UTC round-trip to reject rollover. A malformed date is a bug, not data, and `NaN` here silently poisons the half-life weighting in `currentFacet`. Record as a deliberate departure from the original. ⚠️ **node-pg returns `date` columns as JS `Date` objects**, so the first integration will hit this — the caller formats. |
| 3 | `dispersion` returns `null` for an out-of-range zone; the original returned `{meanYards: NaN, …}` | **`null` is correct. Keep it**, record as a deliberate departure. An object containing `NaN` is the silent-wrongness class with extra steps. |
| 4 | `totalStrokesGained` / `practiceHandicap` iterate a fixed `FACET_IDS` instead of `Object.keys` | **Keep the narrower contract**, record it in the header. A stray key from a DB text column should be ignored, not silently summed. |
| 5 | `practiceHandicap` returns `null` for numeric **strings** where the original coerced them | 🔴 **Coerce with `Number()`.** This is a real integration bug, not a contract question: **node-pg returns `numeric` columns as strings**, so weights read from the database would make every composite index `null`. |
| 6 | No `SCORING_VERSION` export | **Add it.** §2.3 requires the server to stamp it on every scoring pass, and this release changes both the Putt 18 constants and the driving formula — which is exactly what it exists to mark. Assert it in the fixtures and require a bump on any change to `CAL` or any index function. |
| 7 | `CAL.benchmarks` tagged `ESTIMATED` vs the doc's `UNSOURCED` | **`UNSOURCED`, and add the tier.** Luke proposed ESTIMATED, but the module's own legend defines ESTIMATED as *derived from a measured quantity by a defensible method* — and there is no source at all. A tag that is not true is worse than no tag, because everything downstream trusts it. Luke is still asked for the source. |
| 8 | `CAL.carry` still tagged `MEASURED` directly above a comment saying no source for it is in the package | **`UNSOURCED` too, and this one matters more than the benchmarks tag** — `CAL.carry` is the table that **feeds scoring**, and Luke's Q6 shows it disagrees with `CAL.benchmarks` by **30 yards at scratch**. A `MEASURED` tag sitting on top of a comment denying the source is internally contradictory on the most load-bearing table in the file. |
| 9 | `PROVENANCE` has no `provisional` tier, and `base` is "gated" with nothing implementing a gate | **Add the tier** and entries for the putting index. If nothing implements the gate, say so in the header rather than implying one exists. |
| 10 | 🔴 **`baselineHandicap` silently substitutes the men's table** for any unknown, null or undefined reference | **Return `null`, and have `drivingIndex` propagate it.** This is **T-125 surviving in the other layer.** The `gender` column was removed so a vocabulary mismatch could not score a woman on the men's table — and because it was removed, the argument is now *usually absent*, and absent still means men's table. Confirmed by running `dist`: `baselineHandicap(250, null) = 6.3`, `baselineHandicap(250, 'f') = -1`. Take `carry_reference`, map it explicitly, and refuse to guess. |
| 11 | `drivingIndex` does not validate zones — a zone of `7` scores as a neutral small miss | **Reject the whole input (`null`)**, consistent with `dispersion`. Add a fixture. |
| 12 | `NaN` is not blocked on the numeric paths; `currentFacet` stores it and the median becomes order-dependent | **Guard at the input of `clampIndex` and `currentFacet`.** A non-finite value must never reach a stored or displayed number. |

## The one that is not a ruling but a correction to record

Findings 1–5 are all the port **improving something it was not asked to improve**. That is its own
defect class in a parity port: the three authorised changes are the ones anyone will look for when a
number moves, and an unannounced fourth change is the one that wastes a day. Every departure kept
above is now stated in the module header as a departure, with its reason.
