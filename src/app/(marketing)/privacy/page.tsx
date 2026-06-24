import type { Metadata } from 'next'

// Public privacy notice. Reachable unauthenticated (added to PUBLIC_PATHS) so
// job applicants on the /apply/<slug> form can read it from the consent block.
//
// MULTI-TENANT: this is a PLATFORM-PROVIDED notice shown to applicants of every
// agency using Altus. The data controller is the recruitment agency the
// applicant applied to (which differs per tenant), so the notice refers to "the
// recruitment agency you applied to" generically rather than naming one agency.
// Altus is the processor. Agencies with specific requirements (named ICO
// registration, bespoke retention) should still take their own legal advice;
// the Article 28 controller–processor DPA between Altus and each agency is a
// separate signed document, not this page.

export const metadata: Metadata = {
  title: 'Privacy Policy — Altus',
  description: 'How Altus and the recruitment agencies using it handle personal data.',
}

const LAST_UPDATED = '2026-06-24'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold" style={{ color: '#0A3D5C' }}>
        {title}
      </h2>
      <div className="text-muted-foreground mt-2 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold" style={{ color: '#0A3D5C' }}>
        Privacy Policy
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">Last updated: {LAST_UPDATED}</p>

      <Section title="1. Who we are">
        <p>
          This privacy notice explains how the recruitment agency you applied to
          (&ldquo;the agency&rdquo;, &ldquo;we&rdquo;) handles your personal data when you apply for
          roles or are considered for opportunities. The agency is the{' '}
          <strong>data controller</strong> for your application data.
        </p>
        <p>
          The agency uses Altus, an AI-first recruitment CRM, to manage candidate data on its
          behalf. Altus acts as the agency&rsquo;s <strong>data processor</strong> under a written
          data-processing agreement and only processes your data on the agency&rsquo;s documented
          instructions.
        </p>
        <p>
          For data-protection matters, contact the recruitment agency you applied to — if you
          applied through a link they sent you, you can reply to that email. You can also escalate to
          the Information Commissioner&rsquo;s Office (see section 8).
        </p>
      </Section>

      <Section title="2. What data we collect">
        <p>When you apply or are added to our database, we may hold:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Identity &amp; contact details (name, email, phone, location)</li>
          <li>Your CV and the information in it (work history, skills, education)</li>
          <li>Application details (the role applied for, availability, salary expectations, source)</li>
          <li>Notes and correspondence relating to your candidacy</li>
        </ul>
      </Section>

      <Section title="3. Lawful basis for processing">
        <p>
          We rely on your <strong>consent</strong> (given when you submit an application) and/or our{' '}
          <strong>legitimate interests</strong> in matching candidates to suitable roles. Where we
          rely on consent, you can withdraw it at any time (see &ldquo;Your rights&rdquo; below).
        </p>
      </Section>

      <Section title="4. How long we keep it">
        <p>
          We retain your data for up to <strong>2 years from our last meaningful contact</strong>{' '}
          with you, after which it is deleted, unless a longer period is required by law or you ask
          us to remove it sooner.
        </p>
      </Section>

      <Section title="5. Who your data is shared with (sub-processors)">
        <p>
          We do not sell your data. To provide the service, your data is processed by the following
          sub-processors under appropriate data-protection terms:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Supabase</strong> &amp; <strong>Vercel</strong> — secure database, storage and
            application hosting
          </li>
          <li>
            <strong>Anthropic (Claude)</strong> and <strong>Voyage AI</strong> — AI parsing of CVs,
            candidate&ndash;role matching and search
          </li>
          <li>
            <strong>OpenAI (Whisper)</strong> — transcription of recorded call notes, where used
          </li>
          <li>
            <strong>Resend</strong> — sending transactional and (where you have consented) marketing
            email
          </li>
        </ul>
        <p>
          We share your CV with a prospective employer <strong>only</strong> with your knowledge in
          the context of a specific role.
        </p>
      </Section>

      <Section title="6. International transfers">
        <p>
          Some sub-processors may process data outside the UK. Where they do, transfers are covered
          by appropriate safeguards, such as the UK International Data Transfer Agreement or an
          adequacy decision.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>Under UK GDPR you have the right to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Access a copy of the personal data we hold about you</li>
          <li>Have inaccurate data corrected</li>
          <li>Have your data erased (&ldquo;right to be forgotten&rdquo;)</li>
          <li>Restrict or object to processing</li>
          <li>Data portability</li>
          <li>Withdraw consent at any time, without affecting prior processing</li>
        </ul>
        <p>
          To exercise any of these rights, contact the recruitment agency you applied to (the
          controller of your data). We will respond within one month.
        </p>
      </Section>

      <Section title="8. Complaints">
        <p>
          If you are unhappy with how we handle your data you can complain to the UK Information
          Commissioner&rsquo;s Office (ICO) at{' '}
          <a
            href="https://ico.org.uk/make-a-complaint/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            ico.org.uk
          </a>
          . We would appreciate the chance to address your concerns first.
        </p>
      </Section>

      <Section title="9. Changes to this notice">
        <p>
          We may update this notice from time to time. The date at the top shows when it was last
          revised.
        </p>
      </Section>
    </div>
  )
}
