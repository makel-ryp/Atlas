# Luke's designs — what exists, and which are wired

All of Luke's `.dc.html` exports now live here **unmodified**, so `git log -p proto/` stays the
reference and none of them can be forgotten in `~/Desktop/ATR/websites/atlas/handoff/` (which is
the decoy directory — see the root `CLAUDE.md`).

| File | What it is | Wired to real data? |
| --- | --- | --- |
| `Dashboard.dc.html` | The **coach** view — a roster of students | ✅ yes. `ROSTER` stripped, fed by `server/protoData.ts`, served at `/proto/dashboard` |
| `AtlasPlayer.dc.html` | The **player** view | ❌ no — reference only. See below |
| `Atlas.dc.html` | The main/marketing site | ❌ no — reference only |

## Why AtlasPlayer is not wired, and should not be wired yet

**It is the Forge front-end.** Its own localStorage keys give it away — it migrates from
`atlas.forge.v1/v2/v3` to `atlas.player.v1/v2/v3`. Of its 45 hardcoded data constants, the bulk are
Forge's: `SGA_SCORES`, `SGA_BENCH`, `SG_EXP`, `SG_F`, `BASELINE` (strokes gained), `LM_CLUBS`,
`LM_PER_YD` (launch monitor), `TEST_CONDS`, `WINDS`, `FIRMS`, `SPEEDS`, `SLOPES` (test conditions),
`CHIP_TIERS`, `CHIP_OUT`, `LIES` (short game).

Content counted 2026-09-01: sessions 23, carry 36, tests 18, drills 17 — against intake 0,
academy 0, GHIN 0. The concepts Atlas owns today (handicap, coach relationship, profile) are a
minority of the page.

Wiring it now would mean inventing most of what it renders, and **a confident wrong number in
front of a coach is the worst outcome this project can produce** (HANDOFF §6). It is the same
44-of-81 Forge dependency documented in `docs/STATUS.md` §5, showing up on a second screen.

**When Forge lands, this file supersedes `client/src/components/Profile.tsx`.** Treat that React
screen as the honest interim for the data that exists — not as the player product.
