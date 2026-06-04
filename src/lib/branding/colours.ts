// Hex colour validation helpers — BRAND-01 (05-02).
//
// This module is intentionally free of 'use client' / 'use server' so it can
// be imported from both the Server Action (actions.ts) and the RSC render
// (apply page). It has no side-effects and no external dependencies.
//
// SINGLE SOURCE OF TRUTH for the hex regex: HEX_RE. The Zod schema in
// branding/schema.ts mirrors it; the render in apply/[orgSlug]/page.tsx
// re-validates through safeHex at render time (defence in depth per Pitfall 5
// in the Phase 5 research: inject only as CSS custom property, never as a
// <style> tag string).

/** Altus default brand colours. Used as fallback when org has no branding. */
export const BRAND_DEFAULTS = {
  primary: '#0A3D5C', // Midnight
  secondary: '#5DCAA5', // Mint
} as const

/** Module-private regex. Do NOT inline this pattern elsewhere — reference BRAND_DEFAULTS for display. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Returns true iff `v` is a 6-digit hex colour string (e.g. '#0A3D5C').
 * Rejects 3-digit shorthand, named colours, injection payloads, and non-strings.
 */
export function isHexColour(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

/**
 * Returns `raw` if it passes isHexColour; otherwise returns `fallback`.
 * Used at the render boundary to ensure a CSS custom property is never
 * populated with an unsanitised value even if a rogue DB write bypassed
 * the Server Action + DB CHECK layers.
 */
export function safeHex(raw: unknown, fallback: string): string {
  return isHexColour(raw) ? raw : fallback
}
