#!/usr/bin/env node
// tests/fixtures/cv-corpus/generate.mjs
//
// Committed, auditable generator for the Phase 6 CV-intake fixture corpus.
// Regenerate the whole corpus deliberately with:
//   pnpm fixtures:regen
//
// SYNTHETIC-IDENTITY RULE (read this before touching this file):
// Every person, employer, email and phone number anywhere in this corpus is
// drawn EXCLUSIVELY from the SYNTHETIC_PEOPLE / SYNTHETIC_EMPLOYERS
// constants below. Nothing may ever be copied from a real CV, a real
// person, or production data. Emails are always @example.com. Phones are
// always the Ofcom drama range +44 7700 900xxx (never dialled, reserved by
// Ofcom for fiction). See README.md for the full rule and how to add a
// fixture.
//
// Zero new dependencies. Realistic PDFs are rendered by Playwright's
// already-installed Chromium (`page.pdf()`) from the HTML sources
// committed in sources/ (so the content is reviewable in a diff). DOCX/ODT
// fixtures are built with jszip, already an explicit devDependency
// (promoted in plan 06-01). Everything pathological (corrupt bytes, OLE2
// header, the encrypted-PDF dictionary, the ToUnicode-CMap NUL PDF) is
// hand-rolled raw bytes.
//
// Chromium version upgrades WILL change the exact PDF bytes it produces
// (font subsetting, internal metadata) — that is expected (threat T-06-11).
// Run this deliberately, not on every unrelated change. Layer-1/2
// assertions (added in later plans) key on extracted CONTENT via the
// manifest, never on byte hashes.
//
// Self-checks in this file mirror src/lib/ai/cv-extract.ts's
// extractTextFromBuffer()/normaliseWhitespace() logic (see
// "PRODUCTION-MIRROR" below) so fixtures are proven against what the
// current extractor actually does, not against an assumption. This file is
// plain Node ESM (no TS runner) so it cannot import the real .ts module —
// keep the mirror in sync by hand if cv-extract.ts's normalisation changes.

import { chromium } from '@playwright/test'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCES_DIR = join(__dirname, 'sources')
const TIER1_DIR = join(__dirname, 'tier1')
const TIER2_DIR = join(__dirname, 'tier2')
const HOSTILE_DIR = join(__dirname, 'hostile')

for (const dir of [SOURCES_DIR, TIER1_DIR, TIER2_DIR, HOSTILE_DIR]) {
  mkdirSync(dir, { recursive: true })
}

// Threat T-06-10 (Denial of Service): every fixture is capped at 1 MiB.
export const MAX_FIXTURE_BYTES = 1024 * 1024

// ---------------------------------------------------------------------------
// SYNTHETIC-IDENTITY RULE — the ONLY names/employers/contacts this corpus
// may ever contain. Every fixture below draws exclusively from this block.
// ---------------------------------------------------------------------------
export const SYNTHETIC_PEOPLE = {
  zoe: {
    name: "Zoë O'Brien-Şahin",
    email: 'zoe.obrien-sahin@example.com',
    phone: '+44 7700 900123',
  },
  wei: {
    name: '张伟',
    email: 'wei.zhang@example.com',
    phone: '+44 7700 900456',
  },
  aoife: {
    name: 'Aoife Ní Bhraonáin',
    email: 'aoife.nibhraonain@example.com',
    phone: '+44 7700 900789',
  },
  jan: {
    name: 'Jan Kowalski',
    email: 'jan.kowalski@example.com',
    phone: '+44 7700 900321',
  },
}
export const SYNTHETIC_EMPLOYERS = [
  'Northwind Offshore Ltd',
  'Cerulean Rail Group',
  'Solstice Grid Systems',
  'Meridian Subsea Ltd',
]

// A tiny (67-byte), widely-published, public-domain 1x1 transparent PNG —
// used wherever a fixture needs "a small embedded raster image". Not a
// photo, not PII, just a placeholder pixel.
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

// ---------------------------------------------------------------------------
// Tiny reporting helpers
// ---------------------------------------------------------------------------
const results = []
function record(tier, filePath, extra) {
  results.push({ tier, file: filePath, ...extra })
}

function assertUnderCap(bytes, label) {
  if (bytes.length === 0) return // zero-byte fixtures are deliberate (Tier-2)
  if (bytes.length > MAX_FIXTURE_BYTES) {
    throw new Error(
      `${label} is ${bytes.length} bytes — over the ${MAX_FIXTURE_BYTES}-byte fixture cap (T-06-10)`,
    )
  }
}

// ---------------------------------------------------------------------------
// PDF rendering (Playwright Chromium)
// ---------------------------------------------------------------------------
async function launchChromiumOrExit() {
  try {
    return await chromium.launch()
  } catch (err) {
    console.error(
      'FATAL: Playwright Chromium is not installed in this environment.\n' +
        'Run: pnpm exec playwright install chromium\n' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }
}

// Chromium stamps /CreationDate and /ModDate with the real current time on
// every render — that alone would make `pnpm fixtures:regen` non-idempotent
// on every single run, not just across Chromium upgrades (which is the only
// churn threat T-06-11 accepts). Both fields are a fixed-width, always-
// uncompressed literal in the /Info dictionary
// ("(D:YYYYMMDDHHMMSS+00'00')", 25 bytes), so replacing the digits with a
// fixed value in place preserves every downstream byte offset (xref table
// included) — no need to rebuild the file.
const PDF_DATE_PATTERN = /\(D:\d{14}[+-]\d{2}'\d{2}'\)/g
const PDF_FIXED_DATE = "(D:20260101000000+00'00')"

function stabilisePdfDates(buffer) {
  const latin1 = buffer.toString('latin1')
  const stabilised = latin1.replace(PDF_DATE_PATTERN, PDF_FIXED_DATE)
  return Buffer.from(stabilised, 'latin1')
}

async function renderPdfFromHtml(browser, html, playwrightPdfOptions = {}) {
  const page = await browser.newPage()
  try {
    await page.setContent(html)
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '40px', bottom: '40px', left: '30px', right: '30px' },
      ...playwrightPdfOptions,
    })
    // Copy out of Playwright's buffer immediately — downstream consumers
    // (self-check extraction in plan 06-03 task 2) can detach/neuter the
    // underlying ArrayBuffer, and we still need these bytes afterwards.
    return stabilisePdfDates(Buffer.from(pdf))
  } finally {
    await page.close()
  }
}

function writeSourceHtml(name, html) {
  const path = join(SOURCES_DIR, `${name}.html`)
  writeFileSync(path, html, 'utf8')
  return path
}

// ---------------------------------------------------------------------------
// DOCX building (jszip) — minimal viable OOXML package.
// ---------------------------------------------------------------------------

// jszip stamps each zip entry's local-file-header date with `new Date()` at
// generation time unless told otherwise — same non-idempotency problem as
// the PDF /CreationDate above. Every zip.file() call below passes this
// fixed date explicitly so two consecutive regenerations produce identical
// bytes.
const FIXED_ZIP_DATE = new Date('2026-01-01T00:00:00Z')
function zipOpts() {
  return { date: FIXED_ZIP_DATE }
}

const CONTENT_TYPES_BASE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>{EXTRA_OVERRIDES}</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

/**
 * Build a minimal valid DOCX. `bodyXml` is the raw contents of <w:body>
 * (paragraphs/tables/etc, already-escaped XML). `extraParts` is an array of
 * { path, content, contentTypeOverride, relationship } for header/footer
 * parts.
 */
