# Luke's FORGE and the port have never met — what it takes to join them

**2026-10-21.** `proto/forge/FORGE.dc.html` (383 KB, committed, byte-identical to the delivered
package) runs and works. `/api/forge` is live and healthy on Testing. **Nothing connects them**, and
the distance is not the plumbing.

## 🔴 The headline: wiring it CHANGES THE NUMBERS LUKE APPROVED

All four facets score differently in the port than in the prototype. "It works the way he wants"
stops being true the moment the numbers come from the server. This is a Luke conversation, not a
ticket.

| Facet | Prototype | Port | Gap |
| --- | --- | --- | --- |
| **Approach** | `fixed: true, fixedRung: 1` (`:2213`) — **always** base 12 | `rungs.get(...) ?? 0` (`forge.ts:437`) → base 20 for every new player | **~8 strokes of index** |
| **Putting** | produces an index | **no index at all** — `withheld: 'putt18_calibration_provisional'` (`forgeScoring.ts:152-166`) | composite renormalises over 3 facets; the **0.20 putting weight vanishes** |
| **Driving** | defaults carry to 235 | withheld without `carry_reference` + `driver_carry_yds` (`forgeScoring.ts:177-196`) | headline goes dark for anyone without a profile |
| **Chipping** | player's rung | player's rung | ✅ the only agreement |

## 🔴 A brand-new real user cannot use the app at all

The 8-session demo seed has been hiding this:

- **Zero sessions throws.** `:4839` reads `hist[0].date` → TypeError. **Nothing renders — not even
  the button to start a first session.**
- **One session renders `NaN`.** `:4842` computes `i / (hist.length - 1)` → `"NaN,134.3"`, silently.

So the seed is not only fabricated data, it is load-bearing. Removing it without fixing these two
lines gives a new player a blank screen.

## ⚠️ Corrections to the first read of this (mine, 2026-10-21)

1. **`save()` writes 25 keys, not 14.** The full set: `name, myHcp, carry, hcp, gender, sessions,
   rungs, board, boardFacet, statTab, statDrill, off, assignments, roster, draft, customDrills,
   hcpAsked, hcpCadence, hcpLog, role, practiceNudge, iosDismissed, sga, session, screen`.
   🔴 **And the consequence is the point:** `boot()` is `Object.assign(base, saved, …)`, so **any key
   the server blob omits silently keeps the fabricated default** — the 8 SEED sessions, `myHcp: 11`,
   `carry: 235`, `hcp: 5`, `gender: 'm'`, rungs `{1,1,1,0}`, an `hcpLog` of 13.4. A partial blob is
   worse than none, because it looks like it worked. (Useful lever: `[]` is truthy, so
   `assignments: []` does beat the `|| this.ASSIGNED` fallback at `:3454`.)
2. **"One read, one write" is true of STORAGE and not of the job.** Three **exact-string patches
   inside Luke's `data-dc-script`** are also required — the two empty-state lines above, and
   `screen: saved ? 'stats' : 'welcome'` (`:2316`, `:2322`), because a non-null blob **skips
   onboarding entirely**. That is code surgery in a file we do not edit, not injection.
   ⚠️ And the `injectData` precedent is weaker than it looks: `proto/Dashboard.dc.html` carries
   **23** `__ATLAS_DATA__` references, so it is an *edited working copy*, not an untouched file.
   Decide that policy explicitly instead of inheriting it by analogy.
3. **Three copies of the maths, not two** — the renderer's inline `CAL` (`:2415`),
   `@ryp/eco/scoring`, and a third base/slope copy in `forgeScoring.ts`.

## 🔴 Two hazards to close before it is served from Atlas

- **Do not serve `sw.js`.** It is network-first and `caches.put`s every same-origin GET, so it
  would store the personalised HTML *and* `/api/forge/me/dashboard` **past sign-out**. Simply not
  allowlisting it is a clean kill switch.
