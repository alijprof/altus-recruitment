/**
 * Local-Supabase integration harness for the layer-2 CV write-path RED suite
 * (06-05-PLAN.md). This is the piece of infrastructure that lets
 * tests/integration/cv-write-path.test.ts call the REAL
 * updateCandidateCVParse / markCandidateFieldsFromCV helpers
 * (src/lib/db/candidate-cvs.ts) against a REAL local Postgres 17.6 +
 * PostgREST v14.5, instead of the fully-mocked query builder used by
 * tests/unit/mark-candidate-fields-from-cv.test.ts (06-RESEARCH.md
 * Pitfall 1 — that mock accepts every payload in the verified failure
 * matrix, which is precisely why the 12 production CVs shipped).
 *
 * ============================================================================
 * HARD GUARD — READ BEFORE TOUCHING THIS FILE
 * ============================================================================
 * getHarness() refuses to run against anything whose resolved URL is not
 * "localhost" or "127.0.0.1". This file constructs a service-role client
 * with full RLS bypass and writes deliberately illegal bytes (NUL bytes,
 * lone UTF-16 surrogates, out-of-range numbers) to whatever database it is
 * pointed at. It must NEVER be pointed at a remote/production Supabase
 * project — do not "fix" the guard to make a remote run "just work".
 * ============================================================================
 *
 * Credential resolution order:
 *   1. `node_modules/.bin/supabase status -o env` (the local CLI binary is
 *      invoked directly — NOT via `pnpm exec` — because `pnpm` itself is not
 *      guaranteed to be on a bare $PATH in every environment this suite runs
 *      in; see 06-RESEARCH.md Environment Availability: "pnpm ... not on bare
 *      $PATH — use `corepack pnpm` or `./node_modules/.bin/*`"). Invoking the
 *      installed binary directly sidesteps that entirely.
 *   2. `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_ROLE_KEY` env vars, as a
 *      fallback for environments where the CLI resolution above is
 *      unavailable for some other reason.
 * Any failure in either path — CLI not found, stack not running, malformed
 * output, missing env fallback — is caught and reported as "down". Neither
 * isStackUp() nor getHarness() ever throw from credential resolution itself;
 * getHarness() throws only its own clear, actionable errors (stack down, or
 * the hard guard above).
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { isMissingColumnError } from '@/lib/db/postgrest-errors'
import type { Database, TablesUpdate } from '@/types/database'

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

type ResolvedCreds = { url: string; serviceRoleKey: string }

/**
 * Parses the KEY="value" line format emitted by `supabase status -o env`.
 * Lines that don't match (banner text, CLI-update notices, etc.) are simply
 * skipped rather than treated as an error — `supabase status` prints
 * human-readable noise on some invocations alongside the env output.
 */
function parseEnvOutput(output: string): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {}
  for (const line of output.split('\n')) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) {
      out[match[1]] = match[2]
    }
  }
  return out
}

function resolveViaCli(): ResolvedCreds | null {
  const bin = path.join(process.cwd(), 'node_modules', '.bin', 'supabase')
  try {
    const output = execFileSync(bin, ['status', '-o', 'env'], {
      encoding: 'utf8',
      timeout: 8_000,
    })
    const parsed = parseEnvOutput(output)
    if (parsed.API_URL && parsed.SERVICE_ROLE_KEY) {
      return { url: parsed.API_URL, serviceRoleKey: parsed.SERVICE_ROLE_KEY }
    }
    return null
  } catch {
    // Binary missing, stack not running, non-zero exit — all "down".
    return null
  }
}

function resolveViaEnvFallback(): ResolvedCreds | null {
  const url = process.env.SUPABASE_TEST_URL
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  if (url && key) return { url, serviceRoleKey: key }
  return null
}

function resolveCreds(): ResolvedCreds | null {
  return resolveViaCli() ?? resolveViaEnvFallback()
}

