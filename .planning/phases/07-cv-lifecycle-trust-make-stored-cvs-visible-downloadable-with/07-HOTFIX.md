# Phase 07 — HOTFIX: "View CV" never opened (production incident, 2026-08-11)

**Status:** fixed, awaiting authed smoke on production
**Severity:** P1 — the headline deliverable of Phase 7 was inert for every user
**Base:** `d821e4f` (Phase 7 merged and live)
**Surface:** the `View` control on the candidate detail page (both the "CV files"
section and the "Latest CV" panel)

---

## 1. The incident

Phase 7's core promise to the anchor customer was answering their #1 trust
complaint — _"I can't see the CV you're holding for me."_ The `View` control
shipped, looked correct, and passed every gate: typecheck, lint, 7 dedicated
unit tests, and a code review that specifically hardened this exact control
(CR-02).

In production it did nothing at all.

Clicking `View` opened a new tab that sat forever at `about:blank`. No file, no
error, no toast, no spinner. The recruiter's conclusion is the worst possible
one: the product is lying about holding their document.

## 2. Evidence (verified live, not inferred)

Behaviour observed directly against production:

| Observation | Implication |
|---|---|
| The server action responded **200 with a valid signed URL** | The server half was entirely correct — RLS read, guard, sign, audit all worked |
| **The client promise never settled** | Not a rejection. Not `{ok:false}`. Nothing. |
| **No branch ran** — not the success path, not the `catch`, not the `!result.ok` path, not the blocked-popup path | There was no error to handle, so no error handling could help |
| **No toast, no pending state** | `startTransition`'s callback never completed, so the button never even returned from "Opening…" via a real outcome |
| **Popup orphaned at `about:blank`** | The synchronously-opened tab was never navigated |
| `window.open`, `win.opener = null`, and delayed navigation each worked **in isolation** | None of the individual primitives were broken |

The conclusion the evidence forces: **the popup + async-server-action
combination itself was the broken piece.** Not the popup. Not the action. The
dance between them.

## 3. Why every gate missed it

This is the part worth remembering, because the gates were not weak — they were
aimed at the wrong thing.

- **jsdom cannot reproduce it.** `tests/unit/app/candidates/cv-file-link.test.tsx`
  had seven passing tests covering call ordering, navigation, opener severing,
  the failed-sign close, and the blocked-popup toast. All seven passed while
  the feature was dead. jsdom has no real popup, no real transient activation,
  and no real server-action transport — so the one interaction that actually
  broke was the one interaction the tests could not contain.
- **The code review made it *more* sophisticated, not more robust.** CR-02
  correctly identified a real WebKit popup-blocker bug and correctly fixed it
  (open synchronously, then navigate). The re-review (D-2) then correctly
  caught that `noopener` makes `window.open` return `null`. Both findings were
  right. But each round added machinery to a design whose fundamental problem
  was that it had client-side machinery at all.
- **The smoke spec asserted the right thing and was never run against the
  fixed build** — it checks for a non-`about:blank` popup URL, which is exactly
  the symptom. That assertion is retained and now passes by construction.

**Transferable lesson:** when a control's job is "open a file in a new tab,"
any design that routes a user gesture through a client-side promise is a design
with a failure mode that unit tests structurally cannot see. The fix is not
better mocks — it is removing the promise from the gesture path.

## 4. The rework

The architecture CR-02's own discussion pointed at: **a plain anchor to a GET
route handler that mints the signed URL server-side and 302-redirects.**

```
<a href="/candidates/{id}/cv-file/{cvId}" target="_blank" rel="noopener noreferrer">
        │
        └──> GET route handler
               auth → RLS-scoped row read → downloadable guard
               → createSignedUrl(60s) → export audit row → 302 Location: <signed URL>
```

No popup handle. No promise. No transition. No client state machine. The
browser opens the tab from the user's own gesture and follows a redirect —
which is WebKit-safe by construction and cannot be defeated by a popup blocker.

### Files

| File | Change |
|---|---|
| `src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts` | **NEW.** GET handler; ports `getCvFileUrlAction` verbatim, ends in a 302 |
| `src/app/(app)/candidates/[id]/cv-file-link.tsx` | Rewritten as a styled anchor; popup/transition/toast machinery deleted; no longer a Client Component |
| `src/app/(app)/candidates/[id]/actions.ts` | `getCvFileUrlAction` + its zod schema + 3 now-dead imports removed |
| `src/app/(app)/candidates/[id]/cv-files-panel.tsx` | Passes `candidateId={cv.candidate_id}` |
| `src/app/(app)/candidates/[id]/cv-review-panel.tsx` | Passes `candidateId={candidateCv.candidate_id}` |
| `tests/unit/app/candidates/cv-file-link.test.tsx` | Rewritten for anchor semantics (5 tests) |
| `tests/unit/app/candidates/cv-file-route.test.ts` | **NEW.** 9 tests; ports the action's tenancy/not-found/not-downloadable/PII/audit-order pins |
| `tests/smoke/authed/cv-lifecycle.smoke.ts` | **One line**: `getByRole('button', …)` → `getByRole('link', …)` |

