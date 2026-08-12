/**
 * @vitest-environment node
 *
 * image-signature — dependency-free PNG/JPEG magic-byte sniffer that gates
 * logo uploads (BCV-04). Mirrors the discipline of
 * tests/unit/lib/cv/file-signature.test.ts, driven against synthetic byte
 * fixtures for every format class. See 08-03-PLAN.md Task 2 <behavior>.
 */
import { describe, expect, it } from 'vitest'

import {
  assertUploadableLogo,
  LOGO_TOO_LARGE_MESSAGE,
  LOGO_UNSUPPORTED_FORMAT_MESSAGE,
  LOGO_WRONG_FORMAT_MESSAGE,
  MAX_LOGO_BYTES,
  sniffImageType,
} from '@/lib/upload/image-signature'

const PNG_MIME = 'image/png'
const JPEG_MIME = 'image/jpeg'

function bytesFrom(values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function asciiBytes(text: string): Uint8Array {
  return new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)))
}

// Real signatures, from 08-03-PLAN.md <interfaces>.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

function pngBytes(padding = 20): Uint8Array {
  return bytesFrom([...PNG_SIGNATURE, ...Array(padding).fill(0)])
}

function jpegBytes(padding = 20): Uint8Array {
  return bytesFrom([...JPEG_SIGNATURE, ...Array(padding).fill(0)])
}

