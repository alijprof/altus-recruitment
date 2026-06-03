# Smoke testing

Two layers, by safety profile. Layer A is the one that can run **anywhere,
anytime, by anyone (including CI or an agent)** because it never writes data.
Layer B is the full authenticated golden-path and is destructive, so it is
pinned to a throwaway database.

| Layer | Command | Target | Auth | Writes data? | Needs Docker? |
|-------|---------|--------|------|--------------|---------------|
| **A — Production health smoke** | `pnpm smoke` | deployed URL (default: live prod) | none (anonymous) | **No** | No |
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
- **Password-bypass guard** — confirms the dev-only `?password=1` sign-in is
  **not** exposed in production (a security regression check).
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

Default target: `https://altus-recruitment.vercel.app`.

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

The suite authenticates via the dev-only password fallback, gated by
`NEXT_PUBLIC_ALLOW_PASSWORD_AUTH=1`. Playwright sets this for the test dev
server (`playwright.config.ts` → `webServer.env`). If a dev server is **already
running** on `:3000`, Playwright reuses it as-is — restart that server with the
flag, or stop it so Playwright can spawn its own. Global-setup fails loudly with
this instruction if the password field never renders.

> CV-upload + Inngest parsing is intentionally skipped in the golden path
> (VERIFICATION R10) — Inngest isn't orchestrated inside Playwright.

---

## Driving your real Chrome

Add `SMOKE_CHROME=1` (or run `pnpm smoke:chrome`) to launch your installed
Google Chrome instead of bundled Chromium. If you connect the **Claude in
Chrome** extension (`/chrome` in Claude Code), an agent can also drive your
logged-in browser interactively for exploratory smoke walks.
