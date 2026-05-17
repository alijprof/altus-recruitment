# Testing Patterns

**Analysis Date:** 2026-05-17

## Test Framework

**Runner:**
- Vitest — planned for unit tests, NOT YET INSTALLED (not in `package.json`)
- Playwright — planned for E2E tests, NOT YET INSTALLED (not in `package.json`)
- No `vitest.config.*` or `playwright.config.*` files exist in the repository

**Assertion Library:**
- Vitest built-in (planned)

**Run Commands (planned — scripts not yet in `package.json`):**
```bash
pnpm test              # Run all unit tests
pnpm test:e2e          # Run Playwright E2E tests
pnpm test:coverage     # Run with coverage report
```

**Current test script state:** `package.json` has no `test` script defined. Running `pnpm test` will fail.

## Test File Organization

**Location:**
- Unit tests: `tests/` directory at repo root (directory exists but is empty)
- No co-located test files in `src/` observed

**Naming (planned from CLAUDE.md):**
- `*.test.ts` or `*.spec.ts` for Vitest unit tests
- Playwright tests in `tests/` or a dedicated `e2e/` subdirectory

**Current state:**
```
tests/           # Directory exists, no files
```

## What Should Be Tested (from CLAUDE.md)

**Unit tests — Vitest — focus on logic that's easy to get wrong:**
- `src/lib/` utilities: AI parsing logic, RLS policy logic, fee calculations
- NOT trivial CRUD — skip testing boilerplate wrappers

**E2E tests — Playwright — critical user flows:**
1. Sign up (create account + organization)
2. Create candidate from CV upload
3. Search candidates (semantic + keyword fallback)
4. Create job/vacancy
5. Move candidate through pipeline stages

## Current Coverage

**Unit tests:** None — framework not installed
**E2E tests:** None — framework not installed

## Test Setup Requirements

Before writing any tests, install and configure:

```bash
# Unit testing
pnpm add -D vitest @vitejs/plugin-react

# E2E testing
pnpm add -D @playwright/test
npx playwright install
```

**Vitest config will need:**
- Next.js compatibility (jsdom environment for React components)
- `@/*` path alias resolution matching `tsconfig.json`
- Supabase client mocking strategy

**Playwright config will need:**
- Base URL pointing to local dev server
- Auth state persistence between tests (logged-in user fixture)
- Environment variable access for test Supabase project

## Mocking

**Framework:** Vitest built-in mocking — `vi.mock()`, `vi.fn()`, `vi.spyOn()`

**What to Mock:**
- Supabase client calls in unit tests — mock `@/lib/supabase/server` and `@/lib/supabase/client`
- Claude API calls — mock `@/lib/ai/claude.ts` (the typed wrapper, not raw Anthropic SDK)
- Voyage AI embeddings — mock in background job tests
- `next/navigation` functions (`redirect`, `useRouter`) in component tests

**What NOT to Mock:**
- Business logic utilities in `src/lib/` — test these against real inputs
- Fee calculation and scoring functions — these are correctness-critical
- RLS policies — test against a real Supabase test project or local `supabase start`

**Supabase mocking pattern (planned):**
```typescript
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}))
```

## Fixtures and Test Data

**Test Data:**
- No fixture files exist yet
- Future: factory functions for domain objects (candidates, jobs, organizations)

**Location:**
- Planned: `tests/fixtures/` or `tests/factories/`

## Coverage

**Requirements:** None currently enforced (no config)

**Target (from CLAUDE.md):** Focus on logic that's easy to get wrong — no specific percentage target stated

## AI-Specific Testing Considerations

**Claude wrapper (`src/lib/ai/claude.ts` — planned):**
- Mock in all unit tests — never make real API calls in tests
- Test error degradation paths: Claude unavailable → graceful fallback
- Test structured output parsing — tool use / JSON schema responses

**Cost logging:**
- Test that `ai_usage` table rows are written on every Claude call
- Use a test organization ID; assert `organization_id` is set correctly

**Background jobs (Inngest — planned):**
- Test job handler logic with mocked Supabase and Claude clients
- Do not test Inngest infrastructure itself

## Test Types

**Unit Tests:**
- Scope: Pure functions and utilities in `src/lib/`
- Approach: Direct function calls with input/output assertions
- No DOM rendering required for most lib utilities

**Integration Tests:**
- Scope: Server Actions + database interactions
- Approach: Requires running Supabase locally (`supabase start`)
- Run against isolated test tenant (dedicated `organization_id`)

**E2E Tests:**
- Framework: Playwright (not yet installed)
- Scope: Critical happy paths and auth flows
- Approach: Real browser against local dev server with seeded test data
- Auth: Use Supabase test users, store session state in `playwright/.auth/`

## Common Patterns (planned)

**Async Testing:**
```typescript
it('creates a candidate record', async () => {
  const result = await createCandidate({ organizationId: TEST_ORG_ID, ...data })
  expect(result.id).toBeDefined()
})
```

**Error Testing:**
```typescript
it('returns error when Claude is unavailable', async () => {
  vi.mocked(callClaude).mockRejectedValue(new Error('Service unavailable'))
  const result = await parseCv(mockCvText)
  expect(result.error).toBe('AI temporarily unavailable')
})
```

**Discriminated union state assertions:**
```typescript
expect(status.kind).toBe('error')
if (status.kind === 'error') {
  expect(status.message).toContain('Invalid email')
}
```

---

*Testing analysis: 2026-05-17*
