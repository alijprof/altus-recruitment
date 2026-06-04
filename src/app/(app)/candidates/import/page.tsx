import Link from 'next/link'

import { Button } from '@/components/ui/button'

import { ImportWizard } from './import-wizard'

export default function ImportCandidatesPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button
          variant="link"
          asChild
          className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
        >
          <Link href="/candidates">← All candidates</Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Import candidates</h1>
        <p className="text-muted-foreground mt-1 text-sm font-normal">
          Upload a CSV file to bulk-import candidates. Duplicates (matched by email) are skipped
          automatically.
        </p>
      </div>
      <ImportWizard />
    </div>
  )
}
