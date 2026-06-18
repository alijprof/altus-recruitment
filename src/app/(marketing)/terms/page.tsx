import type { Metadata } from 'next'

// Public terms of service stub. Reachable unauthenticated (PUBLIC_PATHS).
//
// ⚠️ SCAFFOLD — placeholder pending a solicitor-drafted terms of service.
// Created alongside the privacy notice so the footer link is never dead.

export const metadata: Metadata = {
  title: 'Terms of Service — Altus',
  description: 'Terms of service for the Altus recruitment CRM.',
}

const LAST_UPDATED = '2026-06-18'

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold" style={{ color: '#0A3D5C' }}>
        Terms of Service
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">Last updated: {LAST_UPDATED}</p>

      <div
        role="note"
        className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        <strong>Draft — pending legal review.</strong> A full terms of service is being prepared.
        For any questions about using Altus in the meantime, please contact us.
      </div>

      <div className="text-muted-foreground mt-8 space-y-3 text-sm leading-relaxed">
        <p>
          These terms govern access to and use of the Altus recruitment CRM. By creating an
          account or using the service you agree to the terms set out here once finalised.
        </p>
        <p>
          Until the full terms are published, your use of Altus is governed by the agreement made
          at sign-up and the privacy practices described in our{' '}
          <a href="/privacy" className="underline">
            privacy policy
          </a>
          .
        </p>
      </div>
    </div>
  )
}
