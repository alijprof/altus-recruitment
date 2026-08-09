/**
 * Read-only forensic replay of the 12 failed production CV rows
 * (06-CONTEXT.md production evidence; 06-RESEARCH.md §Decisive Experiment).
 *
 * Settles which of the six verified Postgres/PostgREST write-failure classes
 * (06-RESEARCH.md §"Verified failure matrix") produced each real production
 * failure — WITHOUT writing a single byte to the customer's rows.
 *
 * Two-step run (see tests/forensics/README.md for the full runbook):
 *   FORENSIC_SKIP_AI=1 pnpm forensics   # zero-cost: download + re-extract only
 *   pnpm forensics                       # + one Haiku call per clean-extraction row
 *
 * DATA-SAFETY CONTRACT: the ONLY Supabase verbs this file may ever use are
 * `.select()` and `storage.from('cvs').download()`. Any mutating verb —
 * insert, update, upsert, delete, or rpc — called as a method in this file
 * is a bug — mechanically enforced by a `grep -c` gate in this plan's
 * Task 2 verify step (see PLAN.md), which fails the task if any such call
 * appears.
 *
 * PII CONTRACT: the printed table and the on-disk JSON report may contain
 * counts, lengths, typeof strings, JSON paths, SQLSTATE-equivalent codes,
 * `stop_reason`, and the raw NUMERIC values of `years_experience_total` /
 * `salary_current_estimate` / `salary_expectation` (numbers, not PII, and
 * diagnostically decisive per tests/support/pg-legality.ts). They may NEVER
 * contain candidate names, emails, phones, employers, locations, or any
 * extracted CV text — not even truncated. Enforced by construction below:
 * no function in this file ever copies a string VALUE out of the extracted
 * text or the Claude response into a log line or the report.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { isMissingColumnError } from '@/lib/db/postgrest-errors'

import { classifyForPostgres, type PgLegalityFinding } from '../support/pg-legality'

// `cv-extract.ts` and `claude.ts` both start with `import 'server-only'`,
// which is not a real installed package in this repo (it's a Next.js
// bundler-time marker) — vitest cannot resolve it unless mocked. This
// mirrors the convention already used by 20+ files under tests/unit/.
vi.mock('server-only', () => ({}))

// -----------------------------------------------------------------------
// 1. Env bootstrap — before any app import.
//
// `@/lib/env` (`@t3-oss/env-nextjs`) validates its ENTIRE schema at module
// load, and this repo's committed `.env.local` has every secret redacted
// (Vercel-pulled). We never statically import an app module that reaches
// `@/lib/env` — only ever dynamically `import()` it, and only from inside
// the AI-replay branch below — so this file can be collected by vitest even
// when `.env.forensics.local` does not exist; the failure surfaces inside
// `beforeAll` with a clear message instead of at module-collection time.
// -----------------------------------------------------------------------
const ENV_FILE = path.join(process.cwd(), '.env.forensics.local')

function loadForensicsEnv(): void {
  if (!existsSync(ENV_FILE)) return // absence is reported by missingKeys() below
  const raw = readFileSync(ENV_FILE, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (isQuoted) value = value.slice(1, -1)
    // Values already present in process.env win (e.g. CI-injected secrets).
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
loadForensicsEnv()

const SKIP_AI = process.env.FORENSIC_SKIP_AI === '1'

// Needed for the zero-cost half: SELECT + Storage download only.
const ALWAYS_REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FORENSIC_TARGET_ORG_ID',
] as const

// DEVIATION from PLAN.md's literal single required-key list: the plan lists
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / ANTHROPIC_API_KEY / both Inngest
// keys as unconditionally required "because @/lib/env validates them at
// module load". That module load only actually happens once this file
// dynamically imports `@/lib/ai/claude` in the AI-replay branch below — so
// gating these four on `!SKIP_AI` is what makes "FORENSIC_SKIP_AI=1 mode
// works standalone" (06-RESEARCH.md step 5 intent) literally true, including
// in environments where ANTHROPIC_API_KEY is genuinely unavailable.
const AI_REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'ANTHROPIC_API_KEY',
  'INNGEST_EVENT_KEY',
  'INNGEST_SIGNING_KEY',
] as const

const FORENSIC_BILLING_ORG_ID =
  process.env.FORENSIC_BILLING_ORG_ID ?? 'cb70bfc3-d916-4831-a21d-0331b2b9efe3'

function missingKeys(): string[] {
  const required = SKIP_AI ? ALWAYS_REQUIRED_KEYS : [...ALWAYS_REQUIRED_KEYS, ...AI_REQUIRED_KEYS]
  return required.filter((k) => !process.env[k] || process.env[k]?.length === 0)
}

// -----------------------------------------------------------------------
// Extraction-pass constants — mirrored from src/lib/inngest/functions/
// parse-cv.ts (MAX_CV_TEXT_CHARS, MIN_EXTRACTED_CHARS), which does not
// export them. Duplicated intentionally so this replay observes the exact
// same production thresholds without coupling to that file's internals.
// -----------------------------------------------------------------------
const MAX_CV_TEXT_CHARS = 60_000
const MIN_EXTRACTED_CHARS = 50

// Same lone-surrogate rule as tests/support/pg-legality.ts, duplicated as a
// COUNTING (not boolean) scan — this file needs "how many", pg-legality only
// exposes "is any present" via classifyForPostgres findings.
const LONE_SURROGATE_SOURCE =
  '[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]'

function countMatches(s: string, source: string): number {
  const re = new RegExp(source, 'g')
  return s.match(re)?.length ?? 0
}

// PII tripwire for library-internal extraction error messages (never
// candidate text, but be paranoid anyway): no '@' and no digit run longer
// than 6 characters. If either trips, keep the error `name` only.
function safeErrorMessage(name: string, message: string): { name: string; message?: string } {
  const truncated = message.slice(0, 120)
  const hasAt = truncated.includes('@')
  const hasLongDigitRun = /\d{7,}/.test(truncated)
  if (hasAt || hasLongDigitRun) return { name }
  return { name, message: truncated }
}

// This intentionally does NOT use `Tables<'candidate_cvs'>` from
// `@/types/database` — that generated type lacks `parse_error_detail`
// because migration 20260804120000 is (per 06-CONTEXT.md) unapplied on
// prod at the time this replay may run. A local shape lets the SELECT
// degrade gracefully (see selectFailedRows) instead of fighting codegen
// drift against a live, manually-migrated database.
type FailedCvRow = {
  id: string
  storage_path: string
  mime_type: string
  file_size_bytes: number | null
  parsing_status: string
  parse_error: string | null
  parse_error_detail?: string | null
  created_at: string
}

const FULL_COLUMNS =
  'id, storage_path, mime_type, file_size_bytes, parsing_status, parse_error, parse_error_detail, created_at'
const FALLBACK_COLUMNS =
  'id, storage_path, mime_type, file_size_bytes, parsing_status, parse_error, created_at'

/**
 * SELECT ONLY. Falls back to a column set without `parse_error_detail` when
 * that migration is not yet applied (PGRST204/42703 via isMissingColumnError
 * — the same idiom `updateCandidateCVParse` already uses in production).
 */
