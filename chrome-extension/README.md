# Altus — LinkedIn capture Chrome extension

Phase 3 Plan A. Recruiter opens a LinkedIn profile, clicks the Altus extension icon, and the profile lands in the Altus CRM in seconds — no form filling. See `.planning/phases/03-linkedin-capture-spec-workflow-shortlists/03-01-linkedin-ingest-PLAN.md` for the full spec.

## What this is

A Manifest V3 Chrome extension that:

1. Scrapes the visible LinkedIn profile DOM (`https://www.linkedin.com/in/*`).
2. Reads the recruiter's Supabase auth cookie from the Altus origin.
3. POSTs to `${ALTUS_ORIGIN}/api/linkedin/ingest` with a bearer token.

Decisions implemented: **D3-01** (MV3 extension, side-loaded), **D3-02** (bearer-from-cookie auth, not service-role), **D3-03** (fields captured, no photo URL), **D3-04** (dedup on LinkedIn URL or email), **D3-28** (popup-only UX, no DOM injection).

## Build

```bash
# From repo root:
pnpm --filter @altus/chrome-extension build
# Or, inside this directory:
pnpm build
```

Output lands in `chrome-extension/dist/`.

## Side-load (Phase 3 ships unpacked only)

1. Build the extension (above).
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked**.
5. Select the `chrome-extension/dist/` directory.

The extension's ID is pinned by the `key` field in `manifest.json` — it stays the same across reloads + side-loads on every recruiter's machine, which is how the backend's CORS allowlist works.

### Generating the manifest `key` (one-time, before first install)

```bash
openssl genrsa 2048 \
  | openssl rsa -pubout -outform DER 2>/dev/null \
  | base64 -w0
```

Paste the base64 string into `manifest.json` → `"key"`. Commit BOTH the public key (manifest) and store the private key in 1Password (NOT in the repo). The deterministic extension ID feeds the `LINKEDIN_EXTENSION_ID` env var that `/api/linkedin/ingest` reads for CORS.

## Configure the Altus origin

By default the extension targets the production origin (`https://altus-recruitment.vercel.app`). For local development:

1. Open the extension popup.
2. Right-click → **Inspect** → **Service Worker** console.
3. Run:
   ```js
   chrome.storage.sync.set({ altus_origin: 'http://localhost:3000' })
   ```

Reload the extension and it now POSTs to the local dev server.

## Test

```bash
pnpm test
# or from repo root:
pnpm test -- --run chrome-extension
```

Unit tests live in `chrome-extension/tests/`. The fixture `tests/fixtures/linkedin-profile-2026-05-19.html` is a fully anonymized snapshot — every name, company, email, location is a placeholder. **Never commit a real candidate's DOM.**

## Updating

Bump the `version` in both `manifest.json` and `package.json`, rebuild, and the backend's `X-Altus-Extension-Version` check enforces that recruiters reload before they can capture again (returns 426 Upgrade Required to stale clients).

## Limitations

- LinkedIn's DOM evolves quietly. The scraper uses a three-stage selector fallback (aria-label → data-view-name → h2-heading → class) — the popup surfaces a "couldn't read this profile well" message if the overall confidence is low.
- Rate-limited to one capture per 5 seconds per tab (D3-01 mitigation per LinkedIn TOS).
- Phase 3 ships unpacked only. Chrome Web Store submission is deferred to Phase 4 or later.
