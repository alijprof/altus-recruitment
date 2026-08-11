# Cron monitoring runbook

> **Audience:** the founder (non-coding). This is the other half of the
> 2026-08-11 cron-hardening fix — the code changes alone are worthless
> without a Sentry alert actually watching them. Follow the setup steps
> below once, in the Sentry dashboard, and you're done.

## Why this document exists

Between **6 Aug 13:00 and 9 Aug 22:00 UTC**, every background AI job in
Altus went silent — no CV parses, no embeddings, no matching. Nobody was
told. The cause was a single stuck reconciler run holding a "only one at a
time" (concurrency-1) queue slot, which blocked every later cron run behind
it, for days, with zero visible signal anywhere.

Two things fix this:

1. **Code (done, this phase):** `embed-batch` and `reconcile-cv-parses` now
   carry a `timeouts` config that automatically cancels a run that wedges,
   instead of letting it block the queue indefinitely. They also emit a
   "heartbeat" event to Sentry on every tick, even when there's nothing to
   do — proof the cron is still alive.
2. **Sentry alert setup (you, one-time, below):** a heartbeat nobody is
   watching is just noise in a log. This runbook wires an alert that pages
   you the same day a heartbeat stops arriving, instead of you finding out
   from a customer.

## 1. Full inventory — every scheduled background job

| Function | Cadence | Concurrency | Has `timeouts`? | Has a heartbeat? |
|---|---|---|---|---|
| `embed-batch` | every 10 min (+ event-driven backfill) | 1 | **Yes** (added this phase) | **Yes** (added this phase) |
| `reconcile-cv-parses` | every 15 min | 1 | **Yes** (added this phase) | **Yes** (added this phase) |
| `refresh-outlook-subscription` | every 6 hours | 1 | No | Yes (pre-existing) |
| `stripe-reconcile` | daily, 05:00 London | 1 | No | Yes (pre-existing) |
| `cleanup-stale-summaries` | weekly, Monday 04:00 London | 1 | No | No |
| `spec-draft-cleanup-sweep` | daily, 03:30 London | 1 | No | No |
| `voice-note-audio-retention-sweep` | daily, 03:00 London | 1 | No | No |
| `spec-audio-retention-sweep` | daily, 03:00 London | 1 | No | No |

The four retention/cleanup sweeps at the bottom of this table are **not**
instrumented yet — they're concurrency-1 too, so the same wedge risk exists
for them in principle, but they weren't the cause of the 4-9 Aug incident and
adding heartbeats to them is out of scope for this phase. Flag it as a future
hardening pass if a similar silent gap shows up around retention/cleanup.

## 2. The exact heartbeat message to alert on

Each instrumented function emits a fixed Sentry message string, tagged
`layer: inngest`, **exactly once per run**, before it does any real work —
so it fires even on a run that finds nothing to process:

| Function | Sentry message string |
|---|---|
| `embed-batch` | `embed-batch:cron:heartbeat` |
| `reconcile-cv-parses` | `reconcile-cv-parses:cron:heartbeat` |
| `refresh-outlook-subscription` | `outlook:cron:heartbeat` |
| `stripe-reconcile` | `phase5:stripe-reconcile:heartbeat` |

These are the four strings you'll search for when setting up alerts below,
and the four strings to search for in Sentry when triaging a suspected
stall.

### One heartbeat = one run (and what that costs)

"Exactly once per run" is load-bearing, not a detail. Inngest re-runs a
function's handler once per step boundary, replaying everything that isn't
inside a step. The heartbeats therefore live *inside* a step — specifically as
the FIRST STATEMENT of each cron's first real step (WR-R2: a dedicated
heartbeat step would cost +1 step execution per run against the same step
quota whose exhaustion caused the 4-9 Aug outage). Before that they fired
once per step boundary, which is 3-4×
per tick and, worse, silently changed meaning every time a step was added
or removed. The "is below 1" alert below only works if the count is stable.