- **`forge.v5` is one key per ORIGIN, not per user.** On a shared device the next person to sign in
  boots into the previous player's sessions, handicap and rungs **before any network call**. Purge
  on load and on logout, and key by uid.

## ⚠️ Two places the prototype FABRICATES scoring input

Not display — input. Worth telling Luke plainly:

- `onTrayPhoto`, `snapAbacus` and `readMonitor` (`:3690-3693`, `:3722-3726`) **ignore the file** and
  apply the literal `[1,3,11,4,1]`, then flash *"Read 20 drives from the screenshot"*.
- The whole per-drill analytics layer is one fixed literal — `ANALYTICS` (`:2284`) is identical for
  every user (`n:160`, miss pattern `[9,26,71,42,12]`) and drives every "your curve vs target" and
  "bias lost x shots a round" card. `analytics()` calls `.toFixed` on it, so emptying it throws.

Strings that claim a sync which does not exist: *"Saved on device · queued for coach sync"*
(`:4394`), *"Synced to coach dashboard · LAST 2 MIN AGO"*, *"FORGE will nudge you even when
closed"*.

## The smallest path that works

0. **Grant the `forge` role row** (T-127) — every `/api/forge` request 403s `app_access_denied`
   until `public.user_app_roles` has one. Nothing below is testable first.
1. **`GET /proto/forge/`** in `server/routes/proto.ts` — trailing slash, same chain as
   `/proto/dashboard` plus `requireApp('forge')`, `no-store`. Allowlist `support.js` and
   `assets/` only; **not `sw.js`**.
2. **The boot seam** — inject a script that patches `Storage.prototype.{get,set,removeItem}` for
   that one key, returning a server-built blob naming **all 25 keys**.
3. **The three string patches** (above), each throwing if its anchor is missing.
4. **The write shim** — ids matching `/^n\d+$/` only (never `s1`–`s8`); mint `idempotency_key`;
   `POST /sessions` → `/complete`; overwrite local `f` from the response. `played_on` must be the
   **local** date (`:4248` uses UTC and the server refuses >1 day, 422); `myHcp`→`handicap_index`
   and `hcp`→`target_handicap` are **inverted names** — map explicitly; never send a driving rung
   (`facet_rungs` refuses it, 23514).
5. **Per-shot capture** — smaller than it looks: `save()` persists `session` on every tap, so keep
   the last non-null snapshot and join it to the new id. Driving must read `disp`, never
   `rec.driving` (`rec` is collapsed to `{0,1,2}`; `range_shots.outcome_value` is 0..4).
6. **Hide, do not wire:** leaderboards, builder, short-game assessment, per-drill analytics cards.
   They run on fixtures; wiring them to dashboard data would reproduce T-91/T-118.

## What else blocks it

- **No `GET /sessions/:id`** — the detail screen (raw strings, dispersion, per-hole putts) has no source.
- **Dashboard returns 10 sessions, no handicap history, no shots, no holes, no `raw` strings**
  (`forge.ts:760-768`) — the week chart, calendar and per-session meta lines truncate or blank.
- **The player sets their own rung** (`:3490`, `:4821`) but `forge_app` holds no write grant on
  `golf.facet_rungs` and a disagreeing `level` is refused 409. Patch the picker read-only.
- **No abandon** — a `POST /sessions` whose `/complete` never lands blocks every later submit with
  409 `live_session_exists`.
- **Cannot be stored at all:** launch-monitor driving (no `monitor`/`photo` entry method),
  `extras.lag` buckets → `avg_proximity_ft` (buckets, never feet), `pace`/`slope`/short-sided flags,
  `sga`, `customDrills` (`golf.drill_library` not built).

## Ask Luke, in this order

1. Did you mean **approach should always score at L2**, or at the player's rung?
2. Should **Putt 18 produce an index**, and against what? (also unblocks the disabled Makeables ladder)
3. Are the **per-drill analytics cards placeholders**, and what should they show from real data?
4. May we **add two lines for the empty state**, or will you send a build that handles zero sessions?
5. **What exactly is on your "UI stuff" list?**
