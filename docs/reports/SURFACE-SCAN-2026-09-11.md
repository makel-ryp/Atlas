# Surface scan — every logic and data route, all four remaining surfaces

**11 Sep 2026.** Completes the sweep begun with `PROTOTYPE-WHAT-LUKE-ALREADY-BUILT-2026-09-10.md`
(which covered `Dashboard.dc.html`). Four surfaces read end to end in parallel:
**177 logics · 134 data routes · 62 gaps**.

---

## The headline: the Dashboard finding does not generalise

`Dashboard.dc.html` was *"content and rules both specified, nothing evaluates them."* That is true
of exactly one surface. The other four each fail differently, and the difference is the useful part:

| Surface | What it is | How it fails |
| --- | --- | --- |
| `Dashboard.dc.html` | the coach + player app | rules written, **nothing evaluates them** |
| `AtlasPlayer.dc.html` | **Forge's player app** | **models are real and run** — but nothing enters and nothing leaves |
| `Atlas.dc.html` | public marketing site | no data layer at all; **sells things that do not exist** |
| `server/` | Express + Postgres | **almost entirely live** — 26 endpoints, 24 authed, all through RLS |
| `client/src/` | the React SPA | rules evaluate; the **display is switched off by two lines** |

---

## 1. `AtlasPlayer.dc.html` — the real models are here, and they are stranded

This is the most valuable surface we had not read. It genuinely computes:

- **`score(k)`** (`:1519-1546`) — turns logged taps into the four handicap-style domain indices.
- **`fitLine()`** (`:1323-1335`) — a real maximum-likelihood fit of putting line-dispersion over 20 putts.
- **`parseLm()`** (`:1620-1698`) — parses a real Trackman/GCQuad CSV and decomposes miss into bias vs spread.

All three are live. The failure is at **both ends of the pipe**:

- **Nothing enters.** No `fetch`, no `XMLHttpRequest`, no `window.__ATLAS_DATA__`, and **no user id
  anywhere in the file**. Handicap and carry come from a ± stepper defaulting to 10.0 and 235.
- **Nothing leaves.** The "Send to Atlas" button (`:2568`) is `sync: () => this.setState({ synced: true })`.
  The offline queue is emptied by a 1400 ms `setTimeout` (`:1417`) with no request behind it.
- **The two best models throw their own output away.** The launch-monitor result and `last` are not
  in the persist payload (`:1476-1482`), so the SG/bias decomposition and the fitted putting curve
  die on reload while the raw shots survive.

> **I was wrong about the migration.** I had recorded that this file migrates
> `atlas.forge.v1/v2/v3`. It does not — `:1385` **deletes** those five legacy keys outright with no
> read. Corrected in the record.

**What this means for the Forge ask:** if Forge's real build resembles this file, the integration is
not "build the model" — the model exists. It is *identity and transport*: a user id, and a real call
behind that sync button.

---

## 2. `server/` — live, and the one place the scan overturned its own hypothesis

26 endpoints, 24 authed, every read and write through `withRls` on a `NOBYPASSRLS` role. The
inertness is concentrated in exactly one file: **`protoData.ts`, where 13 of the 20 `RosterRow` keys
are hardcoded empties** because Forge never shipped. That file is the seam between a live server and
a dead prototype.

Three findings came from checking the **live database** rather than the checked-in SQL:

| # | Finding | Status |
| --- | --- | --- |
| **T-49** | `/proto/dashboard` had two middleware links where its siblings have four — no `ensureAtlasAccess`, no `requireApp`. A revoked entitlement kept the dashboard for up to 8 hours. | ✅ **fixed** |
| **T-50** | `eco/sql/rls_core.sql` is **stale**: no `atlas_app` write grant on `public.user_app_roles`, no grant at all on `intake_submissions.interview`. **A DB rebuilt from it breaks signup, admin role writes and every intake PATCH.** | ⚪ open |
| **T-51** | The `quality_flag` privilege wall **does not exist on INSERT**. Three code comments assert a column-level grant; `information_schema.table_privileges` shows a **table-level** INSERT and `has_column_privilege(…, 'quality_flag', 'INSERT')` is `true`. UPDATE genuinely is restricted, so the wall is half real. | ⚪ open |