async function selectFailedRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: this file constructs its own minimal supabase-js client (see buildReadOnlyClient) rather than importing the app's typed Database generic, to avoid pulling in @/lib/env for the zero-cost half. The client is used for exactly two read-only calls, both typed at their call sites below.
  sb: any,
  targetOrgId: string,
): Promise<FailedCvRow[]> {
  const first = await sb
    .from('candidate_cvs')
    .select(FULL_COLUMNS)
    .eq('organization_id', targetOrgId)
    .eq('parsing_status', 'failed')
    .gte('created_at', '2026-08-05')
    .order('created_at')

  if (!first.error) return (first.data ?? []) as FailedCvRow[]

  if (isMissingColumnError(first.error, 'parse_error_detail')) {
    const fallback = await sb
      .from('candidate_cvs')
      .select(FALLBACK_COLUMNS)
      .eq('organization_id', targetOrgId)
      .eq('parsing_status', 'failed')
      .gte('created_at', '2026-08-05')
      .order('created_at')
    if (fallback.error) {
      throw new Error(`FORENSIC select failed (fallback): ${fallback.error.code ?? 'unknown'}`)
    }
    return (fallback.data ?? []) as FailedCvRow[]
  }

  throw new Error(`FORENSIC select failed: ${first.error.code ?? 'unknown'}`)
}

