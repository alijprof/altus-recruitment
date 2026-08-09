# Smoke testing

Two layers, by safety profile. Layer A is the one that can run **anywhere,
anytime, by anyone (including CI or an agent)** because it never writes data.
Layer B is the full authenticated golden-path and is destructive, so it is
pinned to a throwaway database.

| Layer | Command | Target | Auth | Writes data? | Needs Docker? |
|-------|---------|--------|------|--------------|---------------|
| **A — Production health smoke** | `pnpm smoke` | deployed URL (default: live prod) | none (anonymous) | **No** | No |
| **A2 — Authenticated read-only smoke** | `pnpm smoke:auth` | deployed URL (default: live prod) | real user (magic-link relay) | **No** (read-only) | No |
| **A3 — Authenticated CV-intake smoke** | `pnpm smoke:auth` (same config, new spec file) | deployed URL (default: live prod) | real user (magic-link relay) | **Yes** — one scratch candidate + its CVs, deleted in `afterAll` | No |
| **B — Local golden path** | `pnpm test:e2e` | local `pnpm dev` | seed owner (password) | **Yes** | Yes |

---

## Layer A — production health smoke (`pnpm smoke`)

Non-destructive checks against a **deployed** environment. Safe to run against
live production because every check is an anonymous GET — no sign-in, no writes.

What it verifies (`tests/smoke/*.smoke.ts`):

- **Auth guard** — every authenticated route (incl. dynamic `/jobs/:id/pipeline`
  etc.) redirects an anonymous request to `/sign-in`. This is the first line of
  multi-tenant isolation; a route added outside the `(app)` group is caught here.
- **No 5xx** — sweeps every known route + GET-safe API endpoint; fails if any
  returns a server error.
- **Security headers** — HSTS, `x-content-type-options: nosniff`, `x-frame-options`.
- **Public pages render** — `/sign-in`, `/sign-up`, `/auth/auth-code-error` load
  with their key elements and **no uncaught client-side errors** (catches the
  "200 but white screen" failure that HTTP checks miss).
- **Password is opt-in** — magic link is the default; no password field renders
  until the user clicks the "Sign in with a password instead" toggle, and the
  legacy `?password=1` URL param no longer auto-reveals it.
- **Graceful not-found** — unknown apply-org slug and bogus invite token don't 5xx.

The route inventory lives in `tests/smoke/routes.ts` — keep it in sync when you
add routes under `src/app`.

### Knobs

```bash
pnpm smoke                                      # live production (default)
SMOKE_BASE_URL=https://<preview>.vercel.app pnpm smoke   # a Vercel preview
SMOKE_BASE_URL=http://localhost:3000 pnpm smoke # a running local dev server
pnpm smoke:headed                               # watch it in a browser
pnpm smoke:chrome                               # drive the real installed Chrome (channel: chrome)
```

Default target: `https://altusrecruit.com`.

---

## Layer A2 — authenticated read-only smoke (`pnpm smoke:auth`)

Signs in as a **real user** and confirms the authenticated shell renders for
every main section (dashboard, candidates/jobs/clients lists, pipeline board,
search, reports, settings). Still **non-destructive**: it never creates or edits
data, and deliberately avoids candidate *detail* pages (those write `audit_log`
entries) — so a run leaves no meaningful trace in the customer's audit trail.

Production sign-in is magic-link only (the password fallback is off in prod), so
a session is captured once via a **magic-link relay**. Supabase magic-link is
PKCE, so the link must be opened in the same browser context that requested it —
`relay-signin.mjs` keeps that one context alive across the whole flow.

```bash
# 1. Request the link and wait (keeps the PKCE context open):
SMOKE_AUTH_EMAIL=you@example.com node tests/smoke/authed/relay-signin.mjs

# 2. From your inbox, copy the sign-in URL and hand it to the relay:
echo 'https://…sign-in-link…' > tests/smoke/.auth/magic-link.txt
#    (an agent with inbox access — or the Claude-in-Chrome extension — can do
#     this step automatically; that is the "autonomous smoke" path)

# 3. Run the authenticated smoke against the captured session:
pnpm smoke:auth
```

The captured session lives at `tests/smoke/.auth/prod.json` and is **gitignored**
(it holds live tokens — never commit it). Supabase refresh tokens keep it usable
for repeat runs until they expire; re-run the relay to refresh.

---

