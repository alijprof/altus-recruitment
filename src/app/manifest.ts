import type { MetadataRoute } from 'next'

// Web app manifest powering "Add to Home Screen" / install prompts on
// Android + desktop Chrome. iOS reads apple-icon.tsx + the apple-mobile-web-
// app-* meta tags in app/layout.tsx separately.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Altus Recruitment',
    short_name: 'Altus',
    description: 'AI-first recruitment CRM.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111111',
    orientation: 'portrait',
    icons: [
      // Generated dynamically by app/icon.tsx (PWA install icon).
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // Generated dynamically by app/apple-icon.tsx (iOS Home Screen).
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
