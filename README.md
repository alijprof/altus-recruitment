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