## Layer A3 — authenticated CV-intake smoke (`tests/smoke/authed/cv-intake.smoke.ts`)

The project's mandatory AI-driven browser-automation pre-smoke for the CV
intake path (see `CLAUDE.md` → "HARD RULE #1"). It reuses the exact same
`pnpm smoke:auth` command, config, and captured session as Layer A2 — the new
spec file is picked up automatically by `playwright.smoke-auth.config.ts`'s
`testMatch: /.*\.smoke\.ts/`, with zero config changes.

Unlike Layer A2, this spec **writes real data** — it is the one deliberate
exception to "Layer A/A2 never write." It exercises the honest-message
contract end to end, through the real recruiter UI, against a real deployment:

- Creates **one scratch candidate** with a recognisable synthetic name
  (`GSD Phase06 Smoke <timestamp>`).
- Uploads three Tier-1 fixtures from `tests/fixtures/cv-corpus/` (PDF, DOCX,
  and a unicode-battery PDF) and asserts each one reaches "Parsing complete"
  with real populated fields in "Review extracted data" — not a green status
  over an empty profile. These three uploads drive real Haiku calls (a few
  pence of AI cost in the signed-in org).
- Uploads three Tier-2 fixtures (wrong-extension, an unsupported type, and a
  damaged/truncated PDF) and asserts the honest, type-specific refusal for
  each: the two immediate-reject cases never create a CV row or enter the
  in-progress state; the damaged-file case enters the in-progress state, then
  fails with a message naming the damage and **no retry control** (queried by
  accessible role/name, never CSS — retrying identically-damaged bytes cannot
  possibly succeed).
- Tracks `pageerror` across the whole run, same as Layer A2.
- `afterAll` **deletes every scratch candidate it created**, then re-asserts
  (via a fresh search) that each one is actually gone. A run that leaves
  residue in the signed-in org is treated as a bug in the spec itself.

**Write-and-clean-up contract:** this spec is safe to run repeatedly against
any deployment ONLY because every write it makes is scoped to candidates it
creates itself and named for exactly that purpose, and cleanup is asserted,
not just attempted. It must be run signed in as the **founder's own org**
(never a customer org) — the same session capture as Layer A2 determines
this, so capture a session for the founder's account before running it.

```bash
# Reuses Layer A2's session capture — see above if tests/smoke/.auth/prod.json
# is missing or stale; the spec fails fast with an actionable message either way.
SMOKE_BASE_URL=https://<preview-or-prod>.example.com pnpm smoke:auth
```

---

## Layer B — local authenticated golden path (`pnpm test:e2e`)

The full happy path: sign in → create candidate → create client → create job →
add candidate to job → drag the pipeline card. **It mutates data**, so it is
guarded to only run against a local, throwaway Supabase.

One-off setup:

```bash
pnpm exec supabase start     # local Postgres + Auth (requires Docker running)
pnpm test:e2e:reset          # apply migrations + seed (creates the seed owner)
# Ensure .env.local's NEXT_PUBLIC_SUPABASE_URL points at the local stack
```

Then:

```bash
pnpm test:e2e
```

### Safety guard

`tests/e2e/global-setup.ts` refuses to run if the resolved
`NEXT_PUBLIC_SUPABASE_URL` is **not** local — so the destructive suite can never
accidentally write to the anchor customer's cloud database. To deliberately run
against a non-local target (e.g. a disposable preview DB):

```bash
ALLOW_NONLOCAL_E2E=1 pnpm test:e2e
```

### Password sign-in

The suite authenticates with the always-available password method: global-setup
clicks the "Sign in with a password instead" toggle on `/sign-in`, then signs in
as the deterministic seed owner (`owner@acme-recruitment.test`, password set by
`supabase/seed.sql`). No env flag is required — password sign-in is a first-class
feature. Global-setup fails loudly if the password field never renders after the
toggle.

> CV-upload + Inngest parsing is intentionally skipped in the golden path
> (VERIFICATION R10) — Inngest isn't orchestrated inside Playwright.

---

## Driving your real Chrome

Add `SMOKE_CHROME=1` (or run `pnpm smoke:chrome`) to launch your installed
Google Chrome instead of bundled Chromium. If you connect the **Claude in
Chrome** extension (`/chrome` in Claude Code), an agent can also drive your
logged-in browser interactively for exploratory smoke walks.
