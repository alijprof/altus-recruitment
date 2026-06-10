import Link from 'next/link'

import { Button } from '@/components/ui/button'

import { CampaignBuilderForm } from './campaign-builder-form'

export default function NewCampaignPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Button
          variant="link"
          asChild
          className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
        >
          <Link href="/campaigns">← All campaigns</Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="text-muted-foreground mt-1 text-sm font-normal">
          Build a segmented email campaign in three steps: segment, message, and send.
        </p>
      </div>
      <CampaignBuilderForm />
    </div>
  )
}
