# Luke's prototype — the working copy

**This directory is the WORKING copy. The pristine original stays at**
`~/Desktop/ATR/websites/atlas/handoff/Golf coaching website project/` **and is never edited.**

`Dashboard.dc.html` was committed here **unmodified first**, so `git log -p proto/` is the reference:
the diff between that first commit and now is exactly what was stripped and what replaced it. There
is no separate "original" file to drift out of sync.

## What is being done to it

The prototype hardcodes ~70 data literals. They are being replaced, one at a time, with reads from a
single injected blob:

```js
const ROSTER = window.__ATLAS_DATA__?.roster ?? []
```

The server (`server/routes/proto.ts`) builds `__ATLAS_DATA__` from `ryp-core` and injects it as one
`<script>` before the file's own scripts run.

**Why one blob and not string substitution.** The first version regex-replaced keys inside his
literals in memory. It worked, but each literal needed its own fragile pattern, and it failed silently
in a way that mattered: overrides were emitted *before* his keys, so his values won and a real student
rendered carrying another player's handicap. One declared injection point makes the file state what it
needs, and makes missing data render as empty rather than as someone else's sample.

## The rule

**A stripped literal must never fall back to sample data.** `?? []` and `?? null`, never `?? {his
original}`. A screen with no data should look empty, because the alternative is a screen that looks
live and isn't — and that is the failure mode this whole approach exists to avoid.

`support.js` is his framework, unmodified and not ours to change.