describe('sniffImageType', () => {
  it('returns png for the 8-byte PNG signature', () => {
    expect(sniffImageType(pngBytes())).toBe('png')
  })

  it('returns jpeg for the 3-byte JPEG signature', () => {
    expect(sniffImageType(jpegBytes())).toBe('jpeg')
  })

  it('returns unknown for an empty buffer without throwing', () => {
    expect(() => sniffImageType(new Uint8Array(0))).not.toThrow()
    expect(sniffImageType(new Uint8Array(0))).toBe('unknown')
  })

  it('returns unknown for random bytes', () => {
    expect(sniffImageType(bytesFrom([0x01, 0x02, 0x03, 0x04, 0x05]))).toBe('unknown')
  })

  describe('spoofing / polyglot rejection — everything except real PNG/JPEG bytes is unknown', () => {
    it('an SVG document (<svg …) sniffs as unknown', () => {
      expect(sniffImageType(asciiBytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe('unknown')
    })

    it('a GIF (GIF89a) sniffs as unknown', () => {
      expect(sniffImageType(asciiBytes('GIF89a'))).toBe('unknown')
    })

    it('a PDF (%PDF-) sniffs as unknown', () => {
      expect(sniffImageType(asciiBytes('%PDF-1.7'))).toBe('unknown')
    })

    it('a WebP (RIFF….WEBP) sniffs as unknown', () => {
      const bytes = bytesFrom([
        ...Array.from('RIFF', (c) => c.charCodeAt(0)),
        0x00,
        0x00,
        0x00,
        0x00,
        ...Array.from('WEBP', (c) => c.charCodeAt(0)),
      ])
      expect(sniffImageType(bytes)).toBe('unknown')
    })

    it('a Windows executable (MZ) sniffs as unknown', () => {
      expect(sniffImageType(bytesFrom([0x4d, 0x5a, 0x90, 0x00]))).toBe('unknown')
    })
  })

  describe('boundary safety — truncated buffers never throw', () => {
    it('a buffer shorter than the PNG signature returns unknown', () => {
      const truncated = bytesFrom(PNG_SIGNATURE.slice(0, 4))
      expect(() => sniffImageType(truncated)).not.toThrow()
      expect(sniffImageType(truncated)).toBe('unknown')
    })

    it('a buffer shorter than the JPEG signature returns unknown', () => {
      const truncated = bytesFrom(JPEG_SIGNATURE.slice(0, 1))
      expect(() => sniffImageType(truncated)).not.toThrow()
      expect(sniffImageType(truncated)).toBe('unknown')
    })

    it('a single-byte buffer never throws', () => {
      expect(() => sniffImageType(bytesFrom([0x89]))).not.toThrow()
      expect(sniffImageType(bytesFrom([0x89]))).toBe('unknown')
    })
  })

  it('does not search a window — a PNG signature starting at offset 1 is not detected', () => {
    const shifted = bytesFrom([0x00, ...PNG_SIGNATURE])
    expect(sniffImageType(shifted)).toBe('unknown')
  })
})

describe('assertUploadableLogo', () => {
  it('returns ok:true with mime image/png and ext png for agreeing PNG bytes', () => {
    const bytes = pngBytes()
    const result = assertUploadableLogo(bytes, PNG_MIME, bytes.length)
    expect(result).toEqual({ ok: true, mime: PNG_MIME, ext: 'png' })
  })

  it('returns ok:true with mime image/jpeg and ext jpg for agreeing JPEG bytes', () => {
    const bytes = jpegBytes()
    const result = assertUploadableLogo(bytes, JPEG_MIME, bytes.length)
    expect(result).toEqual({ ok: true, mime: JPEG_MIME, ext: 'jpg' })
  })

  it('rejects a PNG-sniffing buffer declared as image/jpeg', () => {
    const bytes = pngBytes()
    const result = assertUploadableLogo(bytes, JPEG_MIME, bytes.length)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('wrong-format')
      expect(result.message).toBe(LOGO_WRONG_FORMAT_MESSAGE)
    }
  })

  it('rejects a JPEG-sniffing buffer declared as image/png', () => {
    const bytes = jpegBytes()
    const result = assertUploadableLogo(bytes, PNG_MIME, bytes.length)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('wrong-format')
      expect(result.message).toBe(LOGO_WRONG_FORMAT_MESSAGE)
    }
  })

  it('rejects an SVG regardless of declared mime, as unsupported-format', () => {
    const bytes = asciiBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const result = assertUploadableLogo(bytes, 'image/svg+xml', bytes.length)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-format')
      expect(result.message).toBe(LOGO_UNSUPPORTED_FORMAT_MESSAGE)
    }
  })

  it('rejects a GIF regardless of declared mime, as unsupported-format', () => {
    const bytes = asciiBytes('GIF89a')
    const result = assertUploadableLogo(bytes, 'image/gif', bytes.length)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported-format')
  })

  it('rejects a PDF masquerading as a logo, as unsupported-format', () => {
    const bytes = asciiBytes('%PDF-1.7')
    const result = assertUploadableLogo(bytes, PNG_MIME, bytes.length)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported-format')
  })

  it('rejects a Windows executable masquerading as a logo, as unsupported-format', () => {
    const bytes = bytesFrom([0x4d, 0x5a, 0x90, 0x00])
    const result = assertUploadableLogo(bytes, PNG_MIME, bytes.length)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported-format')
  })

  it('rejects a buffer larger than MAX_LOGO_BYTES with LOGO_TOO_LARGE_MESSAGE', () => {
    const bytes = pngBytes()
    const result = assertUploadableLogo(bytes, PNG_MIME, MAX_LOGO_BYTES + 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('too-large')
      expect(result.message).toBe(LOGO_TOO_LARGE_MESSAGE)
    }
  })

  it('accepts a buffer exactly at MAX_LOGO_BYTES', () => {
    const bytes = pngBytes()
    const result = assertUploadableLogo(bytes, PNG_MIME, MAX_LOGO_BYTES)
    expect(result.ok).toBe(true)
  })

  it('MAX_LOGO_BYTES is 2 MiB', () => {
    expect(MAX_LOGO_BYTES).toBe(2 * 1024 * 1024)
  })

  it('a truncated buffer shorter than any signature never throws — rejected unsupported-format', () => {
    const bytes = bytesFrom([0x89, 0x50])
    expect(() => assertUploadableLogo(bytes, PNG_MIME, bytes.length)).not.toThrow()
    const result = assertUploadableLogo(bytes, PNG_MIME, bytes.length)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported-format')
  })

  it('a zero-byte buffer never throws — rejected unsupported-format', () => {
    const bytes = new Uint8Array(0)
    expect(() => assertUploadableLogo(bytes, PNG_MIME, 0)).not.toThrow()
    const result = assertUploadableLogo(bytes, PNG_MIME, 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported-format')
  })

  describe('rejection message content — plain, user-facing, mentions PNG/JPEG', () => {
    it('LOGO_WRONG_FORMAT_MESSAGE mentions PNG or JPEG', () => {
      expect(LOGO_WRONG_FORMAT_MESSAGE).toMatch(/PNG|JPEG/i)
    })

    it('LOGO_UNSUPPORTED_FORMAT_MESSAGE mentions PNG/JPEG and that SVG is unsupported for PDF rendering', () => {
      expect(LOGO_UNSUPPORTED_FORMAT_MESSAGE).toMatch(/PNG/i)
      expect(LOGO_UNSUPPORTED_FORMAT_MESSAGE).toMatch(/JPEG/i)
      expect(LOGO_UNSUPPORTED_FORMAT_MESSAGE).toMatch(/SVG/i)
    })

    it('LOGO_TOO_LARGE_MESSAGE is a non-empty user-facing string', () => {
      expect(typeof LOGO_TOO_LARGE_MESSAGE).toBe('string')
      expect(LOGO_TOO_LARGE_MESSAGE.length).toBeGreaterThan(10)
    })
  })
})
