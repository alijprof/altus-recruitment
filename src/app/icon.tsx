import { ImageResponse } from 'next/og'

// Next.js dynamic icon convention. This file becomes /icon (referenced by
// app/manifest.ts) and serves as the PWA install icon on Android + desktop
// Chrome. iOS uses apple-icon.tsx instead.

export const runtime = 'edge'
export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
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
          fontSize: 320,
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