async function buildDocx({ bodyXml, extraParts = [] }) {
  const zip = new JSZip()

  const overrides = extraParts.map((p) => p.contentTypeOverride).join('')
  zip.file(
    '[Content_Types].xml',
    CONTENT_TYPES_BASE.replace('{EXTRA_OVERRIDES}', overrides),
    zipOpts(),
  )
  zip.file('_rels/.rels', ROOT_RELS, zipOpts())

  const docRels = extraParts.map((p) => p.relationship).filter(Boolean)
  if (docRels.length > 0) {
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join('')}</Relationships>`,
      zipOpts(),
    )
  }

  for (const part of extraParts) {
    zip.file(part.path, part.content, zipOpts())
  }

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${bodyXml}</w:body></w:document>`,
    zipOpts(),
  )

  stabiliseZipFolderDates(zip)
  return zip.generateAsync({ type: 'nodebuffer' })
}

// jszip auto-creates parent-directory entries for nested paths (e.g.
// "_rels/", "word/") that never go through an explicit zip.file(..., {
// date }) call above — they get stamped with the real `new Date()` at
// generation time regardless. Force every entry (files AND the
// auto-created folders) to the fixed date right before serialising, or
// `pnpm fixtures:regen` silently produces a different DOCX every run.
function stabiliseZipFolderDates(zip) {
  for (const entry of Object.values(zip.files)) {
    entry.date = FIXED_ZIP_DATE
  }
}

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}
function heading(text) {
  return `<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}
function tableRow(cells) {
  return `<w:tr>${cells.map((c) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`
}
function table(rows) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.map(tableRow).join('')}</w:tbl>`
}

// ---------------------------------------------------------------------------
// TIER 1 — "MUST PARSE"
// ---------------------------------------------------------------------------

const { zoe, wei, aoife, jan } = SYNTHETIC_PEOPLE
const [employerA, employerB, employerC, employerD] = SYNTHETIC_EMPLOYERS

async function buildTier1(browser) {
  // --- t1-pdf-single-column.pdf --------------------------------------
  const singleColumnHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; line-height: 1.5; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  h2 { font-size: 14px; border-bottom: 1px solid #999; margin-top: 22px; margin-bottom: 8px; }
  .contact { color: #444; margin-bottom: 18px; }
  .role { margin-bottom: 14px; }
  .role .title { font-weight: bold; }
  .role .meta { color: #555; font-style: italic; }
  ul { margin: 4px 0 0 0; padding-left: 18px; }
</style></head>
<body>
  <h1>${zoe.name}</h1>
  <div class="contact">${zoe.email} | ${zoe.phone} | Aberdeen, UK</div>

  <h2>Profile</h2>
  <p>Offshore renewables project engineer with over a decade of experience delivering
  cable-route surveys, substation commissioning and stakeholder liaison across UK and
  European wind farm developments. Comfortable leading cross-functional teams through
  detailed design review and on-site commissioning.</p>

  <h2>Experience</h2>
  <div class="role">
    <div class="title">Senior Project Engineer — ${employerA}</div>
    <div class="meta">March 2019 — Present</div>
    <ul>
      <li>Led cable-route survey planning for three consented offshore sites, coordinating
      with regulatory bodies and subcontractor dive teams.</li>
      <li>Managed a £4.2m commissioning budget across two substation upgrades, delivering
      both ahead of the contractual milestone.</li>
      <li>Mentored two graduate engineers through their Chartership portfolios.</li>
    </ul>
  </div>
  <div class="role">
    <div class="title">Project Engineer — ${employerB}</div>
    <div class="meta">August 2014 — February 2019</div>
    <ul>
      <li>Delivered signalling upgrade works across four regional depots, coordinating
      possession windows with the infrastructure controller.</li>
      <li>Wrote the risk register template still in use across the engineering
      programme office.</li>
    </ul>
  </div>
  <div class="role">
    <div class="title">Graduate Engineer — ${employerC}</div>
    <div class="meta">September 2012 — July 2014</div>
    <ul>
      <li>Rotated across grid-connection design, site supervision and asset
      management, gaining an IEng-track portfolio.</li>
    </ul>
  </div>

  <h2>Education</h2>
  <p>MEng Civil &amp; Offshore Engineering, University of Aberdeen, 2008–2012 — First Class.</p>
  <p>Incorporated Engineer (IEng), Institution of Civil Engineers, 2016.</p>

  <h2>Skills</h2>
  <p>Cable-route survey design, substation commissioning, stakeholder liaison, risk
  registers, AutoCAD, Primavera P6, IEC 61850, offshore HSE (GWO certified).</p>

  <h2>Referees</h2>
  <p>Available on request.</p>
</body></html>`
  writeSourceHtml('t1-pdf-single-column', singleColumnHtml)
  const singleColumnPdf = await renderPdfFromHtml(browser, singleColumnHtml)
  assertUnderCap(singleColumnPdf, 't1-pdf-single-column.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-single-column.pdf'), singleColumnPdf)
  record(1, 'tier1/t1-pdf-single-column.pdf', { bytes: singleColumnPdf.length })

  // Filename-with-spaces-and-unicode: exercises slugifyFilename in
  // src/app/(app)/candidates/[id]/actions.ts. Same bytes, awkward name.
  const awkwardName = 't1-pdf-filename with spaces & ünicode.pdf'
  writeFileSync(join(TIER1_DIR, awkwardName), singleColumnPdf)
  record(1, `tier1/${awkwardName}`, { bytes: singleColumnPdf.length })

  // --- t1-pdf-bom-prefixed.pdf / t1-pdf-junk-prefixed.pdf --------------
  // Review 2026-08-09 CR-02. pdf.js's checkHeader() searches the first 1024
  // bytes for "%PDF-" (not offset 0) precisely because leading junk before
  // the header occurs in the wild: a UTF-8 BOM from a naive re-save, a mail
  // gateway preamble, concatenated output. Both of these extract IDENTICALLY
  // to t1-pdf-single-column.pdf (pdf.js moveStart()s the stream to the
  // header, so every xref offset still resolves) — which is the whole point:
  // they are files the pipeline has always parsed fine, and any sniffer
  // stricter than the parser hard-rejects them.
  //
  // Both prefixes are FIXED byte sequences over an already-deterministic
  // buffer, so these stay byte-stable and `pnpm fixtures:regen` stays
  // idempotent.
  const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
  const bomPrefixedPdf = Buffer.concat([UTF8_BOM, singleColumnPdf])
  assertUnderCap(bomPrefixedPdf, 't1-pdf-bom-prefixed.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-bom-prefixed.pdf'), bomPrefixedPdf)
  record(1, 'tier1/t1-pdf-bom-prefixed.pdf', { bytes: bomPrefixedPdf.length })

  const GATEWAY_PREAMBLE = Buffer.from(
    '\r\n   MIME-Version: 1.0 (mail gateway preamble)\r\n',
    'latin1',
  )
  const junkPrefixedPdf = Buffer.concat([GATEWAY_PREAMBLE, singleColumnPdf])
  assertUnderCap(junkPrefixedPdf, 't1-pdf-junk-prefixed.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-junk-prefixed.pdf'), junkPrefixedPdf)
  record(1, 'tier1/t1-pdf-junk-prefixed.pdf', { bytes: junkPrefixedPdf.length })

  // --- t1-pdf-two-column.pdf ------------------------------------------
  const twoColumnHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  .contact { color: #444; margin-bottom: 12px; }
  .columns { column-count: 2; column-gap: 28px; }
  h2 { font-size: 13px; border-bottom: 1px solid #999; margin-top: 4px; margin-bottom: 6px;
       break-after: avoid; }
  .role { margin-bottom: 10px; break-inside: avoid; }
  .role .title { font-weight: bold; }
</style></head>
<body>
  <h1>${wei.name}</h1>
  <div class="contact">${wei.email} | ${wei.phone} | Glasgow, UK</div>
  <div class="columns">
    <h2>Profile</h2>
    <p>Structural engineer specialising in wind turbine foundation design, with a
    background spanning consultancy and contractor-side delivery across four
    grid-connection programmes.</p>

    <h2>Experience</h2>
    <div class="role">
      <div class="title">Structural Engineer — ${employerD}</div>
      <p>Led foundation design reviews for a 40-turbine array, liaising directly
      with the geotechnical survey team and the client's independent checker.</p>
    </div>
    <div class="role">
      <div class="title">Design Engineer — ${employerA}</div>
      <p>Delivered detailed design packages for jacket foundations, working closely
      with the fabrication yard to resolve tolerance queries during build.</p>
    </div>
    <div class="role">
      <div class="title">Junior Engineer — ${employerC}</div>
      <p>Supported cable-route survey planning and produced as-built drawing sets
      for the client's asset register.</p>
    </div>

    <h2>Education</h2>
    <p>MSc Structural Engineering, University of Strathclyde, 2015–2016.</p>
    <p>BEng Civil Engineering, University of Strathclyde, 2011–2015.</p>

    <h2>Skills</h2>
    <p>Foundation design, geotechnical liaison, Tekla Structures, Eurocode 3,
    fabrication tolerance review, client reporting.</p>
  </div>
</body></html>`
  writeSourceHtml('t1-pdf-two-column', twoColumnHtml)
  const twoColumnPdf = await renderPdfFromHtml(browser, twoColumnHtml)
  assertUnderCap(twoColumnPdf, 't1-pdf-two-column.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-two-column.pdf'), twoColumnPdf)
  record(1, 'tier1/t1-pdf-two-column.pdf', { bytes: twoColumnPdf.length })

  // --- t1-pdf-tables-headers-footers.pdf -------------------------------
  const tablesHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; font-size: 11px; }
  th { background: #eee; }
  .avatar { width: 40px; height: 40px; float: right; }
</style></head>
<body>
  <img class="avatar" src="data:image/png;base64,${TINY_PNG_BASE64}">
  <h1>${aoife.name}</h1>
  <p>${aoife.email} | ${aoife.phone} | Portfolio: <a href="https://example.com/portfolio/aoife-ni-bhraonain">example.com/portfolio/aoife-ni-bhraonain</a></p>

  <h2>Employment History</h2>
  <table>
    <tr><th>Employer</th><th>Role</th><th>Dates</th></tr>
    <tr><td>${employerB}</td><td>Principal Consultant</td><td>2020 – Present</td></tr>
    <tr><td>${employerD}</td><td>Senior Consultant</td><td>2016 – 2020</td></tr>
    <tr><td>${employerC}</td><td>Consultant</td><td>2013 – 2016</td></tr>
  </table>

  <h2>Summary</h2>
  <p>Rail systems consultant with cross-programme experience in signalling
  interlocking design, possession planning, and client-facing programme reporting.
  Full case studies available at the portfolio link above.</p>
</body></html>`
  writeSourceHtml('t1-pdf-tables-headers-footers', tablesHtml)
  const tablesPdf = await renderPdfFromHtml(browser, tablesHtml, {
    displayHeaderFooter: true,
    headerTemplate:
      '<div style="font-size:8px; width:100%; text-align:center;">CONFIDENTIAL CV</div>',
    footerTemplate:
      '<div style="font-size:8px; width:100%; text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  })
  assertUnderCap(tablesPdf, 't1-pdf-tables-headers-footers.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-tables-headers-footers.pdf'), tablesPdf)
  record(1, 'tier1/t1-pdf-tables-headers-footers.pdf', { bytes: tablesPdf.length })

  // --- t1-pdf-unicode.pdf ------------------------------------------------
  const unicodeBodyHtml = buildUnicodeBatteryHtml('pdf')
  writeSourceHtml('t1-pdf-unicode', unicodeBodyHtml)
  const unicodePdf = await renderPdfFromHtml(browser, unicodeBodyHtml)
  assertUnderCap(unicodePdf, 't1-pdf-unicode.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-unicode.pdf'), unicodePdf)
  record(1, 'tier1/t1-pdf-unicode.pdf', { bytes: unicodePdf.length })

  // --- t1-pdf-linkedin-export.pdf -----------------------------------------
  // Approximates the LinkedIn "Save to PDF" shape: bold name block, a fixed
  // set of ALL-CAPS section headings, dense single-line-break lists rather
  // than styled prose.
  const linkedinHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; }
  .name { font-size: 24px; font-weight: bold; }
  .headline { font-size: 13px; color: #333; margin-bottom: 12px; }
  .heading { font-size: 12px; font-weight: bold; text-transform: uppercase; margin-top: 16px;
             border-top: 1px solid #ccc; padding-top: 8px; }
  .line { margin: 2px 0; }
</style></head>
<body>
  <div class="name">${jan.name}</div>
  <div class="headline">Senior Grid Connections Engineer at ${employerC}</div>

  <div class="heading">Contact</div>
  <div class="line">${jan.email}</div>
  <div class="line">${jan.phone}</div>
  <div class="line">www.linkedin.com/in/jan-kowalski-example</div>

  <div class="heading">Top Skills</div>
  <div class="line">Grid Connections</div>
  <div class="line">HV Substation Design</div>
  <div class="line">Stakeholder Management</div>

  <div class="heading">Experience</div>
  <div class="line"><strong>${employerC}</strong></div>
  <div class="line">Senior Grid Connections Engineer</div>
  <div class="line">January 2021 - Present (4 yrs)</div>
  <div class="line">Warsaw, Poland</div>
  <div class="line"><strong>${employerA}</strong></div>
  <div class="line">Grid Connections Engineer</div>
  <div class="line">June 2017 - December 2020 (3 yrs 7 mos)</div>
  <div class="line">Krakow, Poland</div>

  <div class="heading">Education</div>
  <div class="line"><strong>AGH University of Krakow</strong></div>
  <div class="line">MSc, Electrical Power Engineering</div>
  <div class="line">2012 - 2017</div>
</body></html>`
  writeSourceHtml('t1-pdf-linkedin-export', linkedinHtml)
  const linkedinPdf = await renderPdfFromHtml(browser, linkedinHtml)
  assertUnderCap(linkedinPdf, 't1-pdf-linkedin-export.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-linkedin-export.pdf'), linkedinPdf)
  record(1, 'tier1/t1-pdf-linkedin-export.pdf', { bytes: linkedinPdf.length })

  // --- t1-pdf-long-40-pages.pdf -------------------------------------------
  const longHtml = buildLongCareerHistoryHtml()
  writeSourceHtml('t1-pdf-long-40-pages', longHtml)
  const longPdf = await renderPdfFromHtml(browser, longHtml)
  assertUnderCap(longPdf, 't1-pdf-long-40-pages.pdf')
  writeFileSync(join(TIER1_DIR, 't1-pdf-long-40-pages.pdf'), longPdf)
  record(1, 'tier1/t1-pdf-long-40-pages.pdf', { bytes: longPdf.length })

  // --- t1-docx-simple.docx -------------------------------------------------
  const simpleDocx = await buildDocx({
    bodyXml: [
      heading(aoife.name),
      paragraph(`${aoife.email} | ${aoife.phone}`),
      heading('Profile'),
      paragraph(
        'Rail systems consultant with cross-programme experience in signalling ' +
          'interlocking design and possession planning.',
      ),
      heading('Experience'),
      paragraph(`Principal Consultant — ${employerB} (2020 – Present)`),
      paragraph(`Senior Consultant — ${employerD} (2016 – 2020)`),
      heading('Education'),
      paragraph('MEng Railway Systems Engineering, University of Birmingham.'),
    ].join(''),
  })
  assertUnderCap(simpleDocx, 't1-docx-simple.docx')
  writeFileSync(join(TIER1_DIR, 't1-docx-simple.docx'), simpleDocx)
  record(1, 'tier1/t1-docx-simple.docx', { bytes: simpleDocx.length })

  // --- t1-docx-tables-headers-textbox.docx ---------------------------------
  const headerPart = {
    path: 'word/header1.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve">CONFIDENTIAL CV — ${zoe.name}</w:t></w:r></w:p></w:hdr>`,
    contentTypeOverride:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    relationship:
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
  }
  const textboxXml = `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t xml:space="preserve">Referee: ${jan.name}, ${employerB}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`
  const complexDocx = await buildDocx({
    bodyXml: [
      heading(`${zoe.name} — CV`),
      paragraph(`${zoe.email} | ${zoe.phone}`),
      heading('Employment History'),
      table([
        ['Employer', 'Role', 'Dates'],
        [employerA, 'Senior Project Engineer', 'Mar 2019 – Present'],
        [employerB, 'Project Engineer', 'Aug 2014 – Feb 2019'],
      ]),
      textboxXml,
      '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>',
    ].join(''),
    extraParts: [headerPart],
  })
  assertUnderCap(complexDocx, 't1-docx-tables-headers-textbox.docx')
  writeFileSync(join(TIER1_DIR, 't1-docx-tables-headers-textbox.docx'), complexDocx)
  record(1, 'tier1/t1-docx-tables-headers-textbox.docx', { bytes: complexDocx.length })

  // --- t1-docx-unicode.docx (same battery as the PDF twin) -----------------
  const unicodeDocx = await buildDocx({ bodyXml: unicodeBatteryDocxBody() })
  assertUnderCap(unicodeDocx, 't1-docx-unicode.docx')
  writeFileSync(join(TIER1_DIR, 't1-docx-unicode.docx'), unicodeDocx)
  record(1, 'tier1/t1-docx-unicode.docx', { bytes: unicodeDocx.length })
}

// The unicode battery: diacritics, CJK, an emoji with a ZWJ sequence, smart
// quotes, a soft hyphen, an RTL fragment, and an en-dash-heavy date range.
// Shared verbatim between the PDF and DOCX twins per the plan.
const ZWJ = String.fromCharCode(0x200d) // zero-width joiner
const SOFT_HYPHEN = String.fromCharCode(0x00ad)
const WOMAN_TECHNOLOGIST_EMOJI = String.fromCodePoint(0x1f469) + ZWJ + String.fromCodePoint(0x1f4bb) // 👩‍💻

function unicodeBatteryLines() {
  return [
    `${zoe.name} — International Projects Addendum`,
    `${zoe.email} | ${zoe.phone}`,
    '',
    `Colleague reference (CJK): worked alongside ${wei.name} on the Solstice Grid ` +
      'Systems interconnector programme.',
    `Smart quotes: the client described the handover as “seamless” and the ` +
      `programme as ‘genuinely collaborative’.`,
    `Soft${SOFT_HYPHEN}hyphenated compound: micro${SOFT_HYPHEN}grid commissioning schedule.`,
    `Date range with en-dash: 2020–2024, Meridian Subsea Ltd.`,
    `RTL fragment (Arabic, "hello"): مرحبا — included to exercise bidi text.`,
    `Emoji with ZWJ sequence: ${WOMAN_TECHNOLOGIST_EMOJI} (site engineer icon used on internal reports).`,
  ]
}

function buildUnicodeBatteryHtml() {
  const lines = unicodeBatteryLines()
  const body = lines.map((l) => `<p>${l === '' ? '&nbsp;' : l}</p>`).join('\n  ')
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: "Noto Sans", Arial, sans-serif; font-size: 12px; color: #111; line-height: 1.6; }
</style></head>
<body>
  ${body}
</body></html>`
}

function unicodeBatteryDocxBody() {
  return unicodeBatteryLines()
    .map((l) => paragraph(l === '' ? ' ' : l))
    .join('')
}

// Long, 40-page-scale career history — deliberately exceeds the 60,000-char
// slice (MAX_CV_TEXT_CHARS in src/lib/inngest/functions/parse-cv.ts) while
// staying well under the 1 MiB fixture cap. Content repeats by design; a
// forced page-break after every section keeps physical page count roughly
// stable across Chromium versions even though it is not itself asserted.
const CAREER_PARAGRAPH =
  'Delivered offshore wind cable-route surveys and stakeholder liaison across a portfolio ' +
  'of consented sites, coordinating with regulatory bodies and subcontractor dive teams to ' +
  'keep programme milestones on schedule. Led a cross-functional team through detailed ' +
  `design review, cost estimation and risk registers, presenting findings to senior ` +
  `stakeholders at ${employerA} and ${employerB} on a recurring basis. `

function buildLongCareerHistoryHtml(sections = 45, repeatsPerSection = 4) {
  let body = `<h1>${zoe.name} — Extended Career History</h1>`
  for (let i = 0; i < sections; i++) {
    const isLast = i === sections - 1
    const pageBreak = isLast ? '' : 'page-break-after: always;'
    body += `<div style="${pageBreak}"><h2>Role ${i + 1} of ${sections}</h2><p>${CAREER_PARAGRAPH.repeat(repeatsPerSection)}</p></div>`
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; line-height: 1.5; }
  h1 { font-size: 18px; }
  h2 { font-size: 13px; }
</style></head>
<body>${body}</body></html>`
}

// ---------------------------------------------------------------------------
// PRODUCTION-MIRROR — mirrors src/lib/ai/cv-extract.ts's
// extractTextFromBuffer() + normaliseWhitespace() EXACTLY, for generator
// self-checks only. This is NOT the production code; it exists so this
// plain-Node-ESM generator (no TS runner, cannot `import` the real .ts
// module) can PROVE what the current extractor actually does to each
// fixture, rather than assume it. If cv-extract.ts's normalisation logic
// changes, update this mirror to match, or these self-checks will silently
// diverge from reality.
// ---------------------------------------------------------------------------
const MIRROR_PDF_MIME = 'application/pdf'
const MIRROR_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Mirrors parse-cv.ts's MIN_EXTRACTED_CHARS / MAX_CV_TEXT_CHARS thresholds
// so the scanned-PDF and long-document fixtures can be asserted against the
// real production cutoffs, not invented ones.
const MIRROR_MIN_EXTRACTED_CHARS = 50
const MIRROR_MAX_CV_TEXT_CHARS = 60_000

const NUL_CHAR = String.fromCharCode(0)

function mirrorNormaliseWhitespace(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

class MirrorUnsupportedCVMimeTypeError extends Error {
  constructor(mimeType) {
    super(`Unsupported CV mime type: ${mimeType}`)
    this.name = 'UnsupportedCVMimeTypeError'
  }
}

async function mirrorExtractTextFromBuffer(buffer, mimeType) {
  if (mimeType === MIRROR_PDF_MIME) {
    // Defensive COPY: unpdf/pdf.js can neuter/detach the underlying
    // ArrayBuffer it is given. We frequently still need the original
    // buffer afterwards (to write it to disk, or run a second check), so
    // never hand pdf.js a view over memory we still own.
    const bytes = new Uint8Array(buffer.length)
    bytes.set(buffer)
    const pdf = await getDocumentProxy(bytes)
    const { text } = await extractText(pdf, { mergePages: true })
    const merged = Array.isArray(text) ? text.join('\n\n') : text
    return mirrorNormaliseWhitespace(merged)
  }
  if (mimeType === MIRROR_DOCX_MIME) {
    const nodeBuffer = Buffer.isBuffer(buffer) ? Buffer.from(buffer) : Buffer.from(buffer)
    const result = await mammoth.extractRawText({ buffer: nodeBuffer })
    return mirrorNormaliseWhitespace(result.value)
  }
  throw new MirrorUnsupportedCVMimeTypeError(mimeType)
}

function countChar(text, ch) {
  return text.split(ch).length - 1
}

/**
 * Runs the mirror extractor and returns a structured observation — never
 * throws. `ok:false` entries carry the REAL error.name/message so the
 * manifest can record what actually happened instead of a prediction.
 */
async function observeExtraction(buffer, mimeType) {
  try {
    const text = await mirrorExtractTextFromBuffer(buffer, mimeType)
    return { ok: true, text, chars: text.length, nulCount: countChar(text, NUL_CHAR) }
  } catch (err) {
    return {
      ok: false,
      errorName: err instanceof Error ? err.name : 'UnknownError',
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — every "random" byte in this corpus
// (corrupt-PDF filler, OLE2 filler, encrypted-PDF O/U/ID values) comes from
// this, seeded with a fixed integer, never Math.random()/crypto.randomBytes.
// Same seed in -> same bytes out, forever.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed
  return function random() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function seededBytes(seed, length) {
  const rand = mulberry32(seed)
  const buf = Buffer.alloc(length)
  for (let i = 0; i < length; i++) buf[i] = Math.floor(rand() * 256)
  return buf
}

// ---------------------------------------------------------------------------
// Manifest — one entry per fixture. Written from this single in-file table
// (built up as fixtures are generated) so the manifest and the fixtures on
// disk can never drift.
// ---------------------------------------------------------------------------
const manifestEntries = []
function pushManifest(entry) {
  if (!entry.why) throw new Error(`manifest entry for ${entry.file} is missing a "why"`)
  manifestEntries.push(entry)
}

// ---------------------------------------------------------------------------
// TIER 1 MANIFEST — buildTier1() already wrote every Tier-1 fixture to disk
// (plan 06-03 task 1). This reads each one back and runs the SAME mirror
// extraction every later Layer-1 test will run, asserting the mustContain/
// minChars/expectNulCount claims below are true NOW rather than assuming
// they will still be true after an HTML tweak — fail loudly if not.
// ---------------------------------------------------------------------------
const TIER1_MANIFEST_DEFS = [
  {
    file: 't1-pdf-single-column.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 1200,
    mustContain: [zoe.name, employerA],
    why: 'Baseline single-column text PDF, ~2 pages — the simplest Tier-1 shape; must always parse cleanly.',
  },
  {
    file: 't1-pdf-filename with spaces & ünicode.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 1200,
    mustContain: [zoe.name, employerA],
    why: 'Identical bytes to t1-pdf-single-column.pdf under an awkward filename — exercises slugifyFilename() in the recruiter upload action (src/app/(app)/candidates/[id]/actions.ts), not extraction itself.',
  },
  {
    file: 't1-pdf-bom-prefixed.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 1200,
    mustContain: [zoe.name, employerA],
    why: "t1-pdf-single-column.pdf behind a 3-byte UTF-8 BOM — the shape a naive re-save produces. pdf.js's checkHeader() searches the first 1024 bytes for %PDF- and moveStart()s to it, so this extracts identically to the unprefixed original; it is here so sniffFileType() can never again be stricter than the parser it gates (review 2026-08-09 CR-02).",
  },
  {
    file: 't1-pdf-junk-prefixed.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 1200,
    mustContain: [zoe.name, employerA],
    why: 't1-pdf-single-column.pdf behind a 45-byte mail-gateway preamble (CRLF + a MIME-Version line) — the other common real-world source of bytes before the PDF header. Extracts identically to the unprefixed original (review 2026-08-09 CR-02).',
  },
  {
    file: 't1-pdf-two-column.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 800,
    mustContain: [wei.name, employerD],
    why: 'CSS column-count:2 is the classic PDF extraction-order trap — text must still extract in reading order, column by column.',
  },
  {
    file: 't1-pdf-tables-headers-footers.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 400,
    mustContain: [aoife.name, employerB],
    why: 'Employment-history <table>, a real <a href> hyperlink, an embedded raster image, and a running Playwright header+footer — none of that structure should confuse the extractor or leak into the body text.',
  },
  {
    file: 't1-pdf-unicode.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 400,
    mustContain: [zoe.name, wei.name, employerC],
    why: 'The full unicode battery a real UK/EU CV can contain: diacritics, CJK, emoji+ZWJ, smart quotes, soft hyphen, an RTL fragment, an en-dash date range.',
  },
  {
    file: 't1-pdf-linkedin-export.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: 350,
    mustContain: [jan.name, employerC],
    why: 'Approximates the LinkedIn "Save to PDF" export shape (bold name block, ALL-CAPS section headings, dense line breaks) that recruiters routinely upload.',
  },
  {
    file: 't1-pdf-long-40-pages.pdf',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    minChars: MIRROR_MAX_CV_TEXT_CHARS,
    mustContain: [zoe.name, 'Role 45 of 45', employerA],
    why: `Deliberately exceeds MAX_CV_TEXT_CHARS (${MIRROR_MAX_CV_TEXT_CHARS}, the 60k-char slice parse-cv.ts takes before calling Claude) while staying well under the 1 MiB fixture cap, proving the slice boundary itself does not corrupt or truncate mid-character.`,
  },
  {
    file: 't1-docx-simple.docx',
    mime: MIRROR_DOCX_MIME,
    declaredExtension: 'docx',
    minChars: 300,
    mustContain: [aoife.name, employerB, employerD],
    why: 'Baseline simple DOCX with no tables/headers — must always parse cleanly, the DOCX twin of the single-column PDF.',
  },
  {
    file: 't1-docx-tables-headers-textbox.docx',
    mime: MIRROR_DOCX_MIME,
    declaredExtension: 'docx',
    minChars: 200,
    mustContain: [zoe.name, employerA, jan.name],
    why: 'A <w:tbl>, a real header part (word/header1.xml + its content-type + relationship), and a text box (w:txbxContent) — the DOCX structural features real CV templates use that a naive body-only reader can choke on.',
  },
  {
    file: 't1-docx-unicode.docx',
    mime: MIRROR_DOCX_MIME,
    declaredExtension: 'docx',
    minChars: 400,
    mustContain: [wei.name, employerC, 'مرحبا'],
    why: "Same unicode battery as t1-pdf-unicode.pdf's twin, confirming DOCX preserves RTL text in logical order (unlike the PDF, whose visual-order extraction reverses RTL presentation forms — expected PDF.js behaviour, not a bug).",
  },
]

async function verifyTier1Manifest() {
  for (const def of TIER1_MANIFEST_DEFS) {
    const buffer = readFileSync(join(TIER1_DIR, def.file))
    const observed = await observeExtraction(buffer, def.mime)
    if (!observed.ok) {
      throw new Error(
        `Tier-1 fixture ${def.file} unexpectedly failed to parse: ${observed.errorName}`,
      )
    }
    if (observed.chars < def.minChars) {
      throw new Error(
        `Tier-1 fixture ${def.file} extracted only ${observed.chars} chars, expected >= ${def.minChars}`,
      )
    }
    for (const needle of def.mustContain) {
      if (!observed.text.includes(needle)) {
        throw new Error(
          `Tier-1 fixture ${def.file} is missing expected content: ${JSON.stringify(needle)}`,
        )
      }
    }
    if (observed.nulCount !== 0) {
      throw new Error(
        `Tier-1 fixture ${def.file} unexpectedly contains ${observed.nulCount} NUL byte(s)`,
      )
    }
    pushManifest({
      file: `tier1/${def.file}`,
      tier: 1,
      mime: def.mime,
      declaredExtension: def.declaredExtension,
      expect: 'parse',
      minChars: def.minChars,
      mustContain: def.mustContain,
      expectNulCount: 0,
      why: def.why,
    })
  }
}

// ---------------------------------------------------------------------------
// TIER 2 — "MUST FAIL FAST + HONEST"
// ---------------------------------------------------------------------------

/** Hand-rolled minimal single/multi-object PDF, no Playwright involved. */
function buildRawPdf(objectEntries, trailerFields) {
  const maxNum = Math.max(...objectEntries.map((o) => o.num))
  let out = '%PDF-1.4\n'
  const offsetByNum = new Map()
  for (const { num, body } of objectEntries) {
    offsetByNum.set(num, Buffer.byteLength(out, 'latin1'))
    out += body
  }
  const xrefStart = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= maxNum; i++) {
    out += offsetByNum.has(i)
      ? `${String(offsetByNum.get(i)).padStart(10, '0')} 00000 n \n`
      : `0000000000 00000 f \n`
  }
  const trailerParts = Object.entries(trailerFields)
    .map(([k, v]) => `/${k} ${v}`)
    .join(' ')
  out += `trailer\n<< ${trailerParts} >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

function buildCorruptPdfBytes() {
  return Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), seededBytes(42, 4096)])
}

/**
 * A PDF with an /Encrypt dictionary. O/U are deterministic PSEUDO-RANDOM
 * bytes (never derived from a real password) — pdf.js's empty-password
 * check fails against them exactly as it would against a real non-empty
 * user password, so this does not need a real MD5/RC4 implementation to
 * reproduce "this PDF needs a password I don't have" honestly.
 */
function buildEncryptedPdfBytes() {
  const content = `BT /F1 24 Tf 72 720 Td (${jan.name} - Confidential) Tj ET`
  const objects = [
    { num: 1, body: '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' },
    { num: 2, body: '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' },
    {
      num: 3,
      body: '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    },
    {
      num: 4,
      body: `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    },
    { num: 5, body: '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' },
    {
      num: 6,
      body: `6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${seededBytes(101, 32).toString('hex')}> /U <${seededBytes(202, 32).toString('hex')}> /P -3904 >>\nendobj\n`,
    },
  ]
  const idHex = seededBytes(303, 16).toString('hex')
  return buildRawPdf(objects, {
    Size: 7,
    Root: '1 0 R',
    Encrypt: '6 0 R',
    ID: `[<${idHex}> <${idHex}>]`,
  })
}

function buildLegacyDocBytes() {
  const ole2Header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  return Buffer.concat([ole2Header, seededBytes(7, 1024)])
}

function buildRtfBytes() {
  const text =
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs22 ' +
    jan.name +
    ' -- minimal RTF fixture, not supported by the current extractor.}'
  return Buffer.from(text, 'utf8')
}

function buildTxtBytes() {
  return Buffer.from(
    `${jan.name}\nPlain-text CV fixture — an unsupported format that must fail fast at upload, not three minutes later.\n`,
    'utf8',
  )
}

async function buildOdtBytes() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', zipOpts())
  zip.file(
    'content.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>' +
      jan.name +
      ' — plain ODT fixture. Valid ZIP, deliberately NOT a valid DOCX (no word/document.xml).</text:p></office:text></office:body></office:document-content>',
    zipOpts(),
  )
  stabiliseZipFolderDates(zip)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function buildTier2(browser) {
  // --- t2-pdf-scanned-no-text.pdf ---------------------------------------
  const scannedHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 0; }
  img { width: 100%; height: 100vh; object-fit: cover; }
</style></head>
<body><img src="data:image/png;base64,${TINY_PNG_BASE64}"></body></html>`
  const scannedPdf = await renderPdfFromHtml(browser, scannedHtml)
  assertUnderCap(scannedPdf, 't2-pdf-scanned-no-text.pdf')
  const scannedObserved = await observeExtraction(scannedPdf, MIRROR_PDF_MIME)
  if (!scannedObserved.ok || scannedObserved.chars >= MIRROR_MIN_EXTRACTED_CHARS) {
    throw new Error(
      `t2-pdf-scanned-no-text.pdf must extract under ${MIRROR_MIN_EXTRACTED_CHARS} chars — got ${JSON.stringify(scannedObserved)}`,
    )
  }
  writeFileSync(join(TIER2_DIR, 't2-pdf-scanned-no-text.pdf'), scannedPdf)
  record(2, 'tier2/t2-pdf-scanned-no-text.pdf', { bytes: scannedPdf.length })
  pushManifest({
    file: 'tier2/t2-pdf-scanned-no-text.pdf',
    tier: 2,
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    expect: 'reject',
    expectMinCharsBelow: MIRROR_MIN_EXTRACTED_CHARS,
    why: `Image-only PDF, no text layer — unpdf does not throw, it extracts ${scannedObserved.chars} char(s); parse-cv.ts's MIN_EXTRACTED_CHARS branch (not a caught exception) is what must catch this.`,
  })

  // --- t2-pdf-encrypted.pdf -----------------------------------------------
  const encryptedPdf = buildEncryptedPdfBytes()
  assertUnderCap(encryptedPdf, 't2-pdf-encrypted.pdf')
  const encryptedObserved = await observeExtraction(encryptedPdf, MIRROR_PDF_MIME)
  if (encryptedObserved.ok) {
    throw new Error('t2-pdf-encrypted.pdf unexpectedly parsed without a password')
  }
  writeFileSync(join(TIER2_DIR, 't2-pdf-encrypted.pdf'), encryptedPdf)
  record(2, 'tier2/t2-pdf-encrypted.pdf', { bytes: encryptedPdf.length })
  pushManifest({
    file: 'tier2/t2-pdf-encrypted.pdf',
    tier: 2,
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    expect: 'reject',
    expectErrorName: encryptedObserved.errorName,
    why: `Carries a syntactically valid /Encrypt dictionary with deterministic-but-not-empty-password O/U values; pdf.js's implicit empty-password check fails and throws ${encryptedObserved.errorName} (observed live during generation, not predicted — research open question 4).`,
  })

  // --- t2-pdf-truncated.pdf ------------------------------------------------
  const singleColumnBytes = readFileSync(join(TIER1_DIR, 't1-pdf-single-column.pdf'))
  const truncatedPdf = singleColumnBytes.subarray(0, Math.floor(singleColumnBytes.length * 0.4))
  const truncatedObserved = await observeExtraction(truncatedPdf, MIRROR_PDF_MIME)
  if (truncatedObserved.ok) {
    throw new Error('t2-pdf-truncated.pdf unexpectedly parsed despite being 40% of a valid PDF')
  }
  writeFileSync(join(TIER2_DIR, 't2-pdf-truncated.pdf'), truncatedPdf)
  record(2, 'tier2/t2-pdf-truncated.pdf', { bytes: truncatedPdf.length })
  pushManifest({
    file: 'tier2/t2-pdf-truncated.pdf',
    tier: 2,
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    expect: 'reject',
    expectErrorName: truncatedObserved.errorName,
    why: `The first 40% of t1-pdf-single-column.pdf — no xref/trailer survives the cut, so pdf.js throws ${truncatedObserved.errorName} (a common real-world shape: an interrupted upload or a copy-paste truncation).`,
  })

  // --- t2-pdf-corrupt.pdf ---------------------------------------------------
  const corruptPdf = buildCorruptPdfBytes()
  assertUnderCap(corruptPdf, 't2-pdf-corrupt.pdf')
  const corruptObserved = await observeExtraction(corruptPdf, MIRROR_PDF_MIME)
  if (corruptObserved.ok) {
    throw new Error(
      't2-pdf-corrupt.pdf unexpectedly parsed despite being random bytes after the header',
    )
  }
  writeFileSync(join(TIER2_DIR, 't2-pdf-corrupt.pdf'), corruptPdf)
  record(2, 'tier2/t2-pdf-corrupt.pdf', { bytes: corruptPdf.length })
  pushManifest({
    file: 'tier2/t2-pdf-corrupt.pdf',
    tier: 2,
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    expect: 'reject',
    expectErrorName: corruptObserved.errorName,
    why: `A real "%PDF-1.7" header followed by 4 KiB of deterministic (seeded) pseudo-random bytes — no valid object structure at all; pdf.js throws ${corruptObserved.errorName}.`,
  })

  // --- t2-zero-byte.pdf ------------------------------------------------------
  const zeroByte = Buffer.alloc(0)
  const zeroByteObserved = await observeExtraction(zeroByte, MIRROR_PDF_MIME)
  if (zeroByteObserved.ok) {
    throw new Error('t2-zero-byte.pdf unexpectedly parsed despite being empty')
  }
  writeFileSync(join(TIER2_DIR, 't2-zero-byte.pdf'), zeroByte)
  record(2, 'tier2/t2-zero-byte.pdf', { bytes: 0 })
  pushManifest({
    file: 'tier2/t2-zero-byte.pdf',
    tier: 2,
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    expect: 'reject',
    expectErrorName: zeroByteObserved.errorName,
    why: `A genuinely empty (0-byte) file — the "upload never actually wrote any bytes" case; pdf.js throws ${zeroByteObserved.errorName}.`,
  })

  // --- t2-docx-renamed.pdf (DOCX bytes labelled .pdf) ------------------------
  const docxBytesForRename = readFileSync(join(TIER1_DIR, 't1-docx-simple.docx'))
  const docxRenamedObserved = await observeExtraction(docxBytesForRename, MIRROR_PDF_MIME)
  if (docxRenamedObserved.ok) {
    throw new Error('t2-docx-renamed.pdf unexpectedly parsed as a PDF')
  }
  writeFileSync(join(TIER2_DIR, 't2-docx-renamed.pdf'), docxBytesForRename)
  record(2, 'tier2/t2-docx-renamed.pdf', { bytes: docxBytesForRename.length })
  pushManifest({
    file: 'tier2/t2-docx-renamed.pdf',
    tier: 2,
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    expect: 'reject',
    expectErrorName: docxRenamedObserved.errorName,
    why: `A real, valid t1-docx-simple.docx byte-copied under a .pdf name/label — the wrong-extension case. Fed to unpdf as PDF_MIME, pdf.js throws ${docxRenamedObserved.errorName} (its magic bytes are "PK", not "%PDF").`,
  })

  // --- t2-pdf-renamed.docx (PDF bytes labelled .docx) -------------------------
  const pdfBytesForRename = readFileSync(join(TIER1_DIR, 't1-pdf-single-column.pdf'))
  const pdfRenamedObserved = await observeExtraction(pdfBytesForRename, MIRROR_DOCX_MIME)
  if (pdfRenamedObserved.ok) {
    throw new Error('t2-pdf-renamed.docx unexpectedly parsed as a DOCX')
  }
  writeFileSync(join(TIER2_DIR, 't2-pdf-renamed.docx'), pdfBytesForRename)
  record(2, 'tier2/t2-pdf-renamed.docx', { bytes: pdfBytesForRename.length })
  pushManifest({
    file: 'tier2/t2-pdf-renamed.docx',
    tier: 2,
    mime: MIRROR_DOCX_MIME,
    declaredExtension: 'docx',
    expect: 'reject',
    expectErrorName: pdfRenamedObserved.errorName,
    why: `The mirror case: a real t1-pdf-single-column.pdf byte-copied under a .docx name/label. Fed to mammoth as DOCX_MIME, jszip cannot find a central directory and throws ${pdfRenamedObserved.errorName}.`,
  })

  // --- t2-legacy.doc ------------------------------------------------------------
  const legacyDoc = buildLegacyDocBytes()
  const legacyMime = 'application/msword'
  const legacyObserved = await observeExtraction(legacyDoc, legacyMime)
  if (legacyObserved.ok) {
    throw new Error('t2-legacy.doc unexpectedly "parsed" under application/msword')
  }
  writeFileSync(join(TIER2_DIR, 't2-legacy.doc'), legacyDoc)
  record(2, 'tier2/t2-legacy.doc', { bytes: legacyDoc.length })
  pushManifest({
    file: 'tier2/t2-legacy.doc',
    tier: 2,
    mime: legacyMime,
    declaredExtension: 'doc',
    expect: 'reject',
    expectErrorName: legacyObserved.errorName,
    why: `Legacy binary .doc (OLE2 compound-file magic bytes D0 CF 11 E0 A1 B1 1A E1, not OOXML) — extractTextFromBuffer only recognises PDF_MIME/DOCX_MIME, so any real .doc mime throws ${legacyObserved.errorName} immediately, before any byte is even read.`,
  })

  // --- t2-plain.rtf --------------------------------------------------------------
  const rtf = buildRtfBytes()
  const rtfMime = 'application/rtf'
  const rtfObserved = await observeExtraction(rtf, rtfMime)
  if (rtfObserved.ok) {
    throw new Error('t2-plain.rtf unexpectedly "parsed" under application/rtf')
  }
  writeFileSync(join(TIER2_DIR, 't2-plain.rtf'), rtf)
  record(2, 'tier2/t2-plain.rtf', { bytes: rtf.length })
  pushManifest({
    file: 'tier2/t2-plain.rtf',
    tier: 2,
    mime: rtfMime,
    declaredExtension: 'rtf',
    expect: 'reject',
    expectErrorName: rtfObserved.errorName,
    why: `Minimal {\\rtf1\\ansi ...} document — same mime-routing rejection (${rtfObserved.errorName}) as any non-PDF/DOCX mime today; the locked "works" definition wants this said at upload time, not 3 minutes later (plan 06-08).`,
  })

  // --- t2-opendocument.odt --------------------------------------------------------
  const odt = await buildOdtBytes()
  assertUnderCap(odt, 't2-opendocument.odt')
  const odtMime = 'application/vnd.oasis.opendocument.text'
  const odtObserved = await observeExtraction(odt, odtMime)
  if (odtObserved.ok) {
    throw new Error('t2-opendocument.odt unexpectedly "parsed" under its own ODT mime')
  }
  // Bonus observation (not the primary manifest expectation): if this file
  // were EVER mistakenly routed as DOCX_MIME, mammoth still rejects it, but
  // with a DIFFERENT error, because it IS a structurally valid zip — this is
  // exactly the "header-only magic-byte check is insufficient" property
  // plan 06-08's sniffer test depends on.
  const odtAsDocxObserved = await observeExtraction(odt, MIRROR_DOCX_MIME)
  writeFileSync(join(TIER2_DIR, 't2-opendocument.odt'), odt)
  record(2, 'tier2/t2-opendocument.odt', { bytes: odt.length })
  pushManifest({
    file: 'tier2/t2-opendocument.odt',
    tier: 2,
    mime: odtMime,
    declaredExtension: 'odt',
    expect: 'reject',
    expectErrorName: odtObserved.errorName,
    why:
      `Mime-routing rejects this today (${odtObserved.errorName}, same as any non-PDF/DOCX mime). But its magic bytes ARE a valid ZIP — same signature as DOCX — and it is deliberately missing word/document.xml, so if it were ever mistakenly routed as DOCX_MIME, mammoth would instead throw ` +
      `${odtAsDocxObserved.ok ? 'nothing (unexpected!)' : odtAsDocxObserved.errorName} (${odtAsDocxObserved.ok ? '' : JSON.stringify(odtAsDocxObserved.errorMessage)}). ` +
      'This is the fixture that proves a header-only magic-byte check is insufficient, which plan 06-08 depends on.',
  })

  // --- t2-plain.txt ----------------------------------------------------------------
  const txt = buildTxtBytes()
  const txtMime = 'text/plain'
  const txtObserved = await observeExtraction(txt, txtMime)
  if (txtObserved.ok) {
    throw new Error('t2-plain.txt unexpectedly "parsed" under text/plain')
  }
  writeFileSync(join(TIER2_DIR, 't2-plain.txt'), txt)
  record(2, 'tier2/t2-plain.txt', { bytes: txt.length })
  pushManifest({
    file: 'tier2/t2-plain.txt',
    tier: 2,
    mime: txtMime,
    declaredExtension: 'txt',
    expect: 'reject',
    expectErrorName: txtObserved.errorName,
    why: `Plain text CV — same mime-routing rejection (${txtObserved.errorName}); a surprisingly common real-world upload from candidates pasting a CV into a .txt file.`,
  })
}

// ---------------------------------------------------------------------------
// HOSTILE — parses successfully, but carries a Postgres-illegal U+0000.
// ---------------------------------------------------------------------------

/**
 * A ToUnicode CMap mapping the glyph for 'A' (0x41) to <0000>. This is the
 * ONLY verified recipe that survives PDF.js's text-extraction normalisation
 * (see 06-RESEARCH.md's counter-example: a \000 octal escape inside a Tj
 * literal with a standard font gets silently normalised to a space instead).
 */
function buildToUnicodeNulPdfBytes() {
  const cmapLines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin begincmap',
    '/CMapName /Custom def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '6 beginbfchar',
    '<41> <0000>',
    '<42> <0042>',
    '<43> <0043>',
    '<44> <0044>',
    '<45> <0045>',
    '<46> <0046>',
    'endbfchar',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ]
  const cmap = cmapLines.join('\n')
  const content = 'BT /F1 24 Tf 72 720 Td (ABCDEF ABCDEF) Tj ET'

  const objects = [
    { num: 1, body: '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' },
    { num: 2, body: '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' },
    {
      num: 3,
      body: '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    },
    {
      num: 4,
      body: `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    },
    {
      num: 5,
      body: '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 7 0 R >>\nendobj\n',
    },
    { num: 7, body: `7 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n` },
  ]
  return buildRawPdf(objects, { Size: 8, Root: '1 0 R' })
}

// No browser needed — every hostile fixture is hand-rolled bytes (PDF) or
// built via jszip through the shared buildDocx() helper (DOCX), unlike
// buildTier1()/buildTier2() which both need Playwright for realistic PDFs.
async function buildHostile() {
  // --- hostile-pdf-tounicode-nul.pdf ------------------------------------
  const nulPdf = buildToUnicodeNulPdfBytes()
  assertUnderCap(nulPdf, 'hostile-pdf-tounicode-nul.pdf')
  const nulPdfObserved = await observeExtraction(nulPdf, MIRROR_PDF_MIME)
  if (!nulPdfObserved.ok || nulPdfObserved.nulCount === 0) {
    throw new Error(
      `hostile-pdf-tounicode-nul.pdf must parse successfully AND emit at least one NUL — got ${JSON.stringify(nulPdfObserved)}`,
    )
  }
  writeFileSync(join(HOSTILE_DIR, 'hostile-pdf-tounicode-nul.pdf'), nulPdf)
  record('hostile', 'hostile/hostile-pdf-tounicode-nul.pdf', { bytes: nulPdf.length })
  pushManifest({
    file: 'hostile/hostile-pdf-tounicode-nul.pdf',
    tier: 'hostile',
    mime: MIRROR_PDF_MIME,
    declaredExtension: 'pdf',
    expect: 'parse',
    expectNulCount: '>0',
    why: `A ToUnicode CMap maps glyph 0x41 ('A') to U+0000 — a real-world artefact of subset/broken font embedding. unpdf/PDF.js parses this successfully and emits ${nulPdfObserved.nulCount} literal NUL byte(s) in the extracted text (verified live during generation). A green ("0 NUL") result on this fixture before plan 06-06's sanitiser ships means the FIXTURE is wrong, not the bug.`,
  })

  // --- hostile-docx-raw-nul.docx -------------------------------------------
  const rawNulDocx = await buildDocx({ bodyXml: paragraph(`${jan.name}${NUL_CHAR}CV`) })
  assertUnderCap(rawNulDocx, 'hostile-docx-raw-nul.docx')
  const rawNulObserved = await observeExtraction(rawNulDocx, MIRROR_DOCX_MIME)
  if (!rawNulObserved.ok || rawNulObserved.nulCount === 0) {
    throw new Error(
      `hostile-docx-raw-nul.docx must parse successfully AND emit at least one NUL — got ${JSON.stringify(rawNulObserved)}`,
    )
  }
  writeFileSync(join(HOSTILE_DIR, 'hostile-docx-raw-nul.docx'), rawNulDocx)
  record('hostile', 'hostile/hostile-docx-raw-nul.docx', { bytes: rawNulDocx.length })
  pushManifest({
    file: 'hostile/hostile-docx-raw-nul.docx',
    tier: 'hostile',
    mime: MIRROR_DOCX_MIME,
    declaredExtension: 'docx',
    expect: 'parse',
    expectNulCount: '>0',
    why: `A raw 0x00 byte sits inside a <w:t xml:space="preserve"> run. mammoth reads it straight through and emits ${rawNulObserved.nulCount} literal NUL byte(s) (verified live during generation) — the DOCX twin of the ToUnicode-CMap PDF mechanism.`,
  })

  // --- hostile-docx-charref-nul.docx ---------------------------------------
  const charrefNulDocx = await buildDocx({ bodyXml: paragraph(`${jan.name}&#x0;CV`) })
  assertUnderCap(charrefNulDocx, 'hostile-docx-charref-nul.docx')
  const charrefNulObserved = await observeExtraction(charrefNulDocx, MIRROR_DOCX_MIME)
  if (!charrefNulObserved.ok || charrefNulObserved.nulCount === 0) {
    throw new Error(
      `hostile-docx-charref-nul.docx must parse successfully AND emit at least one NUL — got ${JSON.stringify(charrefNulObserved)}`,
    )
  }
  writeFileSync(join(HOSTILE_DIR, 'hostile-docx-charref-nul.docx'), charrefNulDocx)
  record('hostile', 'hostile/hostile-docx-charref-nul.docx', { bytes: charrefNulDocx.length })
  pushManifest({
    file: 'hostile/hostile-docx-charref-nul.docx',
    tier: 'hostile',
    mime: MIRROR_DOCX_MIME,
    declaredExtension: 'docx',
    expect: 'parse',
    expectNulCount: '>0',
    why: `The XML character reference &#x0; (5 plain ASCII bytes on disk — no raw NUL byte in the file itself) resolves to a real U+0000 when mammoth's XML parser decodes it, emitting ${charrefNulObserved.nulCount} literal NUL byte(s) (verified live during generation) — the second independently-verified DOCX NUL-emission mechanism.`,
  })
}

const MANIFEST_PATH = join(__dirname, 'manifest.json')

function writeManifest() {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifestEntries, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const browser = await launchChromiumOrExit()
  try {
    await buildTier1(browser)
    await verifyTier1Manifest()
    await buildTier2(browser)
    await buildHostile()
  } finally {
    await browser.close()
  }
  writeManifest()

  console.log('\nFixture corpus generated:\n')
  const width = Math.max(...results.map((r) => r.file.length)) + 2
  for (const r of results) {
    console.log(`  tier${r.tier}  ${r.file.padEnd(width)} ${r.bytes} bytes`)
  }
  console.log(`\n${results.length} fixture(s) written, ${manifestEntries.length} manifest entries.`)
}

main().catch((err) => {
  console.error('Fixture generation failed:', err)
  process.exitCode = 1
})