### What was preserved exactly

Every security and compliance property of the deleted action was ported, not
re-derived:

- **RLS-scoped read** via `getCandidateCV` under the SSR client — a cross-tenant
  id surfaces as `not_found`, which is the tenancy barrier.
- **`isCvFileDownloadable` server-side mirror** of the UI's disabled state.
- **PII discipline** — Sentry captures the error *name* plus a fixed `subop`
  label only. `storage_path` (which embeds a slugified candidate name) is never
  captured. Pinned by a test that asserts the serialised Sentry call contains
  neither the path nor the name.
- **`recordExportAudit` before delivery**, filed against the CANDIDATE, carrying
  ids + integer version only.
- **The deliberate no-entitlement-gate stance** and its full rationale comment:
  withholding a customer's own file behind a billing state is a data-hostage
  posture we do not take.
- **`CV_SIGNED_URL_TTL_SECONDS = 60`.** This const *moved* into the route rather
  than staying shared: a `'use server'` module may only export async functions,
  so `actions.ts` could not have exported it, and the route is now its only
  consumer.

### The audit row got *stronger*

The old comment conceded that the `export` row's meaning ("a signed URL was
released to this user") depended on a **client contract** — `cv-file-link.tsx`
had to actually deliver the URL it received.

The incident is precisely the case where that contract broke: **a signed URL was
minted and an audit row filed for a document the recruiter never received.** The
audit log recorded accesses that did not happen.

With a redirect, release and delivery are the **same HTTP response**. If the 302
is returned, the URL reached the browser; if it isn't, no row was filed. The gap
a client bug could open no longer exists.

### Deliberate decisions

- **404 (`notFound()`) for missing row, wrong tenant, wrong candidate-in-path,
  and not-downloadable.** Uniform, so the route can't be used as an existence
  oracle for another org's data. Chosen over "redirect back to the candidate
  page" because this response lands in a *new tab* — bouncing the user to a
  second copy of the page they came from is more confusing than an honest 404,
  and the anchor isn't rendered in that state anyway.
- **502 + plain text on a failed sign**, reusing the exact user-facing copy from
  the action. There is no toast surface in a bare new tab, and the one thing
  this control must never do again is fail silently.
- **`cache-control: no-store`** on both the 302 and the 502. The `Location`
  header carries a live short-TTL credential; it must never sit in a shared
  cache or bfcache.
- **UUID shape-gate on both path segments** before any auth or DB work, matching
  the precedent in `src/app/admin/[orgId]/export/route.ts`.
- **Route-handler convention exception documented in-file.** CLAUDE.md reserves
  route handlers for webhooks/public APIs. File delivery needs a *navigable* GET
  that an `<a>` can target — a Server Action cannot be an anchor target.
  Precedent: `src/app/admin/[orgId]/export/route.ts`.
- **A raw `<a>`, never `next/link`** — the destination redirects cross-origin,
  so this must be a real document navigation, not a client route transition.

## 5. Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass, clean |
| `pnpm lint` | **0 errors**; 25 warnings, all pre-existing `_`-prefixed args in other test files. The 7 touched files produce **zero** output. |
| `prettier --check` (touched files) | pass |
| `pnpm vitest run` (full) | **79 files passed, 4 skipped; 959 tests passed, 28 todo, 0 failed** (was 952 — the deleted action's 7 tests replaced by 5 anchor + 9 route tests) |
| `pnpm build` | **pass** — compiled, Next TypeScript route-type validation finished, `/candidates/[id]/cv-file/[cvId]` registered as `ƒ (Dynamic)`. Required stubbing env vars locally (pre-existing condition); stub deleted, not committed. |
| Frozen Phase-6 files | **hash-identical to `d821e4f`** — `tests/smoke/authed/cv-intake.smoke.ts` `cd18fde…`, `src/lib/cv/parse-messages.ts` `95a21eb…` |

No migrations. No new dependencies. No production access.

## 6. Residual risk / what still needs a human

1. **The authed smoke has not been run against a deployed build.** This is the
   only gate that can actually prove the fix, because it is the only one that
   exercises a real browser. `pnpm smoke:auth` after deploy.
2. **The `notFound()` 404 page in a bare new tab is untested visually.** It is
   the app's standard not-found surface; worth an eyeball.
3. **Sentry `layer` tag changed** from `action` to `route` and `helper` from
   `getCvFileUrlAction` to `cvFileRoute`. Any saved Sentry search or alert
   keyed on the old values needs updating.
4. **Smoke timing nuance to watch:** `context.waitForEvent('page')` can return
   the popup before navigation commits. A server-side 302 is followed inside a
   single navigation, so the intermediate app URL should never commit as a
   document and `popup.url()` should be the storage URL — but if that assertion
   ever flakes, this is the reason, and the fix is to wait for a URL matching
   the storage origin rather than any `https?://`.
