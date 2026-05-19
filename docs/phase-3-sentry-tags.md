# Phase 3 — Sentry Tag Conventions

**Established:** Plan 03-00 Task 0.2 (Wave 0 hardening).
**Scope:** Every Phase 3 `Sentry.captureException` / `Sentry.captureMessage` MUST include the tag set documented below. Phase 3 introduces enough new attack surface (LinkedIn capture, spec-call audio, Sonnet ad generation, dormant-client outreach drafts, source-attribution reports) that we need to be able to slice Sentry events by feature without trawling stack traces. This file is the checklist every downstream plan's verification step links to.

Reference: PATTERNS §10 ("Sentry tags include `layer` + `function`/`helper`/`route`") + parse-cv.ts "VERIFICATION R4" comment ("Sentry captures wrap `err.name + status` only — never the raw error").

---

## Mandatory tag set

Every Phase 3 Sentry capture MUST include:

| Tag       | Type      | Allowed values                                                                                                                   | Notes                                                                                  |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `phase`   | string    | `'p3'`                                                                                                                           | Hard-coded literal — no interpolation. Lets us filter "everything Phase 3" in Sentry.  |
| `layer`   | string    | `'route-handler'` \| `'action'` \| `'db'` \| `'inngest'` \| `'ai-wrapper'` \| `'extension-ingest'`                                | The architectural layer that captured the error. One value per capture, no compounds.  |
| `function`\|`helper`\|`route` | string | One of: the Inngest function id, the DB helper export name, the route path. Pick the field that matches the `layer`. | Lets us pivot from "phase=p3 layer=inngest" to "which function".                       |

Optional but recommended:

| Tag          | When to include                                                                                | Example value                  |
| ------------ | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| `user_id`    | When the error is scoped to a single recruiter and the caller has it.                          | `'cafe…uuid'`                  |
| `subop`      | When the same function has multiple distinct internal steps and you want to disambiguate.      | `'recreate-after-expiry'`      |
| `model`      | AI-wrapper captures only — when the error is model-specific.                                   | `'voyage-3'`, `'whisper-1'`    |

**Forbidden in tags or extras:** raw `err.message`, transcript text, CV text, candidate name/email, client name, JD text, ad copy. These can echo into Sentry breadcrumbs and bypass the global `beforeSend` PII scrub. Sentry capture pattern is always:

```ts
Sentry.captureException(new Error(`<feature>.<subop>: ${err.name ?? 'UnknownError'}`), {
  tags: { phase: 'p3', layer: 'inngest', function: 'transcribe-and-structure-spec' },
})
```

---

## Tag set per file (Phase 3 new surface)

This table is the per-file checklist. Cross-reference before any Phase 3 plan's verification gate.

