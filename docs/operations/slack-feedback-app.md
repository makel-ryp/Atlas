# The feedback Slack app — setup

The in-app feedback button posts a note and a screenshot into Slack. This is the app it posts as.

**Channel:** `#atlas-feedback` — **`C0C93BY2JBH`**. Created 2026-10-15, **private**, for this and
nothing else.

Private is not a default here, it is the mitigation. A screenshot carries whatever was on the
sender's screen, and a coach's screen holds a student's name — falling back to their **email** —
their coaching notes **including the private tier**, and their intake answers: injuries, surgeries,
and the free-text *"why you are here"*. Some of those students are **minors**, and what a guardian
consented to was the child *using the app*, not that reaching Slack. Keep the member list short.

---

## 🔴 The scope that fails silently

`#atlas-feedback` is a **private** channel, so the history scope is **`groups:history`**, not
`channels:history`. Slack splits them, and the manifest below carries both so the app keeps working
if the channel ever changes type.

Without the right one, **everything posts and threading just never happens** — no error, no warning,
no clue in the logs. Each report becomes a new top-level message instead of landing under the
tester's thread for the day.

---

## Create it

[api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest** →
pick the RYP workspace → paste this:

```yaml
display_information:
  name: Atlas Feedback
  description: Carries in-app feedback and screenshots from Atlas into #atlas-feedback.
  background_color: "#1c1a17"
features:
  bot_user:
    display_name: Atlas Feedback
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write          # post the report and the per-tester parent message
      - files:write         # upload the screenshot (an incoming webhook CANNOT do this)
      - groups:history      # read recent messages to find today's thread — PRIVATE channels
      - channels:history    # the same, if the channel is ever public
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Then **Install to Workspace**, and copy the **Bot User OAuth Token** (`xoxb-…`) from
*OAuth & Permissions*.

## Invite the bot

In Slack, in `#atlas-feedback`:

```
/invite @Atlas Feedback
```

**Easy to forget, and it fails confusingly:** without this the token is valid and the scopes are
right, but every post returns `not_in_channel`.

## Set the variables

On the Railway **Testing** environment:

```
SLACK_BOT_TOKEN=xoxb-…
SLACK_FEEDBACK_CHANNEL=C0C93BY2JBH
```

Both are required. With either missing or malformed the route answers **503**, no button is
injected, and boot logs the variable **names** only — never a value.

The channel must be the **ID**, not `#atlas-feedback`. The config check rejects a `#name` at boot with
a message saying so, rather than failing later on the first send.

---

## What a report looks like

One parent message per tester per UTC day, carrying a marker `[fb:<userId>:<date>]`, with each
report threaded under it. The marker is how the thread is found again — there is no stored state, so
it survives a redeploy. If the history lookup fails the report posts **top-level instead of being
lost**.

Each report carries: who (display name and email), the path they were on, the viewport, the user
agent, their note, and the screenshot.

## ✅ Exercised against the live workspace — 2026-10-19

Both of the open questions below are now **answered**. A real report was sent through the deployed
Testing app (`POST /api/feedback`, a 480×160 PNG) and came back:

```json
{"ok":true,"permalink":"https://rypgolf.slack.com/archives/C0C93BY2JBH/p1792432084221159?thread_ts=…",
 "screenshot":"attached","threaded":true}
```

1. `files.completeUploadExternal` **does** accept the `files` parameter form-encoded as JSON —
   `screenshot: "attached"`.
2. Threading works — `threaded: true`, and the channel shows the parent carrying its
   `[fb:<userId>:<date>]` marker with replies under it. So `groups:history` is the right scope and
   it is granted.

If a future send posts the note but not the image, that is still where to look.

## ⚠️ The member list does NOT show the bot — do not read that as "not invited"

`conversations.members` through the Slack connector returned **1 member (@makel)** on 2026-10-15 and
again on 2026-10-19, on a channel the bot had already joined on 2026-10-15 (its join message is in
the history). The listing omits bot users. That reading cost a round trip and nearly cost a second
one: **check the channel HISTORY for the bot's join message, or just send a test report** —
`not_in_channel` comes back as `{"error":"slack_failed","reason":"not_in_channel"}` with a 502, which
is unambiguous. The member count is not evidence either way.

## Checking it from the outside

Makel's Slack is connected to Claude, so the quickest confirmation that a report landed is to read
the channel directly rather than hunting in the app.
