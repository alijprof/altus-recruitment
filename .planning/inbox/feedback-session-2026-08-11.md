# Feedback session capture — 2026-08-11

Live capture during founder's feedback session (voice-noted item by item).
Raw log first; triage/organization happens after the founder says done.

## Items

<!-- appended as they arrive -->
### 1. CV storage visibility, revision control, and parse-data editing (raw voice note)
- Post-parse, the CV file itself feels unstored/invisible: "no storage of the CV" —
  need a clear, documented place on the candidate to VIEW the stored CV when
  revisiting them later.
- Revision control on CVs: updated CV arrives next year / slow placements →
  keep prior versions, drop in a new one, update — a visible revision history.
- Ability to EDIT parsed data after parse: "some of the parsing's not been
  fully correct" and "there's currently no way to do that" (from their view).
- Stricter control on parse→data-column transfer; flag uncertain/low-confidence
  fields more regularly; allow manual fill-in for anything unsure.
- Triage note (mine, for later — NOT discussed): candidate_cvs already versions
  files + "Previous CVs" list exists + "Review extracted data" sheet edits
  fields; parse stores confidence_per_field but UI may not surface it. Gap may
  be discoverability/UX rather than absence — verify what Liam actually sees.

### 2. Agency-branded CV generation (raw voice note)
- After parse, auto-generate a COMPANY-BRANDED version of the CV in the
  agency's format (per-tenant branding — e.g. Steele Charles branding for SC)
  for sending out to clients.
- Same template filled the same way every time (consistent client-facing look).
- The branded version lives alongside the original in the candidate's document
  storage/revision area, clearly marked as the branded one.
- Triage note (mine): natural fit as a post-parse artifact from extracted_data
  + org branding settings (settings/branding already exists); big feature —
  needs its own phase; ties into submission/float workflows (what gets sent).

### 3. Finish semantic search/matching + LinkedIn candidate sourcing (raw voice note)
- The natural-language database search ("Python engineer in Aberdeen") with
  match scores: highlighted as a useful tool — "maybe need to finish that off".
- Founder: "we have to pay the subscription on the Inngest tool — I hadn't
  paid it yet... the error with that was rate limiting."
- LinkedIn sourcing (bigger ask): for a live job, help FIND candidates —
  scrape LinkedIn / use an external dataset of LinkedIn-like data to SUGGEST
  potential candidates, taking the onus off the recruiter to source manually.
  Founder aware of third-party data sources; open to approaches.
- Triage notes (mine): (a) UNPAID INNGEST PLAN likely explains the 4-9 Aug
  stuck reconciler run + throttled cron cadence — free-tier limits; founder
  paying may fix background-job reliability wholesale. (b) Search itself works
  (verified live 5 Aug) — "finish off" = match-scoring UX + adoption. (c)
  LinkedIn scraping/data providers have big legal/ToS + GDPR implications —
  needs a proper options appraisal (providers, cost, compliance) before build.

### 4. Liam's website: niche repositioning + website→CRM data capture (raw voice note)
- Liam wants to go much more NICHE on his own website: heavy in LEGAL
  recruitment (places senior lawyers, big firms) but the site reads generic /
  "lifestyle company" — wants niche branding + affiliations with big names
  he's worked with.
- Better layout of client/candidate pages on the site; and better DATA CAPTURE
  from the website into the system — "link into the website so the data
  capture on it is a lot better".
- Founder's own hesitation, voiced explicitly: may be a can of worms; could
  hurt multi-tenant scalability; "might not sit within our niche and what
  we're building... but we're building it for his company". To think about
  and discuss — NOT a committed direction.
- Triage notes (mine): the existing public apply form is precisely the
  website→CRM capture channel and SC has never wired it into their site —
  cheapest first step may be embedding/linking that + a jobs-board page
  (public job listings per org) rather than becoming a website agency.
  Website design itself is likely a services conversation, not product.
