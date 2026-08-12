# Phase 8: Branded CV — Context (evidence-locked)

**Gathered:** 2026-08-12 (founder decisions captured live)
**Origin:** Feedback session 2026-08-11, item 2 (agency-branded CV generation) — see
`.planning/inbox/feedback-session-2026-08-11.md` and `feedback-triage-2026-08-11.md`.
**Status:** Ready for planning

<domain>
## What this phase delivers

After a CV parses (and after any manual corrections), the recruiter clicks one
action on the candidate page and gets a client-ready, agency-branded PDF of
that candidate: the org's colours and logo on one clean standard template,
filled from the candidate's current parsed data, with direct contact details
stripped so the client must come through the agency. The branded copy is
stored with the candidate's documents — clearly marked — and opens/downloads
exactly like stored CVs do (Phase 7 surface, including the export audit row).
</domain>

<decisions>
## Founder decisions — LOCKED 2026-08-12 (do not revisit)

1. **Output format: PDF first.** No DOCX in this phase; Word export is a
   possible follow-on if clients demand it.
2. **Contact details: stripped** on the branded copy (email, phone, address —
   name stays). Standard agency practice; protects the fee. Original CV
   untouched.
3. **Scope: full feature in one phase** — template + logo upload + generate
   action → stored branded PDF with View/Download. Not the thin-slice
   (branded page + print-to-PDF) variant the triage floated.
4. **Template: design a clean standard layout** — no existing Steele Charles
   template to replicate. One layout for all tenants, branded per-tenant via
   settings (founder's words: "putting the colour scheme and logo in the
   settings and then having that populate a standard CV template").

## Triage design correction — LOCKED (2026-08-11 triage)

- **Generate ON-DEMAND, never auto-on-parse.** Phase 7 made parsed data
  editable; an auto-generated copy would go stale the moment a field is
  corrected. Generation reads the candidate's CURRENT data at click time.

## Claude's Discretion

- Template visual design (professional recruitment-standard layout; which
  parsed fields render and their order), within BCV-02.
- Storage modelling for the branded artifact (new table vs. flagged
  candidate_cvs row vs. documents table) — planner decides after research;
  must preserve tenant RLS + audit patterns and BCV-06 idempotent regeneration.
- PDF generation mechanism — needs research (see open fork below).
</decisions>

<specifics>
## Known gaps and constraints (verified in repo, 2026-08-12)

- `Settings→Branding` stores `brand_primary`, `brand_secondary` (hex) and
  `logo_url` — the logo is **URL-only today** and **Steele Charles has no
  logo uploaded**. BCV-04 replaces this with a real upload flow (Supabase
  Storage); template must degrade gracefully with no logo.
- Parse coverage on template fill-fields is 94–100% (triage evidence), and
  Phase 7 lets recruiters correct the rest — so template fill is
  deterministic from `candidates` columns + extracted_data. **Zero AI spend
  in the generation path.**
- Delivery surface: reuse the Phase-7 pattern — a navigable GET route
  handler that signs and 302-redirects, with an export audit row before
  delivery (precedent: `src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts`).

## Open technical fork — resolve in planning, CONFIRM WITH FOUNDER before execute

- **PDF generation approach.** Candidates: `@react-pdf/renderer` (pure JS,
  Vercel-friendly), headless-Chromium print (heavy on serverless), `pdf-lib`
  (low-level). Researcher to appraise for Vercel serverless limits, font
  embedding, and logo image support. **CLAUDE.md requires founder sign-off on
  any new dependency** — present the recommendation before execution begins.

## Non-goals (explicitly out of this phase)

- DOCX/Word export; Outlook attachment send (follow-on candidates).
- Per-tenant custom template layouts.
- Anonymisation beyond contact-stripping (e.g. name redaction / blind CVs).
- Submission/float workflow changes (what gets SENT is untouched; this phase
  only produces and stores the artifact).
</specifics>

## Anchor-customer logo intel (founder shared the SC logo 2026-08-12)

Observed from the actual Steele Charles logo (founder pasted it in-session;
original file NOT yet on disk — founder to supply the file or upload it via
the BCV-04 flow at UAT):

- **Landscape lockup** (~3:2): circled "SC" monogram above a "Steele Charles"
  serif wordmark with "Ltd" between horizontal rules. The template header must
  accommodate a WIDE logo gracefully (not a square avatar slot).
- **Single-colour brand: a deep bottle/forest green** on white. Exact hex must
  be pixel-sampled from the real file at execution time (estimate ≈ #1a6b50
  family — do NOT hardcode; it becomes SC's `brand_primary` via settings).
- **White background, no transparency (as shared).** Design constraint: the
  template must place the logo on a white/light header area (a solid-colour
  header band would frame non-transparent logos in a white box). Upload flow
  should accept PNG/JPEG/SVG and not require transparency.
- Serif brand feel — the template's type choices should not clash (a neutral
  serif or clean sans both work; Claude's discretion per BCV-02).

<canonical_refs>
## Canonical references

- `.planning/inbox/feedback-session-2026-08-11.md` — item 2 raw voice note.
- `.planning/inbox/feedback-triage-2026-08-11.md` — triage, S-slice-vs-full
  options, clarification #2 (now answered), Phase 8 sequencing.
- `src/app/(app)/settings/branding/` — existing branding settings (colours + URL logo).
- `src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts` — the delivery/audit pattern to reuse.
</canonical_refs>
