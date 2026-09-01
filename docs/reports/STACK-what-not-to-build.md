# RYP: what not to build

Four scans, one decision list. Where the scans disagreed I picked a winner and said why. Where a scan could not verify something, it is still marked unverified here.

---

## 1. The standard stack

Stop deciding these per-app. "Already in" = apps where it is live code today.

| Capability | Choice | Already in | Status / action |
|---|---|---|---|
| Auth | Firebase — client `^12`, admin `^13`, via eco's bridge | Atlas, RED, LR | Locked. LR on admin 12 + client 10; Atlas on client 10. Bump both. |
| Database | Neon Postgres (`ryp-core`) | all | Locked |
| **Postgres driver** | `pg ^8.16` + `drizzle-orm/node-postgres` | eco, Atlas, LR, practice-dna | **RED drops `@neondatabase/serverless` and deletes `server/lib/rlsPool.ts`.** RED already has `pg ^8.16.3` installed — no new dep, just rewire `db.ts`. Two hand-written RLS wrappers is the duplication this exercise exists to kill. |
| ORM | `drizzle-orm ^0.45` / `drizzle-kit ^0.31`, kit owned by eco | RED, inventory on 0.45 | Migration owed. De-risked: LR already runs kit `^0.31.8` against orm `0.39` in production, so the 0.31 snapshot format is proven. Do it on a Neon branch, regenerate from live schema, verify with `npm run verify:schema`. |
| Server framework | Express 5 | eco, Atlas, LR | RED + practice-dna on 4. Migrate RED when it adopts eco. |
| Runtime | Node ≥22.12, `@types/node` 22, TypeScript pinned `5.6.3` | RED engines, Atlas, eco | Align LR + practice-dna |
| **eco peer ranges** | `drizzle-orm ^0.45`, `express ^5`, `firebase-admin >=13`, `pg >=8.11` | eco | **Four lines. Cheapest item in this document.** All four are currently wider than what eco's code supports; tightening converts three future silent-breakage bugs into install-time errors. |
| UI component kit | **shadcn/ui superset from RYP-RED** (55 comps) + Radix + cva + clsx + `tailwind-merge ^3` + `lucide-react ^0.545` | RED (55), LR (47) | Copy RED's into Atlas. Strict superset — all 47 of LR's filenames plus 8 newer; `cn()` byte-identical. **Bring `client/src/index.css` with it** — the components use non-stock tokens (`hover-elevate`, `--button-outline`) and render unstyled without it. |
| React | **19** (`^19.2`) | RED | Atlas moves now. See conflict note below. |
| Tailwind | **v4** via `@tailwindcss/vite` + `tw-animate-css` | RED, practice-dna | Atlas moves (sheds postcss + autoprefixer). LR stays v3 — its migration is real work and you won't be copying components out of it after this. |
| Server state | `@tanstack/react-query ^5.60` | RED, LR | Atlas adopts. Keep Atlas's existing `apiFetch` as the `queryFn` — the Firebase token logic in it is correct. |
| Router | `wouter ^3.3.5` | RED, LR | Atlas adopts **before** the ~20 screens exist. react-router appears in no app. |
| Forms | `react-hook-form` + `@hookform/resolvers` + `zod ^3.25` + `drizzle-zod ^0.7` | RED, LR | Atlas adopts. Put drizzle-zod in **eco**, not per-app, so client and server validators can't drift. |
| Charts | `recharts ^2.15` — **new surfaces only** | RED, LR | Use for hover/tooltips/brushing/unbounded axes. Do NOT use it to redraw what the prototypes already draw (see §4). |
| Date picker | `react-day-picker` **v9** | RED | Follows the shadcn copy — RED's `calendar.tsx` is the v9 wrapper. LR's v8 stub is unused; leave it. |
| Date maths | `date-fns ^3.6` **only if `Intl` isn't enough** | RED | n=1, not a standard. Check whether you need a library at all. If adopted, put it in eco once. |
| Animation | `framer-motion ^12` (now `motion`) | RED | LR on 11. Converges free with the React 19 bump. |
| Toasts | `sonner ^2.0.7` | RED | Atlas takes sonner only. RED retires `@radix-ui/react-toast` when call sites migrate. |
| Drag & drop | `@hello-pangea/dnd ^18` | LR | **Verified:** peer deps are `react: ^18.0.0 \|\| ^19.0.0`. Safe on React 19. |
| DOM → PNG | `html-to-image ^1.11.13` | RED, LR | Three rasterisers for one job. Delete `html2canvas` (LR, verified unused) and `modern-screenshot` (Debrief). Self-host the three Google fonts or exports fall back to system fonts. |
| Print | `react-to-print ^3.2` | RED | Not a duplicate — right tool for the printable practice plan. |
| CSV | `papaparse ^5.5.3` + `@types/papaparse` | RED | Atlas adopts for the launch-monitor import. Replaces ~6 lines of `parseLm` — the 6 that break on BOM, quoted commas, UTF-16, semicolons. |
| HTML sanitisation | `sanitize-html ^2.17` | LR | **Atlas needs this before the first coach note is saved.** Coach writes → player renders is textbook stored XSS, and across the RLS boundary it's privilege-crossing. Sanitise on write AND render. |
| Express hardening | `helmet` + `cors` + `compression` + `express-rate-limit` | RED, LR | Atlas has none of the four. Four `app.use()` lines. Copy **LR's** tuned CSP directives — helmet's default blocks Google Fonts. |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` + `s3-request-presigner` | RED | Lift RED's presign module. Server-side only. **Video is a carve-out → Cloudflare Stream, §3.** |
| Payments | `stripe ^22` + hosted Checkout + Customer Portal | RED | Decide which app owns billing before wiring the webhook; the endpoint and the Stripe dashboard URL move with it. |
| LLM | `@anthropic-ai/sdk`, one pinned version; Debrief's `lib/anthropic/client.ts` promoted to eco | Debrief, RED, inventory | Retire `@google/genai` in LR when `server/gemini.ts` is next touched — not as a project. Check what its Gemini calls actually do first. |
| Speech-to-text | Deepgram raw fetch, model `nova-3` | Debrief | One-line change from `nova-2`. |
| Text-to-speech | ElevenLabs `eleven_flash_v2` + two cloned voices | Debrief | Keep. `flash_v2` not `v2_5` — only v2 applies the pronunciation dictionary. |
| Email | `resend ^6` via Debrief's `lib/email/mailer.ts` | Debrief | Promote to eco. Needs a verified `rypgolf.com` sending domain with SPF/DKIM/DMARC before any real send. |
| Push | **FCM** (`firebase-admin/messaging`) | LR | Atlas uses FCM — `firebase-admin ^13` is already an Atlas dep, so zero new dependency and no second key surface. Debrief keeps its working web-push until that file is next opened. |
| Retrieval | Postgres FTS — generated `tsvector` + GIN | Debrief | Ports to Neon cleanly (plain Postgres; only the query becomes a Drizzle `sql` template). **No pgvector.** But it is broken today — see §2. |
| Scheduling | GitHub Actions cron → authed HTTP endpoint | Debrief | Move `lib/cron-auth.ts` to eco. Retire LR's in-process `node-cron` as jobs move. |
| Logging | `@axiomhq/js`, RED's `server/axiom.ts` promoted to eco | RED | Log `user_id`, not email. Debrief must never log transcript or register content. |
| Feature flags | `public.feature_flags` table (`app`,`key` PK + `plan_required`) | eco | Add a cached `getFlag()` helper + seed script. No vendor — the table already joins flags to billing, which LaunchDarkly doesn't. |
| Tests | `vitest ^4` + `@testing-library/react ^16` + jest-dom + jsdom + `vitest-axe` + `axe-core` | RED, LR | Copy **LR's** `vitest.config.ts` into Atlas — closer layout match. Free a11y coverage on the shadcn components you're importing. |
| Course data | GolfCourseAPI + **a local cache table** | RED | Promote the client to eco. Persist normalised rows on first fetch — turns a vendor dependency into a vendor preference. |
| Hole geometry | OSM Overpass pipeline (`server/lib/overpass.ts`) | RED | Promote to eco. Do not rebuild in Atlas — RED's is 30-day cached, cross-tenant, with an overrides table and a test file. |
| Long-form content | Markdown/MDX + `gray-matter`, in-repo | Debrief | No CMS. Keep frontmatter structured (chapter, zone, tags) so you can index later. |
| Contained, not adopted | Supabase, `next-pwa`, `nuxt-auth-utils`, `postgres.js` | Debrief, inventory | Migration targets, not patterns. |

### The six places the apps disagreed — resolved

1. **React 18 vs 19 → 19.** One scan said stay on 18 and warned "recharts 2.x breaks first on React 19." I checked RED's manifest: it runs `react ^19.2.0` **with** `recharts ^2.15.4` and `react-day-picker ^9.11.1` in production. That warning is empirically dead. Atlas is the cheapest app to move — 5 components, no UI kit, no tests. An afternoon now, a month after the Dashboard is built.
2. **Which shadcn set → RED's.** One scan diffed both directories file-by-file; the other just noted LR has one. Stronger evidence wins. This choice then propagates: React 19, Tailwind v4, tailwind-merge v3, rdp v9, lucide 0.545, framer-motion 12, sonner. Three splits close with one bump.
3. **react-day-picker v8 vs v9 → v9.** Falls out of #2.
4. **Push: web-push vs FCM → FCM for Atlas.** `firebase-admin` is already installed there. FCM web is a wrapper over the same Web Push protocol, so this is consolidation, not a capability change. Debrief's web-push is correct and working — don't touch it to save a dependency.
5. **Video upload: uppy multipart to R2 vs Cloudflare Stream → Stream, and it collapses the uppy row.** Stream's direct-creator-upload is resumable, so the part-sizing / retry-per-part / resume-across-backgrounding machinery you'd adopt uppy for becomes Stream's problem. R2 + RED's presign module keeps every non-video object. **Two scan items become one, and you skip a dependency.**
6. **date-fns → conditional.** One scan called it a standard; it's `n=1`. Check whether `Intl` covers you first.

---

## 2. Adopt now

Genuinely absent from all seven apps. Ordered by effort saved.

**1. Offline outbox for AtlasPlayer — `vite-plugin-pwa` (Workbox) + Workbox BackgroundSync + `idb`.** Saves **2–4 weeks.** The prototype's queue is theatre: `AtlasPlayer.dc.html:1417` is a `setTimeout` that clears the array and sets `synced: true`. Durable queueing, ordered replay, backoff, partial-failure handling and a truthful pending count is the largest unbuilt piece in the product and the class of code that fails in the field, not in dev. Workbox gets you transport + durability in ~2 days. Not a fourth stack — Debrief's `next-pwa` is Workbox underneath.
- What stays yours: a client-generated UUID per mutation and `ON CONFLICT (client_mutation_id) DO NOTHING`. The library guarantees delivery, not exactly-once.
- Two traps: Firebase ID tokens expire in an hour, so the replay handler must call `getIdToken()` at send time, not bake the header in at enqueue. And the prototype persists all state as one localStorage blob (`:1475`) — an 80-shot session will hit the 5MB quota. Move to IndexedDB **before** the queue.

**2. A Haiku query-rewrite step in front of the FTS — a new `retrieval` role in the model registry.** ~half a day, ~$0.0004/turn. **This is a live defect, not an improvement.** `websearch_to_tsquery` ANDs every content word of the golfer's question — six lexemes that must all appear in one 200–600 word chunk. A scan verified against `ryp-core` that a realistic question does not match a realistic Luke chunk, and `app/api/ask/route.ts` swallows the zero-match in try/catch and answers from model weights. Ask mode looks healthy. Luke's ~115 chunks would essentially never surface. Don't OR the terms — the gap is vocabulary ("slicing", "nervous" vs "commit window"), not boolean logic. Worth testing the even cheaper option first: ~40 tier-1 chunks is ~27k tokens, which fits in a cached system prompt for ~$0.10 per write / ~$0.008 per cached read, with no retrieval logic at all.

**3. Sentry.** ~10 lines per app, free Developer tier (5k errors/mo, 1 user). Axiom does **not** cover this — Axiom is deliberate event logging at points you anticipated. Sentry catches the ones you didn't: uncaught exceptions, stack-trace grouping, release attribution, alerting. Today an unhandled throw in any of six apps is a `console.error` into a Railway stream nobody is tailing. Take Debrief and RED first, then Atlas. Set per-project sample rates on day one — one noisy loop can eat the shared 5k. Don't also adopt Sentry logging/tracing; Axiom has that.

**4. Native structured outputs on the Messages API** — `output_config: {format: {...}}`, or `client.messages.parse()`. No new dependency; it's a feature of the SDK already installed. Replaces Debrief's `callForJson()`, which does `raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)` and parses whatever comes back. That greedy fallback captures from the first brace to the last across a response containing prose, and it backs S.C.O.R.E. extraction, register inference, and fact extraction. One function, every caller already goes through it. Also consider the Batch API (50% off) for the morning brief — but not for extraction, which feeds a dashboard the golfer may open immediately.

---

## 3. Buy, do not build

Verification status marked per item. Nothing here is laundered.

| Service | What it costs to integrate | Access requirement | Verified? |
|---|---|---|---|
| **Arccos On-Course Data API** | OAuth-style connect flow + an ingest job. Days. **$0 up to 100 connected players**, then $2.25/user/mo (101–5,000), scaling down to $1.00 at 100k+. | Developer signup at `payment.api.arccosgolf.com`; per-player consent via SSO, which maps onto Atlas's existing consent loop. | **Commercial terms: verified** from the licence PDF (data categories are enumerated — shot-level data, handicap, equipment, course movement). **Technical shape: NOT verified** — the Postman docs page returned nothing, so no endpoint, payload, auth flow, or whether they return their own strokes gained. **Pricing PDF is titled "draft", dated 2023-03-09.** Confirm both before designing the schema. Also: Arccos owns the data, the licence is revocable, and they "may reject Customer's offer in its sole discretion." Treat it as an enrichment layer over your own round records, never the only path to a core feature. |
| **Cloudflare Stream** (video only) | Same vendor, same dashboard as R2. $5 / 1,000 min stored, $1 / 1,000 min delivered, encoding free, adaptive bitrate + player included, no separate egress. | Existing Cloudflare account. | Storage/delivery pricing verified on Cloudflare's docs. **Signed/tokenised playback NOT confirmed** on that page — verify before migrating private coach video. Model your worst month: per-minute-delivered punishes heavy scrubbing, and stored minutes accumulate forever unless you set a retention rule. |
| **Parallax Golf** | A deep link and an Atlas-side `verified` flag. That's it for v1 — the prototype copy already implies this ("Coach verified in Parallax" is an Atlas state). | **No published API, SDK, embed or webhook.** Team/org subscriptions are behind a "contact us" form. | Product capability verified from their FAQ. Anything beyond a link is a commercial conversation with a small company on their timeline. **Do not put a Parallax data dependency on a milestone.** iOS 17.3+ for capture — Android players are excluded, which matters for a player PWA. Fallbacks if it stalls: Onform, V1 Golf, or your own capture on Stream (the expensive path Parallax exists to avoid). |
| **GolfCourseAPI** | Already integrated in RED. Add a cache table — a day. Free tier 50 req/day; Pro $9.99/mo for 10,000/day; ~30,000 courses. | API key. | Data shape verified from RED's own TypeScript interfaces (better evidence than their docs): club/course names, per-tee course rating, slope, bogey rating, par, and per-hole par/yardage/stroke index. **Operator NOT verified — no company named, no SLA, no status page.** That is key-man risk on a live production dependency. Insurance if it vanishes: `golfapi.io` (offers a full CSV database export, so you can hold the data outright). |
| **Calendly** | Inline embed: an afternoon, free. Handles timezones, buffers, reschedules, reminders. | Embed is free. **The v2 API's `invitee.created` webhook requires the account to be on Standard/Teams/Enterprise** — free plans get no webhooks at all. | Verified. The real question is whether a booked call must appear on the Atlas dashboard automatically. If yes, the paid requirement is **per coach account** — cost scales with roster and depends on coaches staying on a plan you don't control. Cheaper alternative: a coach-side "confirm this booking" step in Atlas. |
| **Deepgram** | Already integrated (30-line fetch wrapper — good code, leave the shape). ~$0.0043/min ≈ $0.04/session. | API key. | **Price from third-party aggregators, not Deepgram's page.** `nova-3` is reportedly the same batch price as `nova-2` (the premium is on streaming, which you don't use) — confirm on deepgram.com/pricing. If it isn't free, staying on nova-2 costs nothing. |
| **ElevenLabs** | Already integrated. ~$0.05/1k chars ≈ $0.20 per ten-turn session — roughly **5× the transcription cost** and the line item that scales with engagement. Creator tier $22/mo required for voice clones. | Account you already have. | **Price from aggregators, not the vendor page.** Vendor lock-in is genuine here in a way it isn't elsewhere: the clones are not portable, so a price change isn't shoppable. Add an Axiom event per TTS call with the character count so spend is visible before it's surprising. |
| **Anthropic API** | Already integrated. Current first-party rates per MTok in/out: `claude-opus-5` $5/$25 · `claude-sonnet-5` $3/$15 · `claude-sonnet-4-6` $3/$15 · `claude-haiku-4-5` $1/$5. | Key you have. | Verified. Fix the drift: use undated IDs (`claude-haiku-4-5`, not `claude-haiku-4-5-20251001`) and retire `claude-sonnet-4-5` in RED — it's a generation behind. A shared registry in eco makes this a one-file fix. |
| **Sentry** | ~10 lines/app. Free Developer tier: 5k errors/mo, 1 user. | Signup. | Verified sufficient at current scale. |
| **GHIN / USGA** | Nothing to integrate. Player types their GHIN number and index; you compute Course Handicap yourself. | **No self-serve API, no public developer portal.** Access is via an Approved Technology Provider agreement with the USGA or a regional Allied Golf Association — a contract, on someone else's timeline. | Gate and gatekeeper verified. **Scope, cost and application route NOT verified** — no primary USGA source found. Treat the eventual capability as unscoped. **Do not use the unofficial `ghin` npm package or scrape `api2.ghin.com`** — USGA ToS explicitly prohibits screen-scraping and database-scraping by name. That's a shutdown risk in a small industry. Note Arccos's licensed data includes handicap, which quietly solves freshness for connected players with no USGA relationship. |
| **Trackman / Garmin** | Deferred. Both have real APIs; neither is worth the calendar time yet. Trackman: GraphQL at `api.golf.trackman.com/graphql` + a Range REST API. Garmin: Golf Premium API (per-hole scorecard, launch-monitor metrics, GPS shot location). | Both gated: Trackman needs an agreement and a Subscription-Key, aimed at range/simulator operators. Garmin is "select partners, apply for pricing." | Trackman endpoints verified; **price unknown.** **Garmin's page returned nothing** — its capability list is second-hand from search summaries. Foresight and FlightScope have **no** public API at all (CSV export only), which is why §4 has a parser instead of four integrations. Revisit when you have enough connected players to make a partnership call worth someone's calendar. |

---

## 4. Build it ourselves

**Short list — that is the good news.** And more than half of it is *porting code that already exists in the prototypes*, not inventing anything.

**Genuinely new, and load-bearing:**

1. **The strokes-gained baseline.** A `(lie, distance bucket, handicap band) → expected strokes` table. **The only unbuyable thing in this whole document that everything else depends on.** Nothing on the market is the right shape: the USGA's "expected score" is a scorecard-adjustment device, not a shot-level surface; PGA Tour baselines (Kaggle, Data Golf) measure a 12-handicap against tour players and produce a large negative number in every category. The handicap-indexed framing *is* your differentiator. A few hundred rows to stand up (a day), then a recalibration habit. **Version the table and store which version produced each figure** — if the baseline is wrong, every index, radar axis and recommendation is wrong in the same direction and nothing looks broken. Derive the seed values and sanity-check them against Broadie rather than transcribing his tables (copyrighted).
2. **Transactional outbox + drain.** ~a day. One table per producer (`id, kind, payload jsonb, attempts, next_attempt_at, delivered_at, last_error`), written in the *same transaction* as the business row, one INSERT at the call site, one drain loop, one GitHub Actions workflow. The producer must never block on Atlas — which means an Atlas-side queue satisfies nothing. This also fixes Debrief's three "background jobs", which are currently fired **from the browser** (`DebriefFlow.tsx:270/277/287`) with no durable record and no retry. Add a row-count alert on undelivered rows older than an hour: an outbox nobody drains is worse than no outbox.
3. **Per-vendor CSV column mapper + unit inference.** papaparse gets you rows, not semantics. Keep the header sniffing, the `carry|distance|total` / `side|offline|lateral` regexes, ft/m detection, L/R-to-sign, and the `carry < 20` mishit drop. ~2–3 days for the first vendor, ~an hour each after. **Get one real export from each of the five monitors before writing the mapper** — no one has held those files. Version the mapping config and fail loudly on an unrecognised header rather than silently mapping the wrong column into carry distance.
4. **Idempotency keys** on every Atlas ingest endpoint. At-least-once delivery makes this a requirement, not a nicety.
5. **Course Handicap arithmetic.** `Index × (Slope ÷ 113) + (Course Rating − Par)`. An afternoon. GolfCourseAPI hands you all three inputs per tee.
6. **A cached `getFlag(app, key, user)` helper** — and then actually *enforcing* the limits that are currently decorative (LR's hardcoded 5-protocols-per-day, `organizations.license` validated-stored-displayed-never-enforced, RED's client-side 3-round cap). The tooling isn't the gap; the enforcement is.

**Already written in the prototypes — port, don't reach for a library:**

7. **The dispersion plotter.** ~150 lines at `Dashboard.dc.html:1028` + `buildPlots()` at `:4716`: five pointer handles, four independent radii, rotation, lefty mirroring, percentage space. Recharts has no concept of an independently-resizable four-radius ellipse and its ScatterChart owns its own coordinate space. **Half a day to port** vs a week fighting a chart library. Keep `touch-action: none` on the handles and use `setPointerCapture`, not window listeners. (Caveat: a scan read `buildPlots()` but not `startDrag()` at `:4133` in full — the pointer maths may be more work than half a day.)
8. **The practice calendar.** It's a day-strip heatmap (`c.segs`, `c.tags`, `c.mins`, `c.ghostW`), not a date picker — no calendar library exposes that cell model. ~20 lines of month maths; the streak loop at `:4884` is 3 lines and correct. **Bug to fix:** it hardcodes `TODAY` as an integer against a fixed `BASE`. Do day-bucketing in the player's local timezone or a session logged at 11pm reads as the next day and silently breaks the streak.
9. **The five SVG marks** — radar, trend polyline, roster sparkline, completion bar, ladder rungs. Dashboard has 2 `<svg>` tags total. The radar generator is ~15 lines of trig; the trend chart is one `<polyline>` in a stretched viewBox. Recharts would import ~500KB to reproduce output smaller than its own config, and the design has no tooltips anywhere — which is most of what a chart library sells. **Preserve `vector-effect="non-scaling-stroke"`** or the stretched viewBox makes the line weight wrong.
10. **Roster sort/filter, ICS export, relative time, PWA natives.** All four already work. The roster is 8–80 rows and three sort pills — 30 lines, not TanStack Table. The ICS generator (`:4623`) is ~25 lines emitting valid VCALENDAR with RRULE and VALARM — the `ics` package would be more code. Relative time is `Intl.RelativeTimeFormat`. `beforeinstallprompt` / `navigator.wakeLock` / `navigator.vibrate` are already used correctly. **One real bug:** every ICS event uses the fixed `UID:atlas-<kind>@atlas.golf`, so two players importing the same week collide and re-importing overwrites. Include the player id and block in the UID.

---

## 5. Avoid

**Architecture-level:**
- **Offline sync engines** — Replicache, ElectricSQL, PowerSync, RxDB. Tempting given the offline requirement, wrong here: each wants to own the data layer, which collides head-on with Drizzle owning the schema and per-app `NOBYPASSRLS` roles enforcing access at the database. You'd either bypass RLS or maintain the same authorisation logic twice. Your write pattern is a narrow append-only outbox, not bidirectional sync. Revisit only if the coach dashboard ever needs live multi-device collaborative editing. It doesn't.
- **LangChain / LlamaIndex / any vector DB (Pinecone, Weaviate, Chroma).** Debrief is the existence proof: a production voice-AI coach with transcription, streaming LLM, TTS, retrieval and three post-processing passes, built on four dependencies. A framework would wrap calls that are three lines each. And the discriminating fact against pgvector specifically: **Anthropic serves no embeddings model**, so vectors mean adopting a *new vendor* plus an embedding-refresh pipeline for one feature.
- **Managed queue services** — Inngest, Trigger.dev, QStash. Set an explicit revisit trigger rather than judging it repeatedly: **>10k outbox rows/day, or you find yourself writing a scheduler.** `pg-boss` is the upgrade path before any of these — but it needs a resident polling worker, and `ryp-core` is pinned at `autoscaling_limit_max_cu 0.25`.
- **LaunchDarkly / flag SaaS.** `public.feature_flags` already does more (it joins to billing via `plan_required`).
- **`next-pwa` for AtlasPlayer.** It's a Next webpack plugin — structurally impossible on Vite + Express. It's the obvious thing to copy from Debrief; it isn't a candidate.
- **Spreading Supabase.** `@supabase/ssr` is an auth-session library; running it alongside eco's Firebase bridge means two identity systems and two sets of RLS session variables against the same rows. Debrief's Supabase surface is the migration work, not a pattern.
- **react-router, TanStack Table for the roster, the `ics` package, a headless CMS, react-pwa-install.** Each is more code than what it replaces here.
- **A self-hosted Whisper deployment** to save four cents a session.

**Golf-data false leads** (so nobody re-runs this search at 11pm):
- **`ghin` npm / scraping `api2.ghin.com`** — explicit ToS violation, shutdown and reputational risk.
- **sportsfirst.net** (dev-agency lead-gen, cannot grant GHIN access) and **thebrassie.com** (asserts a "well-documented" GHIN API with no link, no endpoint, no access route).
- **golfintelligence.com** — $399–15,000/mo for what GolfCourseAPI provides at $9.99.
- **Data Golf** — genuinely good, wrong population (tour players).
- **Screenshot/OCR of launch-monitor displays.** The Dashboard prototype says "CSV or screenshot." Ship CSV only and cut the affordance from v1 — OCR of vendor displays under variable lighting is a separate hard project that will silently eat a fortnight.

**Dead weight to delete while consolidating** (all confirmed unused, one line each):
- `html2canvas` in LR (declared, zero imports, duplicated by html-to-image)
- `@tailwindcss/vite` in LR (a v4 plugin in an app running v3 — actively misleading)
- `dotenv` in RED (its own dev script already uses `node --env-file`; grep for `import 'dotenv/config'` first, and note `--env-file` does no variable expansion)
- `tailwindcss-animate` in both Express apps (RED's CSS imports `tw-animate-css`)
- RED's `components.json` pointing at a `tailwind.config.ts` that doesn't exist, and its dead `postcss.config.js`
- The three `@replit/vite-plugin-*` packages in LR — installed on every Railway production build, and `runtimeErrorOverlay` is imported unconditionally so the config fails to load if the package ever goes missing. Never add them to Atlas.

---

## 6. Decisions that keep the 2030 AI-coach option open

Free today. Don't design the model.

1. **Debrief joins the shared Neon DB.** This is the one consequential decision. Thousands of golfer transcripts paired with LLM-scored S.C.O.R.E. outcomes is the richest training signal the company will ever have — and if it stays on its own Supabase, you're running an export-and-reconcile project in 2029 instead of a query. Swapping the LLM SDK later is an afternoon; this is not. Plan the Firebase-UID ↔ Supabase-UID mapping table in `public.*` **before** the migration, not during — the IDs will not match.
2. **`source_app` and `scoring_version` on every table**, and version the strokes-gained baseline with the version stamped on each computed figure. Costs one column now; without it you cannot tell in 2029 which numbers came from which model of the world.
3. **One model registry in eco**, roles → model IDs, undated strings, SDK version pinned there. Fixes today's drift (four different Claude IDs across two apps, SDK `^0.90.0` vs `^0.91.1`) and makes the 2030 swap a one-file change.
4. **Clinical material stays in a separate table granted to `debrief_app` alone.** Any shared retrieval helper in eco must be *structurally incapable* of reaching those rows — not merely told not to. Get this right while there's one caller.
5. **Keep the coaching corpus as markdown + structured frontmatter in-repo.** Versioned, diffable, re-ingestible, and portable into whatever the training pipeline turns out to be.

---

## 7. What to do before 7 Sep

**Nothing from this list. The demo works.** The prototypes are static HTML served at `localhost:8899`; they don't import any of these packages and nothing here touches them. Every item above is work on the real apps.

Three small things are worth starting now — not because of the demo, but because they're gated on **other people's clocks**:

1. **Fix the FTS retrieval query and add an upsert key to `scripts/ingest-knowledge.ts` — before Luke writes his ~115 chunks.** Right now they'd never be retrieved, and the script does a bare `.insert()` with no unique key while LUKE.md tells him to re-run it as he refines (so every re-run duplicates every chunk). Half a day protects weeks of his writing.
2. **Start the Arccos signup.** Approval is explicitly at their discretion and may take time. Zero cost under 100 connected players, and the technical shape still needs verifying before you design the schema.
3. **Tighten eco's four peer-dependency lines.** Five minutes, converts three future silent-breakage bugs into install-time errors, and blocks nothing.

Everything else starts 8 Sep, in the order: Atlas React 19 + Tailwind v4 + shadcn copy (one afternoon, while Atlas is still nearly empty) → the four Express hardening lines → react-query + wouter + RHF before the screens exist → outbox → Sentry → the driver and Drizzle consolidation on a Neon branch.