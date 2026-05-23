'use client'

// Mirror of the useSyncExternalStore + matchMedia pattern in
// src/app/(app)/jobs/[id]/pipeline/pipeline-shell.tsx. SSR snapshot returns
// false (mobile) so desktops see a one-frame swap on hydration — same
// acceptable trade-off as the pipeline shell.
//
// The hook returns true when viewport is BELOW md (768px).

import { useSyncExternalStore } from 'react'

const DESKTOP_MIN_WIDTH = 768
const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getClientSnapshot(): boolean {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches
}

// SSR snapshot — always desktop. Mobile viewports will swap on hydrate.
function getServerSnapshot(): boolean {
  return true
}

/**
 * Returns true when the viewport is below md (768px).
 * Uses useSyncExternalStore so changes are tracked without useEffect.
 */
export function useIsMobile(): boolean {
  const isDesktop = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
  return !isDesktop
}
