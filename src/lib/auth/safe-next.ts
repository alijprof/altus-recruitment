// Validates the `?next=` redirect param to prevent open-redirect attacks.
//
// Returns a safe relative path or `/` as a fallback. Rejects:
//   - null / empty string
//   - anything that does not start with `/`
//   - protocol-relative (`//evil.com`)
//   - backslash variants (`/\evil.com`) that some browsers normalise
//   - any string containing `://` (defence in depth against `/example://attacker`)
//
// Reference: CONTEXT.md D-02, RESEARCH §2.
export function safeNext(rawNext: string | null): string {
  if (!rawNext) return '/'
  if (!rawNext.startsWith('/')) return '/'
  if (rawNext.startsWith('//')) return '/'
  if (rawNext.startsWith('/\\')) return '/'
  if (rawNext.includes('://')) return '/'
  return rawNext
}
