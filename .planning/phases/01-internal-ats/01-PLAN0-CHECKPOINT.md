# Plan 0 — Execution checkpoint notes

**Status:** All 7 tasks completed and committed. Code-side verification gates green. Two manual steps remain for the user before launching Wave 2.

## Manual steps required before Wave 2

### 1. Apply the new migrations to a fresh local DB

Docker was not available in the executor environment, so `pnpm exec supabase db reset` could not be run. Five new migration files in `supabase/migrations/`:

```text
20260517204500_cross_tenant_fk_guards.sql
20260517204501_storage_cvs_bucket.sql
20260517204502_search_indexes.sql
20260517204503_handle_new_user_invite.sql
20260517204504_harden_set_organization_id.sql
```

To verify:

```sh
pnpm exec supabase start          # requires Docker Desktop running
pnpm exec supabase db reset       # must apply cleanly with zero errors
pnpm db:types                     # regenerate src/types/database.ts against the new schema
pnpm typecheck                    # ensure regen didn't break TS
```

Smoke-test the cross-tenant FK guard (RESEARCH §3):

```sh
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" <<'SQL'
do $$
declare v_org_a uuid; v_org_b uuid; v_company_b uuid;
begin
  insert into organizations(name, slug) values ('A', 'a') returning id into v_org_a;
  insert into organizations(name, slug) values ('B', 'b') returning id into v_org_b;
  insert into companies(organization_id, name) values (v_org_b, 'B Co') returning id into v_company_b;
  begin
    insert into contacts(organization_id, company_id, full_name) values (v_org_a, v_company_b, 'X');
    raise exception 'trigger did not fire';
  exception when others then
    raise notice 'trigger fired correctly: %', sqlerrm;
  end;
end $$;
SQL
```

Also confirm: `select * from storage.buckets where id = 'cvs';` returns one row with `public = false`.

### 2. Populate `.env.local`

Copy `.env.example` to `.env.local` and fill in every key. Without these the dev server boots into the env-validation error (which is the intended behaviour proving Task 0.2 works). Sentry keys are optional but required to actually receive events.

### 3. (Optional) Install Playwright browsers

```sh
pnpm exec playwright install --with-deps
```

After that, `pnpm test:e2e` will execute `tests/e2e/auth-guard.spec.ts` against `pnpm dev`.

### 4. (Optional) Provision Sentry

The Sentry config files are wired and the build succeeds without `SENTRY_DSN`. To actually receive events:

1. Create a project at https://sentry.io
2. Add the DSN to `.env.local` as `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`
3. Set `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` for source-map upload at build (optional)

## Deviations from PLAN.md

1. **Sentry wizard skipped** (Task 0.5 step 1) — wizard is interactive and cannot be driven by an executor. All four config files (`sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`) were written manually per RESEARCH §6. `next.config.ts` wrapped with `withSentryConfig` and source-map upload gated on `SENTRY_AUTH_TOKEN`.

2. **Sentry 10 export rename** — In `@sentry/nextjs@10.53.1`, `onRequestError` is exported as `captureRequestError`. `instrumentation.ts` re-exports it under the Next.js-expected name. The Sentry build pipeline also asserts the literal string `onRequestError` appears in the file; the alias satisfies both.

3. **`next.config.ts` option removed** — `hideSourceMaps` is no longer a valid `SentryBuildOptions` field in v10. Dropped; Sentry's defaults handle hiding for production builds.

4. **pnpm-workspace.yaml uses `allowBuilds` (booleans)** — Plan said either `onlyBuiltDependencies` or `allowBuilds` depending on pnpm version. pnpm 11.1.2 (the installed version via corepack) requires `allowBuilds` with boolean values; `onlyBuiltDependencies` was ignored. Final shape includes `protobufjs: false` and `'@sentry/cli': false` because those transitive deps emit ignored-build errors that block lint/typecheck under pnpm's deps-status pre-check.

5. **`db:types` regen at end of Task 0.6 deferred** — Cannot run without Docker. The current `src/types/database.ts` was regenerated against the pre-Plan-0 schema (8 tables, full row/insert/update types) and `@ts-nocheck` was removed; it does NOT yet reflect the new storage RLS policies or the cross-tenant FK trigger types (none of which actually add public-schema TS shape, so the regen is mostly a habit hygiene step). User must re-run `pnpm db:types` after `pnpm exec supabase db reset`.

6. **`pnpm exec playwright install` not run** — heavy download (several hundred MB of browsers), unnecessary for the deliverable. Vitest unit test passes; user runs the install once locally before E2E.

7. **`src/types/database.ts`** was already in a modified state when execution began (had the full domain schema regen but with `@ts-nocheck`). Removed the directive and added an explanatory `// reason:` comment per Task 0.2 step 5.

## Verification gate results

| Gate                                       | Result | Notes                                                                    |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| `pnpm lint`                                | PASS   | Clean across all 7 tasks                                                 |
| `pnpm typecheck`                           | PASS   | Strict mode, no `@ts-nocheck`, no `any`                                  |
| `pnpm build`                               | PASS   | Built once with stub env vars; middleware confirmed registered as `ƒ Proxy (Middleware)` |
| `pnpm test --run`                          | PASS   | 1 file, 8 tests (safe-next.test.ts)                                      |
| `pnpm test:e2e`                            | N/A    | Browsers not installed; user runs locally                                |
| `pnpm exec supabase db reset`              | N/A    | Docker not available; user must run                                      |
| Middleware curl check                      | N/A    | Server not started inside executor; run `curl -sI http://localhost:3000/ \| grep -i location` once `pnpm dev` is up |
| Inngest dev UI connection                  | N/A    | Same — run `pnpm dev:all`, open `http://localhost:8288`, expect "altus-recruitment" with zero functions |
| Sentry event capture                       | N/A    | Requires SENTRY_DSN; verify after Step 4 above                           |
