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
import { mkdirSync, writeFileSync } from 'node:fs'
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
// Main
// ---------------------------------------------------------------------------
async function main() {
  const browser = await launchChromiumOrExit()
  try {
    await buildTier1(browser)
  } finally {
    await browser.close()
  }

  console.log('\nFixture corpus generated:\n')
  const width = Math.max(...results.map((r) => r.file.length)) + 2
  for (const r of results) {
    console.log(`  tier${r.tier}  ${r.file.padEnd(width)} ${r.bytes} bytes`)
  }
  console.log(`\n${results.length} fixture(s) written.`)
}

main().catch((err) => {
  console.error('Fixture generation failed:', err)
  process.exitCode = 1
})
