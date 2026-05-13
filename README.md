# Altus Recruitment

AI-first recruitment CRM. Multi-tenant SaaS. See [`docs/plan.md`](docs/plan.md) for the strategic
plan and [`docs/phase-1-tasks.md`](docs/phase-1-tasks.md) for the current phase breakdown.
Agent context lives in [`CLAUDE.md`](CLAUDE.md) — read that first if you're working on this.

## Stack

- Next.js (App Router) + TypeScript strict + Tailwind v4 + shadcn/ui
- Supabase (Postgres + Auth + Storage + RLS)
- Anthropic Claude, Voyage embeddings, OpenAI Whisper (added in later tasks)
- pnpm

## Local setup

```sh
pnpm install
cp .env.example .env.local        # fill in Supabase keys

# Once Supabase is provisioned (local Docker or cloud):
pnpm exec supabase start          # local stack
pnpm exec supabase db reset       # apply migrations
pnpm exec supabase gen types typescript --local > src/types/database.ts

pnpm dev                          # http://localhost:3000
```

## Scripts

| Command            | What it does                          |
|--------------------|---------------------------------------|
| `pnpm dev`         | Dev server                            |
| `pnpm build`       | Production build                      |
| `pnpm start`       | Run the production build              |
| `pnpm lint`        | ESLint                                |
| `pnpm typecheck`   | `tsc --noEmit`                        |
| `pnpm format`      | Prettier write                        |
| `pnpm format:check`| Prettier check                        |
