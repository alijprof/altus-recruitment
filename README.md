# Altus Recruitment

AI-first recruitment CRM. Multi-tenant SaaS. See [`docs/plan.md`](docs/plan.md) for the strategic
plan and [`docs/phase-1-tasks.md`](docs/phase-1-tasks.md) for the current phase breakdown.
Agent context lives in [`CLAUDE.md`](CLAUDE.md) — read that first if you're working on this.

## Stack

- Next.js (App Router) + TypeScript strict + Tailwind v4 + shadcn/ui
- Supabase (Postgres + Auth + Storage + RLS), Anthropic Claude, Voyage embeddings, Whisper
- Inngest (background jobs), Sentry (errors), Resend (email — later)
- pnpm

## Prerequisites

- Node.js 20+ and pnpm (`corepack enable pnpm` if missing)
- Docker Desktop (for the local Supabase stack)

## Local setup

```sh
pnpm install
cp .env.example .env.local        # fill every key (see below)

# Local Supabase + migrations + types
pnpm exec supabase start          # http://localhost:54323 (Studio)
pnpm exec supabase db reset       # apply migrations to a clean DB
pnpm db:types                     # regenerate src/types/database.ts

# Dev server (Next.js) + Inngest dev runner side-by-side
pnpm dev:all                      # Next on :3000, Inngest UI on :8288
# Or run each independently: `pnpm dev` + `pnpm inngest:dev`
```

### Required env keys in `.env.local`

| Key                                    | Source                                         |
| -------------------------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `supabase start` output / cloud project        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same                                           |
| `SUPABASE_SERVICE_ROLE_KEY`            | same — server-only                             |
| `ANTHROPIC_API_KEY`                    | https://console.anthropic.com — must `sk-ant-` |
| `INNGEST_EVENT_KEY` / `_SIGNING_KEY`   | https://app.inngest.com (local CLI has stubs)  |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`| https://sentry.io project settings (optional)  |
| `SENTRY_AUTH_TOKEN`                    | optional — only used to upload source maps     |

## Scripts

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `pnpm dev`             | Next.js dev server                                      |
| `pnpm dev:all`         | Next.js + Inngest dev runner in one terminal            |
| `pnpm inngest:dev`     | Inngest dev runner (Inngest UI at :8288)                |
| `pnpm build`           | Production build                                        |
| `pnpm start`           | Run the production build                                |
| `pnpm lint`            | ESLint                                                  |
| `pnpm typecheck`       | `tsc --noEmit`                                          |
| `pnpm format`          | Prettier write                                          |
| `pnpm test`            | Vitest (unit + lib helpers)                             |
| `pnpm test:e2e`        | Playwright (run `pnpm exec playwright install` once)    |
| `pnpm test:e2e:reset`  | Reset local Supabase before E2E run                     |
| `pnpm db:types`        | Regenerate `src/types/database.ts` from local Supabase  |

## Running E2E tests

Plan 5 ships a Playwright golden-path spec at `tests/e2e/golden-path.spec.ts` that walks
the Phase 1 happy path: sign in → create candidate → create client → create job → add
candidate to job → drag the pipeline card. The CV-upload + Inngest parsing step is
skipped intentionally (per VERIFICATION R10) so the spec stays deterministic without
running Inngest in the Playwright `webServer` config.

**Prerequisites** (one-time):

```sh
pnpm exec playwright install --with-deps        # install Playwright browsers
pnpm exec supabase start                        # local Supabase up on :54321
pnpm exec supabase db reset                     # apply migrations + seed
```

The seed in `supabase/seed.sql` creates a deterministic owner at
`owner@acme-recruitment.test`. The Playwright `global-setup.ts` signs that user in via
the Supabase admin API and persists the session to `tests/e2e/.auth/owner.json`. No
magic-link interception needed.

**Run the suite:**

```sh
# Terminal 1 — app + Inngest
pnpm dev:all

# Terminal 2 — Playwright
pnpm test:e2e                                   # run the suite
pnpm exec playwright test --list                # list specs (sanity-check)
pnpm test:e2e:reset && pnpm test:e2e            # reset DB then run
```

**Notes:**

- The suite is intentionally serial (`fullyParallel: false`) because the seed data is
  shared. Add `pnpm test:e2e:reset` between runs to start from a clean slate.
- CI integration is **not** part of Phase 1. Treat E2E as a local pre-merge smoke test.
- A 1-page fictional CV lives at `tests/fixtures/sample-cv.pdf`. Never replace it with a
  real candidate CV.
