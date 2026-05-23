import { ImageResponse } from 'next/og'

// Next.js dynamic apple-icon convention. iOS adds inset around the icon
// when the user taps "Add to Home Screen", so we use the manifest's
// `purpose: 'maskable'` shape — keep the glyph centered with generous
// padding so safe-area clipping doesn't crop the "A".

export const runtime = 'edge'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#111111',
          color: '#ffffff',
          fontSize: 110,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          fontFamily: 'system-ui',
        }}
      >
        A
      </div>
    ),
    { ...size },
  )
}
