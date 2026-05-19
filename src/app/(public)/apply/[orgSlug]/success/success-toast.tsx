'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

// Tiny client wrapper that fires a sonner toast on mount. Lives in its own
// file so the success page stays a Server Component (the page may be
// pre-rendered later if we add static export hints).

export function SuccessToast() {
  useEffect(() => {
    toast.success('Application received')
  }, [])
  return null
}