Expected steady-state volume, all from crons, nothing else running:

| Function | Cadence | Runs/day | Heartbeat events/day |
|---|---|---|---|
| `embed-batch` | every 10 min | 144 | 144 |
| `reconcile-cv-parses` | every 15 min | 96 | 96 |
| **Total** | | **240** | **~7,300/month** |

(Before the fix this was ~816/day ≈ 24,500/month.)

**Founder-side caveat:** `Sentry.captureMessage` consumes the **errors**
quota, not a separate one. Sentry's free tier is 5,000 errors/month, so
~7,300 heartbeats/month still exceeds it on its own — and once the quota is
exhausted, Sentry **drops real production errors**. If Sentry is on the free
tier, treat this as a live watch item: either upgrade the Sentry plan, or
migrate the heartbeats to Sentry's dedicated Crons check-in product (see the
upgrade path at the end of section 3), which does not bill against errors.
Do not "fix" it by making the heartbeat fire less often than the alert
window — that just breaks the alert.

## 3. Setting up the Sentry alert (do this once per heartbeat)

The current heartbeats are plain Sentry messages (`Sentry.captureMessage`),
not Sentry's dedicated "Crons" check-in product — so the alert type to use
is a **Metric Alert**, which supports "fire when this stops happening,"
rather than an Issue Alert (which only fires on occurrence).

For each of the four heartbeat strings in the table above:

1. In Sentry, open the project → **Alerts** → **Create Alert**.
2. Choose **Metric Alert** (not "Issue Alert").
3. Under **Metric**, select **Number of Events**.
4. Under **Filter**, search: `message:"<heartbeat string>"` — e.g.
   `message:"embed-batch:cron:heartbeat"`.
5. Under **Critical Trigger**, set the condition to **"is below" 1**, and
   pick a time window from Sentry's preset list that comfortably covers
   **two missed ticks** of that cron — generous enough that one late run
   never pages you:
   - `embed-batch` (10-min cron) → **30 minutes**
   - `reconcile-cv-parses` (15-min cron) → **1 hour**
   - `refresh-outlook-subscription` (6-hour cron) → **24 hours**
   - `stripe-reconcile` (daily 05:00) → **48 hours** (covers a skipped day
     without paging on normal run-time jitter)
6. Under **Actions**, add **Send a notification to** → your email (and
   Slack/PagerDuty if you have either wired to Sentry already).
7. **Save**. Repeat for the remaining three heartbeat strings.

That's four Metric Alerts total, each with a different filter string and
window. Once done, you're covered — no further action needed unless a
function's cadence changes.

**Future upgrade path (not required now):** Sentry also has a dedicated
"Crons" monitor product built specifically for this use case (schedule +
check-in margin + missed-run alerting), but it requires switching the code
from `Sentry.captureMessage` to `Sentry.captureCheckIn` with a monitor slug.
The Metric Alert approach above works with the code as it stands today and
needs no further engineering.

## 4. What each signal actually means

- **A heartbeat message stops arriving** → the run never even reached its
  first line of code. Either the whole app/deploy is down, Sentry itself
  isn't receiving events, or — most likely, per the incident this phase
  fixes — Inngest itself has stopped executing the function (see the quota
  caveat in section 6 below).