/** The hard guard's predicate — see the file header. */
function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// isStackUp() — cheap, bounded, never throws, never hangs.
// ---------------------------------------------------------------------------

/**
 * Resolves credentials and does a 2-second-timeout fetch of
 * `${url}/rest/v1/` (PostgREST's root, which answers 200 with an OpenAPI
 * document whenever the stack is reachable — no auth required to get a
 * response at all). Any failure — resolution failure, non-local URL,
 * timeout, connection refused — returns false. Never throws.
 */
export async function isStackUp(): Promise<boolean> {
  const creds = resolveCreds()
  if (!creds || !isLocalUrl(creds.url)) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_000)
  try {
    const res = await fetch(`${creds.url}/rest/v1/`, { signal: controller.signal })
    // Any HTTP response at all (200, 401, whatever) means the stack answered.
    return typeof res.status === 'number'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// getHarness() — seed / reset / teardown
// ---------------------------------------------------------------------------

export type Harness = {
  sb: SupabaseClient<Database>
  orgId: string
  candidateId: string
  candidateCvId: string
  /** Nulls scalar candidate columns and empties array/jsonb columns so every
   *  test class starts from the identical "empty candidate" state D-08's
   *  fill-empty rule requires to actually fire. Also resets the seeded
   *  candidate_cvs row's parse fields. */
  resetCandidate: () => Promise<void>
  /** Deletes the seeded organization; FK cascades (candidates.organization_id
   *  ON DELETE CASCADE, candidate_cvs.organization_id / candidate_id ON
   *  DELETE CASCADE — migration 20260513152244) remove every row this
   *  harness created. Asserts the org row is actually gone afterwards. */
  teardown: () => Promise<void>
}

// Every CV-fillable candidates column, reset to empty — see D-08 enforcement
// notes in src/lib/db/candidate-cvs.ts. full_name is NOT NULL at the schema
// level (migration 20260513152244), so '' stands in for "empty" per the
// helper's own isEmpty predicate (candidateValue == null || candidateValue
// === '').
const EMPTY_CANDIDATE_PATCH = {
  full_name: '',
  email: null,
  phone: null,
  location: null,
  current_role_title: null,
  current_company: null,
  seniority_level: null,
  salary_current_estimate: null,
  salary_expectation: null,
  years_experience: null,
  skills: [],
  sector_tags: [],
  work_experience: [],
  education: [],
}

export async function getHarness(): Promise<Harness> {
  const creds = resolveCreds()
  if (!creds) {
    throw new Error(
      'getHarness: could not resolve local Supabase credentials — is the stack running?\n' +
        'Start it with:\n' +
        '  pnpm exec supabase start -x vector,logflare,edge-runtime,studio,imgproxy,realtime\n' +
        'Then re-run: pnpm test:integration',
    )
  }
  if (!isLocalUrl(creds.url)) {
    // HARD GUARD — see the file header. This must never fire in normal
    // operation; it exists so a misconfigured SUPABASE_TEST_URL (or any
    // future change to resolveCreds) cannot silently point this harness,
    // and the deliberately-illegal payloads it writes, at production.
    throw new Error(
      `getHarness: refusing to run — resolved URL "${creds.url}" is not localhost/127.0.0.1. ` +
        'This harness must only ever run against a local Supabase stack.',
    )
  }

  const sb = createClient<Database>(creds.url, creds.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const suffix = randomUUID()
  // organizations.slug has a CHECK constraint: ^[a-z0-9-]{3,40}$ (migration
  // 20260519092943) — a full UUID (36 chars) plus any prefix blows past the
  // 40-char cap, so the slug uses a shortened, hyphen-free slice of the UUID
  // while `name` keeps the full UUID for readability/uniqueness in Studio.
  const slugSuffix = suffix.replace(/-/g, '').slice(0, 16)

  const { data: org, error: orgError } = await sb
    .from('organizations')
    .insert({ name: `gsd-phase06-integration-${suffix}`, slug: `gsd06-${slugSuffix}` })
    .select('id')
    .single()
  if (orgError || !org) {
    throw new Error(`getHarness: failed to seed organizations row: ${orgError?.message ?? 'unknown'}`)
  }
  const orgId = org.id

  // No FK-required "profile" row is needed: organization_id is passed
  // explicitly below (service-role has no auth.uid() session to resolve a
  // profile from), and candidates.created_by / candidate_cvs.uploaded_by
  // are both nullable (ON DELETE SET NULL) — see migration 20260513152244.
  const { data: candidate, error: candidateError } = await sb
    .from('candidates')
    .insert({ organization_id: orgId, ...EMPTY_CANDIDATE_PATCH })
    .select('id')
    .single()
  if (candidateError || !candidate) {
    throw new Error(
      `getHarness: failed to seed candidates row: ${candidateError?.message ?? 'unknown'}`,
    )
  }
  const candidateId = candidate.id

  // organization_id passed EXPLICITLY: candidate_cvs_set_org is a BEFORE
  // INSERT trigger that resolves organization_id from
  // current_organization_id(), which returns NULL under a service-role
  // client with no session — the trigger would then raise "organization_id
  // is required and could not be resolved from auth context" (06-05-PLAN.md
  // interfaces; migration 20260517204504).
  const { data: cv, error: cvError } = await sb
    .from('candidate_cvs')
    .insert({
      organization_id: orgId,
      candidate_id: candidateId,
      storage_path: `gsd-phase06-integration/${suffix}.pdf`,
      mime_type: 'application/pdf',
      file_size_bytes: 1024,
      version: 1,
      parsing_status: 'pending',
    })
    .select('id')
    .single()
  if (cvError || !cv) {
    throw new Error(`getHarness: failed to seed candidate_cvs row: ${cvError?.message ?? 'unknown'}`)
  }
  const candidateCvId = cv.id

  async function resetCandidate(): Promise<void> {
    const { error: candidateResetError } = await sb
      .from('candidates')
      .update(EMPTY_CANDIDATE_PATCH)
      .eq('id', candidateId)
    if (candidateResetError) {
      throw new Error(`resetCandidate: failed to reset candidates row: ${candidateResetError.message}`)
    }

    const { error: cvResetError } = await sb
      .from('candidate_cvs')
      .update({ parsing_status: 'pending', extracted_data: null, parse_error: null })
      .eq('id', candidateCvId)
    if (cvResetError) {
      throw new Error(`resetCandidate: failed to reset candidate_cvs row: ${cvResetError.message}`)
    }

    // parse_error_detail (migration 20260804120000) may not exist in every
    // environment's generated Database type yet — same defensive,
    // cast-at-the-boundary idiom updateCandidateCVParse itself uses.
    const detailPatch: Record<string, unknown> = { parse_error_detail: null }
    const { error: detailResetError } = await sb
      .from('candidate_cvs')
      .update(detailPatch as unknown as TablesUpdate<'candidate_cvs'>)
      .eq('id', candidateCvId)
    if (detailResetError && !isMissingColumnError(detailResetError, 'parse_error_detail')) {
      throw new Error(
        `resetCandidate: failed to reset candidate_cvs.parse_error_detail: ${detailResetError.message}`,
      )
    }
  }

  async function teardown(): Promise<void> {
    const { error } = await sb.from('organizations').delete().eq('id', orgId)
    if (error) {
      throw new Error(`teardown: failed to delete organizations row ${orgId}: ${error.message}`)
    }
    const { data: stillThere } = await sb
      .from('organizations')
      .select('id')
      .eq('id', orgId)
      .maybeSingle()
    if (stillThere) {
      throw new Error(`teardown: organizations row ${orgId} is still present after delete`)
    }
  }

  return { sb, orgId, candidateId, candidateCvId, resetCandidate, teardown }
}