| File / Surface                                              | `layer`             | `function` / `helper` / `route`             | Plan        |
| ----------------------------------------------------------- | ------------------- | ------------------------------------------- | ----------- |
| **AI wrappers**                                             |                     |                                             |             |
| `src/lib/ai/ffmpeg.ts` — `recompressToOpus`                 | `ai-wrapper`        | `helper: 'recompressToOpus'`                | 03-00       |
| `src/lib/ai/ffmpeg.ts` — `probeDurationSeconds`             | `ai-wrapper`        | `helper: 'probeDurationSeconds'`            | 03-00       |
| `src/lib/ai/whisper.ts` — `transcribe`                      | `ai-wrapper`        | `helper: 'transcribe'`, `model: 'whisper-1'`| 03-02       |
| `src/lib/ai/spec-structure.ts`                              | `ai-wrapper`        | `helper: 'structureSpecDraft'`              | 03-02       |
| `src/lib/ai/job-ad.ts`                                      | `ai-wrapper`        | `helper: 'generateJobAd'`                   | 03-04       |
| `src/lib/ai/ad-inclusivity.ts`                              | `ai-wrapper`        | `helper: 'scoreInclusivity'`                | 03-04       |
| `src/lib/ai/jd-extract.ts`                                  | `ai-wrapper`        | `helper: 'extractJobDescription'`           | 03-02       |
| `src/lib/ai/outreach-draft.ts`                              | `ai-wrapper`        | `helper: 'draftOutreachEmail'`              | 03-05       |
| **Inngest functions**                                       |                     |                                             |             |
| `src/lib/inngest/functions/probe-ffmpeg.ts`                 | `inngest`           | `function: 'probe-ffmpeg'`                  | 03-00       |
| `src/lib/inngest/functions/transcribe-and-structure-spec.ts`| `inngest`           | `function: 'transcribe-and-structure-spec'` | 03-02       |
| `src/lib/inngest/functions/create-job-from-spec.ts`         | `inngest`           | `function: 'create-job-from-spec'`          | 03-02       |
| `src/lib/inngest/functions/embed-candidate-from-linkedin.ts`| `inngest`           | `function: 'embed-candidate-from-linkedin'` | 03-01       |
| `src/lib/inngest/functions/draft-outreach-email.ts`         | `inngest`           | `function: 'draft-outreach-email'`          | 03-05       |
| `src/lib/inngest/functions/spec-audio-retention-sweep.ts`   | `inngest`           | `function: 'spec-audio-retention-sweep'`    | 03-02       |
| `src/lib/inngest/functions/spec-draft-cleanup-sweep.ts`     | `inngest`           | `function: 'spec-draft-cleanup-sweep'`      | 03-02       |
| **Route handlers**                                          |                     |                                             |             |
| `src/app/api/linkedin/ingest/route.ts`                      | `route-handler`     | `route: '/api/linkedin/ingest'`             | 03-01       |
| **Server actions**                                          |                     |                                             |             |
| `src/app/(app)/spec/new/actions.ts` — `submitSpecCallAction`| `action`            | `helper: 'submitSpecCallAction'`            | 03-02       |
| `src/app/(app)/spec/[id]/review/actions.ts`                 | `action`            | `helper: 'approveSpecDraftAction'` etc.     | 03-02       |
| `src/app/(app)/jobs/[id]/ad-panel/actions.ts`               | `action`            | `helper: 'generateAdAction'` etc.           | 03-04       |
| `src/app/(app)/candidates/[id]/shortlist-actions.ts`        | `action`            | `helper: 'convertShortlistToApplicationAction'` | 03-03   |
| `src/app/(app)/clients/[id]/outreach-actions.ts`            | `action`            | `helper: 'sendOutreachAction'` etc.         | 03-05       |
| **DB helpers**                                              |                     |                                             |             |
| `src/lib/db/candidates-linkedin-upsert.ts`                  | `db`                | `helper: 'upsertCandidateFromLinkedIn'`     | 03-01       |
| `src/lib/db/spec-drafts.ts`                                 | `db`                | `helper: 'insertSpecDraft'` etc.            | 03-02       |
| `src/lib/db/job-ads.ts`                                     | `db`                | `helper: 'insertJobAd'` etc.                | 03-04       |
| `src/lib/db/dormant-clients.ts`                             | `db`                | `helper: 'listDormantClients'`              | 03-05       |
| **Extension ingest**                                        |                     |                                             |             |
| `chrome-extension/src/content-script.ts` (background → API) | `extension-ingest`  | `helper: 'scrapeProfile'`                   | 03-01       |

---

## Verification rule (per-plan automated check)

Each downstream Phase 3 plan's `<verify><automated>` step SHOULD include a grep gate equivalent to:

```bash
# Every captureException / captureMessage in Phase-3 new files MUST include phase:'p3'
new_files=$(git diff --name-only main...HEAD | grep -E '^(src|chrome-extension)/')
for f in $new_files; do
  if grep -q "captureException\|captureMessage" "$f"; then
    grep -q "phase: 'p3'" "$f" || echo "MISSING phase:'p3' tag in $f"
  fi
done
```

If the grep prints any lines, the plan FAILS verification.

---

## Cross-reference

- PATTERNS §10 — cross-cutting checklist (this file expands the "Sentry tags" row).
- `src/lib/inngest/functions/refresh-outlook-subscription.ts` — canonical heartbeat / capture pattern to mirror.
- `src/lib/ai/voyage.ts` — canonical AI-wrapper Sentry pattern to mirror (line 138).
- CLAUDE.md — "Server errors logged to Sentry with org_id + user_id context (NEVER log PII like CV text or candidate emails to Sentry)" — the rule this conventions doc enforces.
