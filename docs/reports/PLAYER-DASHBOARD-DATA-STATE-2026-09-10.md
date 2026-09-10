# Player dashboard — what is live, what is still hardcoded

**10 Sep 2026.** Traced by hand against `proto/Dashboard.dc.html` and `server/protoData.ts`. Every
line reference below was read, not inferred.

---

## The headline

For a **player**, the injected live data is five things:

| What | Source | Where it enters |
| --- | --- | --- |
| Display name | `public.users.display_name` | `ATLAS_ME`, `Dashboard.dc.html:2576` |
| Handicap index | `golf.player_profile.handicap_index` | `state.realHcp`, `:2753` |
| Target handicap | `golf.player_profile.target_handicap` | `state.targetHcp`, `:2749` |
| Which tab opens | server-decided by role | `state.view`, `:2731` |
| Which sections show | `HIDDEN_FOR_PLAYER` | `isHidden()`, `:5015` |

**Everything else on the player dashboard is a literal in Luke's file.** The `state` object at
`:2724` has 18 top-level keys; exactly one reads `__ATLAS_DATA__` at that level, plus the two
handicap IIFEs.

One structural reason, worth knowing because it is not obvious: all the *rich* per-person data in
`protoData.ts` — driver carry, handedness, drill progress — rides on **roster rows**, and a roster
is built from `coach_of` edges where the caller is the coach (`protoData.ts:337-345`). A player
coaches nobody, so `ids.length === 0` and `roster: []` (`:391`). The player's own record never
travels the path that carries the real fields.

---

## 1. Already in the database, just not wired — the quick wins

These need no new table, no Forge, no decision from anyone.

| Field | Shown as | Real source | Note |
| --- | --- | --- | --- |
| Handedness | `state.hand: 'R'` (`:2757`) | `golf.player_profile.handedness` | Column exists and is populated; the coach's roster row already reads it. Only the player's own `me` block omits it. |
| Driver carry | hardcoded in the profile card | `golf.player_profile.driver_carry_yds` | Same — exists, read for roster rows, absent from `me`. |
| Drill sign-offs | `state.ticked`/`DONE` (`:2560`), `state.verified`, `state.signed`, `state.watched` (`:2780-2782`) | `golf.drill_progress` | **The table exists and is written by the coach flow we built.** It reaches the coach through `who.drills` (`:3795`) but nothing feeds the player's own view, so a player sees 12 fake ticked drills. |

The fix for all three is the same shape: widen the `meBlock` at `protoData.ts:318` and inject the
player's own `drill_progress`. This is the single highest-value hour on this list.

---

## 2. Needs an Atlas table + a producer

Nothing exists to write these yet. All are ours, not Luke's.

| Field | Shown as | What it needs |
| --- | --- | --- |
| Practice log | `SEED` (`:2498`) — a month of `{minutes, bucket, workout}` | A practice-session table and a way for a player to log one. This is the single biggest fabricated surface on the page. |
| Today's sets / tempo | `state.sets`, `state.tempo` (`:2733`) | Same producer as above. |
| Club head speed | `state.speeds: [94,95,…]` (`:2779`) | `METRIC_TYPES` already has `club_head_speed` — but `golf.player_metrics` **does not exist**. See §4. |
| Fitness / lifts | `state.fitnessOn`, `state.lifts` (`:2783-2785`) | No table, no producer, no decision. |
| Money stake | `state.stake` (`:2758`) | A product decision before a table. |

---

## 3. Needs Forge — blocked on Luke

The whole `state.forge` block (`:2760-2778`) is literal:

```js
driving: 14.0, approach: 8.0, chipping: -3.0, putting: 2.0,
tr: { … }, transferGap: 2.4, level: 2, challenge: -3,
dna: { offTheTee: 74, approach: 46, aroundTheGreen: 81, putting: 63, speedDistance: 38 },
sim: [ 4 rounds … ], simAvg: 2.8, simLeakPct: 12,
history: [ Oct / Jan / Apr / Jul … ]
```

That covers the four domain indices, the transfer gap, the 5-axis DNA radar, the simulator history
and the four-quarter index history. Also Forge: `state.disp` (`:2734`), the dispersion ellipses,
identical for all three clubs — the same numbers for sand wedge, 7-iron and driver.

⚠️ **`state.forge` is not inert.** `Dashboard.dc.html:3017` computes the weighted composite from
these literals and `:3145` renders it as **Total SG** — always −2.0, for every player. Tracked as
**T-41**; this is a fabricated number currently on screen, and the reason it matters more than the
rest of this section.

---

## 4. Needs a schema decision first

`golf.player_metrics` — named in `STATUS.md:127` as where measured metrics land, and the intended
home for strokes gained and club head speed — **does not exist**. The `golf` schema has three
tables: `player_profile`, `handicap_history`, `drill_progress`. `METRIC_TYPES` (`config.ts:78`) has
eight values and none of them is strokes gained.

So several rows in §2 and §3 are blocked behind one table nobody has built.

---

## 5. Needs the coaching ruleset — blocked on Luke

`state.tier: 'builder'`, `state.phase: 2`, `state.rebuild` (`:2783`). The dashboard's curriculum
position. `protoData.ts` ships `tier: ''` and `zone: ''` marked *"Not built"*, because no rule
decides them. This is the whole subject of
`docs/operations/ASK-luke-coaching-ruleset-2026-09-09.md` (T-40).

---

## 6. Fine as-is — client runtime, not data

`state.session` (in-app drill session), `state.clock` / `now` / `lastSession`, `state.vw`,
`state.openStep`, `state.coachMode`, `state.demo`. Local UI state; nothing to connect.

---

## Suggested order

1. **§1 — the three quick wins.** Handedness, driver carry, the player's own drill progress. All
   three exist in the DB today. No blockers.
2. **T-41 — kill the fabricated SG.** It is a wrong number in front of a user right now.
3. **§4 — decide `golf.player_metrics`.** It gates club speed, SG, and anything else measured.
4. **§2 — the practice log.** Biggest fabricated surface, and it is ours to build, not Luke's.
5. **§3 / §5 — Forge and the ruleset.** Both waiting on Luke.