type ExtractionResult =
  | {
      ok: true
      byteLength: number
      charLength: number
      nulCount: number
      loneSurrogateCount: number
      replacementCharCount: number
      slicedTo60k: boolean
      text: string // kept ONLY in-memory for the optional Claude pass; never logged/reported
    }
  | { ok: false; byteLength: number; error: { name: string; message?: string } }

async function extractRow(
  bytes: Uint8Array,
  mimeType: string,
  extractTextFromBuffer: (buf: Uint8Array, mime: string) => Promise<string>,
): Promise<ExtractionResult> {
  try {
    const text = await extractTextFromBuffer(bytes, mimeType)
    return {
      ok: true,
      byteLength: bytes.byteLength,
      charLength: text.length,
      nulCount: countMatches(text, '\\u0000'),
      loneSurrogateCount: countMatches(text, LONE_SURROGATE_SOURCE),
      replacementCharCount: countMatches(text, '\\uFFFD'),
      slicedTo60k: text.length > MAX_CV_TEXT_CHARS,
      text,
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError'
    const message = err instanceof Error ? err.message : ''
    return { ok: false, byteLength: bytes.byteLength, error: safeErrorMessage(name, message) }
  }
}

type ClaudeReplayResult = {
  stopReason: string | null
  inputTokens: number
  outputTokens: number
  findings: PgLegalityFinding[]
}

type ReportRow = {
  index: number
  idTruncated: string
  mimeType: string
  kb: number
  charLength: number | null
  nulCount: number | null
  loneSurrogateCount: number | null
  replacementCharCount: number | null
  slicedTo60k: boolean | null
  extractionError: { name: string; message?: string } | null
  claude: ClaudeReplayResult | 'skipped' | 'not-attempted' | null
}

function mimeShort(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx'
  }
  return mime
}

function classesLabel(row: ReportRow): string {
  if (row.claude === 'skipped') return 'AI-SKIPPED'
  if (row.claude === 'not-attempted') return 'n/a (extraction failed or <50 chars)'
  if (row.claude === null) return 'n/a'
  if (row.claude.findings.length === 0) return 'none'
  return [...new Set(row.claude.findings.map((f) => f.rule))].join(',')
}

