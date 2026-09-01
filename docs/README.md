# ATR docs

Reorganised 2026-08-28. **Docs cite each other by bare filename** — this index is how you resolve one.

## ⭐ Living docs — read these first, and keep them true

| | |
| --- | --- |
| `HANDOFF.md` | **Start here with zero context.** Repo map, the decoy-directory landmine, how to boot and smoke test, and the hard-won facts not to re-derive |
| `STATUS.md` | What is built and verified, what is broken, what is unverified. Repo-state block is generated |
| `TASKS.md` | The board. Now / Next / Backlog / Frozen / Done, one row per task, permanent IDs |
| `refresh-status.sh` | Regenerates the repo-state block in `STATUS.md`. Run it whenever you commit |

These three are **maintained every turn that changes code** — the rule lives in `../CLAUDE.md`
and in each repo's own `CLAUDE.md`, so it loads automatically. Everything below is reference
material and point-in-time analysis; the three above are the current truth.

## architecture/ — how the system is built
| | |
| --- | --- |
| `ECOSYSTEM.md` | **The one architecture doc.** The six apps, the four rules, the schema shape. §9 records every doc deleted and why |
| `METRIC-MAP.md` | The metric proposal. §1 assigns tables to schemas, **§2 reconciles metrics across all six apps**. A proposal, not a build record — most of it is not built |
| `AGENT-BRIEF.md` | Shared context every pipeline agent reads first. Pinned metric definitions, the RLS vocabulary, the known traps |

## product/ — what is being built and in what order
| | |
| --- | --- |
| `ROADMAP-atlas-to-launch.md` | Milestones. Revised 28 Aug: M4.5 added for the coach product, M5 narrowed |
| `ATLAS-ADMIN-PLAN.md` | Rewritten 28 Aug against the prototypes. Half of it is administering the coaching model, not billing |
| `STACK-DECISIONS.md` | Login, payment, storage. Also the record that the $99–$799 pricing appears nowhere in the repo |

## decisions/ — settled calls, with the reasoning
| | |
| --- | --- |
| `DECISION-coach-dashboard.md` | Atlas owns the coach dashboard; academies; the two visibility tiers |

## operations/ — things to run
| | |
| --- | --- |
| `DEMO-RUNBOOK-2026-09-07.md` | **The demo.** Four steps, what to say, break-glass table |
| `RUNBOOK-rotate-ryp-red-owner.md` | Pending: rotate the old `ryp-red` owner credential |
| `RED-UPDATE-PLAN.md` | ⚠️ Stale — awaiting the refreshed Red build before it can be updated |
| `YANNICK-UPDATE-PLAN.md` | Locker Room + Debrief migration asks |
| `ANSWERS-yannick-2026-08-24.md` | Record of what Yannick was told |
| `SPRINT-1-PREP.md` | Sprint 1 status and what is still open |

## reports/ — analysis, point-in-time
| | |
| --- | --- |
| `GAP-REPORT-design-vs-build.md` | 28 Aug. Design vs build vs plan, from a deep read of Luke's prototypes |
| `STACK-what-not-to-build.md` | 28 Aug. What to adopt rather than build. ⚠️ Its `sanitize-html` XSS finding was checked and is **not** live — React escapes `{n.body}` |

---

**Not here:** each app's own `CLAUDE.md` lives with the app. `eco/sql/rls_core.sql` is the
authoritative policy record and lives in the eco repo, not in docs.