- **An `inngest/function.cancelled` event appears** (visible in the Inngest
  dashboard's Runs list, not in Sentry) → the hardening added this phase
  *worked as designed*. A run wedged past its `timeouts.start` or
  `timeouts.finish` window and Inngest cancelled it automatically, freeing
  the concurrency-1 slot so later runs could proceed. This is the queue
  **not** getting stuck for days — but it's still a signal something made
  that run wedge in the first place, and is worth a look even though nothing
  broke downstream.
  **Caveat — confirm this is actually switched on: see section 7.** Until
  the timeouts are visible on the Inngest dashboard's config page for both
  functions, treat "a cancelled-run event will appear" as unconfirmed rather
  than as a working safety net.

In short: a missing heartbeat means "investigate now, something is actually
stalled." A cancelled-run event means "the safety net caught something —
still worth understanding why, but the queue kept moving."

## 5. First three things to check when a stall is suspected

1. **Inngest dashboard → Usage/billing page.** Check the current month's
   step-count quota. This is checked *first* because if the account is at
   or near its plan's step cap, Inngest pauses execution for **every**
   function at once — this was the actual root cause of the 6-9 Aug
   silence, not a single broken function. If quota is the issue, no code
   fix here will help; the founder-side action is upgrading the Inngest
   plan (see section 6).
2. **Sentry → Issues, search each of the four heartbeat strings.** If only
   *one* function's heartbeat is missing, the problem is local to that
   function (and post-hardening, it's now bounded by `timeouts` rather than
   able to block everything else). If *all four* are missing at once, that's
   the account-level pause pattern from step 1 — go check quota, not code.
3. **Inngest dashboard → Functions → [the affected function] → Recent
   Runs.** Look for a run stuck `Running` past its `timeouts.finish` window
   (10 minutes for `embed-batch` / `reconcile-cv-parses`), or a run marked
   `Cancelled` — both confirm the wedge and roughly when it started.

## 6. The quota caveat — timeouts bound the damage, they don't remove it

The 2026-08-11 feedback-triage investigation found the real mechanism behind
the 6-9 Aug outage: **idle crons alone consume roughly half of the Inngest
free tier's monthly step quota**, the free tier caps execution at **five
concurrent steps account-wide**, and Inngest **pauses all execution** once
that quota is exhausted for the billing period. The stuck reconciler run
that held the concurrency-1 slot for days was the visible symptom; the free
tier's hard pause is what turned a stuck run into a multi-day, account-wide
outage.

**This phase's `timeouts` change bounds the blast radius of a single wedged
run — it does not remove the quota ceiling.** Even with the hardening in
place, an account that runs out of Inngest step quota will still pause every
scheduled function until the quota resets or the plan is upgraded. Paying
for the Inngest Pro plan is the single highest-leverage fix for the
reliability issues behind the whole 2026-08-11 feedback session, and it is a
founder-side billing action, not a code change — it is intentionally outside
this phase's scope.

## 7. One-time check: confirm `timeouts` is actually enforced on your plan

**Do this before you rely on anything in section 4.** Two minutes.

`timeouts: { start, finish }` is accepted by the Inngest SDK, so the code
compiles and syncs whether or not the platform honours it — the config is
enforced **by the Inngest platform**, not by our code. This runbook records
that the account is on the **free tier**, and the free tier's behaviour was
the root cause of the 4-9 Aug outage. If `timeouts` turns out to be a
paid-plan feature, or is simply ignored on the current plan, then the
headline fix of the cron-hardening work is **inert** and the
`inngest/function.cancelled` events described in section 4 will never
appear. Nobody has checked, so this document does not claim otherwise.

**The check:**

1. Inngest dashboard → **Functions** → `embed-batch` → its config page.
2. Confirm a **Timeouts** entry showing `start: 5m` and `finish: 10m`.
3. Repeat for `reconcile-cv-parses`.

**Record the outcome by editing this line:**

> Status: **NOT YET VERIFIED** on the live account (as of 2026-08-11).

- **If both show the timeouts** → section 4's cancelled-run signal is real.
  Change the line above to "Verified, `<date>`" and you are done.
- **If they do not appear, or the dashboard marks them as a paid feature** →
  say so on the line above, and treat the wedge protection as **absent**. A
  stuck run can then still hold its concurrency-1 slot indefinitely, which
  means: the missing-heartbeat alert from section 3 is your ONLY detection
  for it, and a wedge has to be cleared by hand (cancel the run in the
  dashboard). That makes upgrading the Inngest plan (section 6) more urgent,
  not less — the same upgrade fixes both this and the quota ceiling.