function buildMarkdownTable(rows: ReportRow[]): string {
  const header = '| # | mime | KB | chars | NUL | loneSurr | stop_reason | classes |'
  const sep = '|---|------|----|----|-----|----------|-------------|---------|'
  const lines = rows.map((r) => {
    const stopReason =
      r.claude === 'skipped'
        ? 'skipped'
        : r.claude === 'not-attempted' || r.claude === null
          ? 'n/a'
          : (r.claude.stopReason ?? 'null')
    return `| ${r.index} | ${r.mimeType} | ${r.kb} | ${r.charLength ?? 'n/a'} | ${r.nulCount ?? 'n/a'} | ${r.loneSurrogateCount ?? 'n/a'} | ${stopReason} | ${classesLabel(r)} |`
  })
  return [header, sep, ...lines].join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: see selectFailedRows above; this is the same minimal, un-typed-against-Database client used only for .select() and storage.download().
function buildReadOnlyClient(): any {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

type ReplayState = {
  missing: string[]
  targetOrgId: string
  rows: FailedCvRow[]
  reportRows: ReportRow[]
}

let state: ReplayState | undefined

describe('forensic replay: 12 failed production CV rows (read-only)', () => {
  beforeAll(async () => {
    const missing = missingKeys()
    if (missing.length > 0) {
      throw new Error(
        `FORENSIC replay aborted — missing required env keys: ${missing.join(', ')}. ` +
          'See tests/forensics/README.md for the .env.forensics.local runbook.',
      )
    }

    const targetOrgId = process.env.FORENSIC_TARGET_ORG_ID as string

    // Guard rail 1: never bill the customer for our own diagnostics.
    if (FORENSIC_BILLING_ORG_ID === targetOrgId) {
      throw new Error(
        'FORENSIC guard rail violated: FORENSIC_BILLING_ORG_ID must not equal ' +
          'FORENSIC_TARGET_ORG_ID — refusing to bill the customer for diagnostics.',
      )
    }

    // Guard rail 2: this replay is meant for production.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    if (/localhost|127\.0\.0\.1/.test(url)) {
      throw new Error(
        'FORENSIC guard rail violated: NEXT_PUBLIC_SUPABASE_URL looks like a local ' +
          'Supabase stack, but FORENSIC_TARGET_ORG_ID is set — this replay targets production.',
      )
    }

    const sb = buildReadOnlyClient()
    const rows = await selectFailedRows(sb, targetOrgId)

    const { extractTextFromBuffer } = await import('@/lib/ai/cv-extract')

    let parseCVDetailed:
      | ((args: {
          cvText: string
          organizationId: string
          userId?: string | null
          purpose?: string
        }) => Promise<{
          parsed: unknown
          stopReason: string | null
          inputTokens: number
          outputTokens: number
        }>)
      | undefined
    if (!SKIP_AI) {
      // Only reached with all AI_REQUIRED_KEYS present (missingKeys() above
      // already gated on this) — @/lib/env can safely load here.
      ;({ parseCVDetailed } = await import('@/lib/ai/claude'))
    }

    const reportRows: ReportRow[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row) continue
      const index = i + 1
      const download = await sb.storage.from('cvs').download(row.storage_path)
      if (download.error || !download.data) {
        reportRows.push({
          index,
          idTruncated: row.id.slice(0, 8),
          mimeType: mimeShort(row.mime_type),
          kb: Math.round((row.file_size_bytes ?? 0) / 1024),
          charLength: null,
          nulCount: null,
          loneSurrogateCount: null,
          replacementCharCount: null,
          slicedTo60k: null,
          extractionError: { name: 'StorageDownloadError' },
          claude: 'not-attempted',
        })
        continue
      }
      const arrayBuffer = await download.data.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const extraction = await extractRow(bytes, row.mime_type, extractTextFromBuffer)

      if (!extraction.ok) {
        reportRows.push({
          index,
          idTruncated: row.id.slice(0, 8),
          mimeType: mimeShort(row.mime_type),
          kb: Math.round(extraction.byteLength / 1024),
          charLength: null,
          nulCount: null,
          loneSurrogateCount: null,
          replacementCharCount: null,
          slicedTo60k: null,
          extractionError: extraction.error,
          claude: 'not-attempted',
        })
        continue
      }

      const eligibleForClaude = !SKIP_AI && extraction.text.trim().length >= MIN_EXTRACTED_CHARS

      let claude: ReportRow['claude'] = SKIP_AI ? 'skipped' : 'not-attempted'
      if (eligibleForClaude && parseCVDetailed) {
        const result = await parseCVDetailed({
          cvText: extraction.text.slice(0, MAX_CV_TEXT_CHARS),
          organizationId: FORENSIC_BILLING_ORG_ID,
          userId: null,
          purpose: 'cv_parse_forensic',
        })
        claude = {
          stopReason: result.stopReason,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          findings: classifyForPostgres(result.parsed),
        }
      }

      reportRows.push({
        index,
        idTruncated: row.id.slice(0, 8),
        mimeType: mimeShort(row.mime_type),
        kb: Math.round(extraction.byteLength / 1024),
        charLength: extraction.charLength,
        nulCount: extraction.nulCount,
        loneSurrogateCount: extraction.loneSurrogateCount,
        replacementCharCount: extraction.replacementCharCount,
        slicedTo60k: extraction.slicedTo60k,
        extractionError: null,
        claude,
      })
    }

    state = { missing, targetOrgId, rows, reportRows }

    const outDir = path.join(process.cwd(), 'tests', 'forensics', '.out')
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    writeFileSync(
      path.join(outDir, 'replay.json'),
      JSON.stringify(
        { skipAi: SKIP_AI, generatedAt: new Date().toISOString(), rows: reportRows },
        null,
        2,
      ),
      'utf8',
    )

    // console.log is the deliverable here — the printed markdown table is
    // the forensic report's primary consumption surface (Task 3/4 paste it
    // into 06-FORENSICS.md).
    console.log('\nFORENSIC REPLAY REPORT\n' + buildMarkdownTable(reportRows) + '\n')
  }, 300_000)

  it('env: all required keys are present', () => {
    expect(state?.missing ?? []).toEqual([])
  })

  it('guard rail: billing org differs from target org', () => {
    expect(FORENSIC_BILLING_ORG_ID).not.toEqual(state?.targetOrgId)
  })

  it('found the expected 12 failed rows for the target org', () => {
    expect(state?.rows.length).toBe(12)
  })

  it('recorded a report row for every selected row', () => {
    expect(state?.reportRows.length).toBe(state?.rows.length)
  })
})