T-51 is not exploitable today — `/intake/start` uses explicit-column raw SQL and never names the
column — but a documented control that isn't there is worse than a known gap, because the next
person trusts the comment.

Also open: **no endpoint anywhere writes `public.user_relationships`**, so the coach-request/consent
loop the roster renders three states for has no server route behind it.

---

## 3. `client/src/` — the rules run; the display is off by two lines

The stage machine, the AllocBar algebra, the handicap/speed conversions, the auth switch and all 17
`api.*` calls are live against real columns — and **every one of the 17 has a matching route with a
matching body shape**. What is switched off:

1. **`nextTier()` returns `null` unconditionally** (`quiz/stages.ts:82-84`). That pins
   `result.quizConfidence` to `'baseline'` forever, which makes ~60% of `ResultScreen` and **all 844
   lines of `quiz/result/`** unreachable.
2. **`const breakdown = null as VolumeBreakdown | null`** (`quiz/ResultScreen.tsx:117`) hardcodes the
   volume model away — **even though `run.volume` and `run.alloc` are now real columns that
   `toEnvelope` returns.** This one is stale rather than deliberate: it was written when those
   columns had no producer. They do now.

Plus: `App.tsx` recognises **2 of eco's 6 roles**, so four role-holders are marched through the
23-answer intake.

---

## 4. `Atlas.dc.html` — no data layer, but it sells what we do not have

Confirmed absolutely: zero `__ATLAS_DATA__`, zero fetch, zero storage, zero forms, one `<input>` (a
range slider). **Every commercial route out of the site is a dead `<div>`.**

But it is not inert, and it makes **claims the product must honour**:

- Sells *"All eight Impact Opposites"* (`:595`, `:704`). `IMPACT_OPP` holds **three**.
- Headlines the Construction progression as **4 steps** (`:561`), sells it as **five** (`:596`);
  `STEPS` has **five**.
- Invokes **Broadie / strokes gained** (`:455`) against SG weights that are not Broadie's.
- Promises **20 false priors**; **15** are written.
- The **Map** — the central product metaphor — has **no coordinate formula** anywhere.
- A dispersion "confidence" of `Math.min(95, 45 + dots.length * 8)` (`:865`) — a pure function of
  how many times you clicked, with no relation to the scatter. Nine clicks renders `9 OF 5 PLOTTED`.

---

## Fixed in this pass

| | |
| --- | --- |
| **T-46** | `ProfileForm` inverted a plus handicap — `Number('+2.1')` is `2.1`, so a plus golfer wrote a **4.2-stroke error** into `golf.player_profile`, the layer every RYP app reads. Now `parseHandicapIndex`. |
| **T-47** | `ProfileForm` stamped a fabricated `'right'` handedness on the first save of any field. Made worse by `44f29bf`, which had just made handedness flip dispersion geometry and a bias sign. |
| **T-48** | Intake PATCH kind `volume` had **no** domain validation, alone among five kinds, and fed `computeVolumeBreakdown` — so a string or a negative became NaN shares in a stored result. |
| **T-49** | `/proto/dashboard` entitlement middlewares (above). |
| **T-42 (partial)** | Player's own handedness + driver carry wired; `PLAYER_CARRY = 265` retired. |

## Suggested order from here

1. **T-50** — the stale `rls_core.sql`. It is the only finding that is a *disaster-recovery* problem:
   everything works until someone rebuilds from it.
2. **`breakdown = null`** — one line, and the columns behind it are already live.
3. **T-51** — restore the INSERT wall, or delete the three comments claiming it exists.
4. **The consent loop** — `user_relationships` has no writer.
5. **`Atlas.dc.html` claims** — decide per claim: build it, or change the copy before it is published.
