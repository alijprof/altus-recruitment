import {
  BarChart3,
  Briefcase,
  Building2,
  LayoutDashboard,
  Phone,
  Plug,
  Search,
  Settings,
  Users,
  Workflow,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { ScreenshotSlot } from './screenshot-slot'

export default async function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        <p className="text-muted-foreground text-sm font-normal">
          Everything Altus does, in plain English. New here? Skim top to bottom.
        </p>
      </header>

      {/* 1. Dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <LayoutDashboard className="size-5 shrink-0" aria-hidden="true" />
            Getting started — dashboard overview
          </CardTitle>
          <CardDescription>Your daily command centre.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              The dashboard surfaces your most recent activity at a glance: candidates added today,
              jobs in progress, upcoming follow-ups, and a quick-add button for the most common
              tasks.
            </p>
            <p>
              Everything in Altus is scoped to your organisation — your team shares one workspace,
              and you each see the same data.
            </p>
          </div>
          <ScreenshotSlot
            name="dashboard"
            caption="The Altus dashboard — recent activity and quick-add shortcuts."
          />
        </CardContent>
      </Card>

      {/* 2. Candidates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="size-5 shrink-0" aria-hidden="true" />
            Candidates &amp; CV parsing{' '}
            <Badge variant="secondary" className="ml-1">
              AI
            </Badge>
          </CardTitle>
          <CardDescription>
            Upload a CV once — Altus extracts the structured data for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              A candidate is a person who could be placed in a role. When you upload a CV, Altus
              automatically extracts name, contact details, work history, skills, and education into
              structured fields — no manual re-typing.
            </p>
            <p>
              You can also add candidates manually or let them apply through your public apply form.
              Each candidate record tracks their market status (actively looking, passively looking,
              placed, cold) and a full activity log of every interaction.
            </p>
            <p>
              CVs are stored securely and only accessible to your organisation. Consent and data
              provenance are recorded automatically for GDPR compliance.
            </p>
          </div>
          <ScreenshotSlot
            name="candidates"
            caption="A candidate record after AI CV parsing — structured fields populated automatically."
          />
        </CardContent>
      </Card>

      {/* 3. Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Search className="size-5 shrink-0" aria-hidden="true" />
            Search — semantic + keyword fallback{' '}
            <Badge variant="secondary" className="ml-1">
              AI
            </Badge>
          </CardTitle>
          <CardDescription>Find the right candidate in seconds using natural language.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              Search understands what you mean, not just what you type. Try{' '}
              <span className="text-foreground font-medium italic">
                &ldquo;Senior Python dev with offshore wind experience&rdquo;
              </span>{' '}
              — it finds candidates whose CVs match that concept even if they never used those exact
              words.
            </p>
            <p>
              Under the hood, every CV is embedded into a vector store (Voyage AI) when it is
              uploaded. Your query is embedded at search time and matched semantically. A keyword
              fallback catches exact-match cases where semantic ranking misses.
            </p>
            <p>
              Results show a match explanation — a one-line AI summary of why this candidate fits —
              so you can triage quickly.
            </p>
          </div>
          <ScreenshotSlot
            name="search"
            caption="Semantic search results with AI match explanations."
          />
        </CardContent>
      </Card>

      {/* 4. Clients */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="size-5 shrink-0" aria-hidden="true" />
            Clients
          </CardTitle>
          <CardDescription>Companies that pay for placements, and their key contacts.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              A client is a company you place candidates into. Each client record holds company
              details (sector, size, location) and a list of contacts — the hiring managers and HR
              leads you work with.
            </p>
            <p>
              A contact is a named person at a client. Contacts are the people you call for spec
              calls, send submissions to, and manage relationships with. Every job is linked to a
              client so you can see all active vacancies per account at a glance.
            </p>
          </div>
          <ScreenshotSlot
            name="clients"
            caption="Client record showing company details, contacts, and active jobs."
          />
        </CardContent>
      </Card>

      {/* 5. Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Briefcase className="size-5 shrink-0" aria-hidden="true" />
            Jobs
          </CardTitle>
          <CardDescription>Roles and vacancies your clients need filled.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              A job (also called a role or vacancy) is a position a client wants filled. Each job
              record captures the title, location, salary or day rate, IR35 status for contract
              roles, job type (perm or temp/contract), and a full job description.
            </p>
            <p>
              Jobs are linked to a client and optionally to a spec call where the brief was
              originally captured. Once a job is live, candidates can be added to its pipeline and
              submitted for the role.
            </p>
          </div>
          <ScreenshotSlot
            name="jobs"
            caption="Job record showing role details, linked client, and the candidate pipeline."
          />
        </CardContent>
      </Card>

      {/* 6. Spec calls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Phone className="size-5 shrink-0" aria-hidden="true" />
            Spec calls → job{' '}
            <Badge variant="secondary" className="ml-1">
              AI
            </Badge>
          </CardTitle>
          <CardDescription>Record a client brief and turn it into a structured job record.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              A spec call is when a client briefs you on a new role — usually verbally over the
              phone. In Altus you can record a voice note during or immediately after the call.
              Altus transcribes it (OpenAI Whisper) and extracts the key details into a draft job
              record automatically.
            </p>
            <p>
              You review the draft, fill in anything the AI missed, and confirm — the job is created
              and ready to work against. No transcription, no re-typing the same information twice.
            </p>
          </div>
          <ScreenshotSlot
            name="spec-calls"
            caption="Spec call record showing the voice transcript and the auto-generated job draft."
          />
        </CardContent>
      </Card>

      {/* 7. Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Workflow className="size-5 shrink-0" aria-hidden="true" />
            Pipeline &amp; shortlists / floats
          </CardTitle>
          <CardDescription>Move candidates through stages; floats are speculative submissions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              The pipeline tracks every candidate against every job they are being considered for.
              Stages run from Shortlisted → Submitted → Interview → Offer → Placement. Each stage
              move is logged in the activity timeline.
            </p>
            <p>
              A shortlist is your internal working set of candidates for a job before you submit
              anyone to the client. A float (or spec CV) is a speculative submission — you are
              sending a candidate to a client without a specific live vacancy, because you believe
              the client should meet them. Floats are tracked separately so you can follow up if a
              role opens up.
            </p>
            <p>
              A placement is the revenue event: a candidate starts the role. Altus records the
              placement date and fee type (perm percentage or temp margin) and feeds it into
              reports.
            </p>
          </div>
          <ScreenshotSlot
            name="pipeline"
            caption="Pipeline view — candidates across stages for a single job."
          />
        </CardContent>
      </Card>

      {/* 8. Reports */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <BarChart3 className="size-5 shrink-0" aria-hidden="true" />
            Reports{' '}
            <Badge variant="secondary" className="ml-1">
              UK perm / temp
            </Badge>
          </CardTitle>
          <CardDescription>Placement revenue, source attribution, and team activity.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              Reports show placement revenue (perm fees and temp/contract margin) broken down by
              consultant, client, and job type. Source attribution shows where your placed
              candidates originated — apply form, LinkedIn, referral, or direct — so you know which
              channels produce the most value.
            </p>
            <p>
              Activity reports show call volume, submissions, interviews, and conversion rates
              across the team. All figures are scoped to your organisation only.
            </p>
          </div>
          <ScreenshotSlot
            name="reports"
            caption="Reports dashboard — placement revenue and candidate source attribution."
          />
        </CardContent>
      </Card>

      {/* 9. Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Settings className="size-5 shrink-0" aria-hidden="true" />
            Team &amp; settings
          </CardTitle>
          <CardDescription>Profile, organisation, invite teammates, and usage/spend.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              Settings lets you update your profile (name, email), edit your organisation name and
              logo, and manage your team. Organisation owners can invite teammates by email; invited
              users receive a magic-link and join your shared workspace automatically.
            </p>
            <p>
              The Usage section shows month-to-date AI spend broken down by feature (CV parsing,
              search embeddings, match scoring). This is important for understanding cost as you
              scale your candidate database.
            </p>
          </div>
          <ScreenshotSlot
            name="settings"
            caption="Settings page — profile, organisation, team, and AI usage dashboard."
          />
        </CardContent>
      </Card>

      {/* 10. Integrations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Plug className="size-5 shrink-0" aria-hidden="true" />
            Integrations
          </CardTitle>
          <CardDescription>LinkedIn, Outlook, and your public apply form.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              <span className="text-foreground font-medium">Public apply form</span> — each
              organisation gets a shareable URL (e.g.{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                altusmove.com/apply/your-slug
              </code>
              ) where candidates can submit their CV directly. Submissions are parsed by AI and land
              straight in your candidate database.
            </p>
            <p>
              <span className="text-foreground font-medium">LinkedIn</span> — save a LinkedIn
              profile as a PDF using LinkedIn&apos;s built-in &ldquo;Save to PDF&rdquo; feature, then upload
              it to Altus as you would any other CV. The parser extracts structured data from the
              standard LinkedIn PDF format.
            </p>
            <p>
              <span className="text-foreground font-medium">Outlook / email</span> — forward CVs
              received by email to your Altus intake address and they are automatically added to the
              candidate queue for parsing. (Coming soon.)
            </p>
          </div>
          <ScreenshotSlot
            name="integrations"
            caption="Integrations — public apply form link and LinkedIn PDF upload workflow."
          />
        </CardContent>
      </Card>
    </div>
  )
}
