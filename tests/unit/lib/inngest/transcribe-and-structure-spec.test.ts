/**
 * @vitest-environment node
 *
 * The full pipeline (download → ffmpeg → whisper → sonnet → persist) is
 * exercised end-to-end manually. This unit test pins the most security-
 * critical invariant: the HARD RULE 4 tenant-boundary check fires BEFORE
 * any service-role action when the event's storage_path doesn't start with
 * the event's organization_id prefix.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/env', () => ({
  env: {
    OPENAI_API_KEY: 'sk-test',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake',
    INNGEST_EVENT_KEY: 'evt-fake',
    INNGEST_SIGNING_KEY: 'sign-fake',
  },
}))

// If the tenant-boundary check fires correctly, the service client is NEVER
// instantiated. Spy on createServiceClient to assert this.
const createServiceClient = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    createServiceClient()
    throw new Error('service client should not be called on tenant violation')
  },
}))

// Mock the rest so the unit test stays isolated.
vi.mock('@/lib/ai/whisper', () => ({ transcribe: vi.fn() }))
vi.mock('@/lib/ai/jd-extract', () => ({ extractJdFromTranscript: vi.fn() }))
vi.mock('@/lib/ai/ffmpeg', () => ({
  recompressToOpus: vi.fn(),
}))

describe('transcribe-and-structure-spec — HARD RULE 4 tenant boundary', () => {
  it('throws NonRetriableError before service client when storage_path does not start with organization_id/', async () => {
    const { transcribeAndStructureSpec } = await import(
      '@/lib/inngest/functions/transcribe-and-structure-spec'
    )

    // Inngest's createFunction returns an object whose .fn property is the
    // user handler. (Internal API but stable across recent v4 minor
    // releases.) Fall back to calling via the public Inngest test SDK if
    // that ever changes; for now, invoke the handler directly to assert
    // the synchronous tenant-boundary guard.
    const internal = transcribeAndStructureSpec as unknown as {
      fn: (ctx: {
        event: { data: unknown }
        step: { run: (name: string, fn: () => unknown) => unknown }
      }) => Promise<unknown>
    }

    if (typeof internal.fn !== 'function') {
      // SDK shape change — leave a sentinel so we notice rather than
      // silently regressing the security check.
      throw new Error(
        'Inngest function shape changed: expected `.fn` property holding the handler.',
      )
    }

    const cross = {
      event: {
        data: {
          organization_id: 'org-MINE',
          spec_draft_id: 'draft-123',
          storage_path: 'org-OTHER/user-xyz/draft-123.webm',
          mime_type: 'audio/webm',
          user_id: 'user-1',
        },
      },
      step: { run: vi.fn(async (_name: string, fn: () => unknown) => fn()) },
    }

    await expect(internal.fn(cross)).rejects.toThrow(/cross-tenant-storage-path/)
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
