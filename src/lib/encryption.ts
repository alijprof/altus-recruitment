import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { env } from '@/lib/env'

// ---------------------------------------------------------------------------
// aes-256-gcm at-rest encryption helper. Used by src/lib/db/outlook-
// credentials.ts to wrap OAuth tokens before they hit Postgres (D2-16).
//
// On-wire format: `${iv_b64}:${authTag_b64}:${ciphertext_b64}`. Three
// base64 segments separated by `:`. Versioning lives on the row (the
// `encryption_key_version` column on outlook_credentials), NOT in this
// packed string — rotating the key triggers a full re-encryption pass
// outside this module.
//
// Never log plaintext OR ciphertext to Sentry — exceptions propagate to
// the caller, which decides what (if anything) is safe to log.
// ---------------------------------------------------------------------------

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12 // 96-bit IV is the GCM spec recommendation.
const KEY_BYTES = 32 // aes-256.

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = env.EMAIL_TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'encryption: EMAIL_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add to .env.local.',
    )
  }
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    throw new Error(
      'encryption: EMAIL_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 random bytes).',
    )
  }
  const buf = Buffer.from(raw, 'hex')
  if (buf.length !== KEY_BYTES) {
    throw new Error(`encryption: key length ${buf.length} ≠ ${KEY_BYTES}`)
  }
  cachedKey = buf
  return buf
}

/**
 * Encrypt utf-8 plaintext with a fresh random IV. Returns a `:`-joined
 * base64 triple: iv, authTag, ciphertext.
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`
}

/**
 * Decrypt a packed base64 triple produced by `encrypt()`. Throws on
 * malformed input or tampered authentication tag (`crypto.AuthenticationError`
 * from `cipher.final()`).
 */
export function decrypt(packed: string): string {
  const parts = packed.split(':')
  if (parts.length !== 3) {
    throw new Error('encryption: malformed ciphertext')
  }
  const [ivB64, authTagB64, ctB64] = parts as [string, string, string]
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  if (iv.length !== IV_BYTES) {
    throw new Error('encryption: malformed ciphertext (iv length)')
  }
  const key = getKey()
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
