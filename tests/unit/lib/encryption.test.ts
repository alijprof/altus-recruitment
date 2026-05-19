/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

// Stub `server-only` so the helper can be imported in a Node test env.
vi.mock('server-only', () => ({}))

// Mock @/lib/env so encryption.ts can be imported without booting the full
// Zod-validated env (which would require every Phase 1 env var set in the
// vitest process — out of scope for a unit test on a single helper).
const TEST_HEX_KEY = 'a'.repeat(64) // 32 bytes of 0xAA
vi.mock('@/lib/env', () => ({
  env: { EMAIL_TOKEN_ENCRYPTION_KEY: TEST_HEX_KEY },
}))

describe('encryption (aes-256-gcm)', () => {

  it('round-trips simple ASCII', async () => {
    const { encrypt, decrypt } = await import('@/lib/encryption')
    const s = 'hello world'
    const packed = encrypt(s)
    expect(packed.split(':')).toHaveLength(3)
    expect(decrypt(packed)).toBe(s)
  })

  it('round-trips multibyte UTF-8', async () => {
    const { encrypt, decrypt } = await import('@/lib/encryption')
    const s = 'tokens: éàü 中文 🪿'
    expect(decrypt(encrypt(s))).toBe(s)
  })

  it('round-trips long values (4 KiB token)', async () => {
    const { encrypt, decrypt } = await import('@/lib/encryption')
    const s = 'x'.repeat(4096)
    expect(decrypt(encrypt(s))).toBe(s)
  })

  it('produces different ciphertext for the same plaintext (random IV)', async () => {
    const { encrypt } = await import('@/lib/encryption')
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
  })

  it('throws on malformed packed ciphertext (missing parts)', async () => {
    const { decrypt } = await import('@/lib/encryption')
    expect(() => decrypt('only-one-part')).toThrow(/malformed ciphertext/)
    expect(() => decrypt('only:two')).toThrow(/malformed ciphertext/)
  })

  it('throws on tampered authTag', async () => {
    const { encrypt, decrypt } = await import('@/lib/encryption')
    const packed = encrypt('confidential')
    const parts = packed.split(':')
    // Flip the first byte of the authTag base64.
    const tag = Buffer.from(parts[1] ?? '', 'base64')
    tag.writeUInt8((tag.readUInt8(0) ^ 0xff) & 0xff, 0)
    parts[1] = tag.toString('base64')
    expect(() => decrypt(parts.join(':'))).toThrow()
  })

  it('throws on tampered ciphertext body', async () => {
    const { encrypt, decrypt } = await import('@/lib/encryption')
    const packed = encrypt('confidential')
    const parts = packed.split(':')
    const ct = Buffer.from(parts[2] ?? '', 'base64')
    ct.writeUInt8((ct.readUInt8(0) ^ 0xff) & 0xff, 0)
    parts[2] = ct.toString('base64')
    expect(() => decrypt(parts.join(':'))).toThrow()
  })
})
