import { Inngest } from 'inngest'

import { env } from '@/lib/env'

// Singleton Inngest client. All Inngest functions are registered with this
// client and the same instance is used to send events from server actions.
export const inngest = new Inngest({
  id: 'altus-recruitment',
  eventKey: env.INNGEST_EVENT_KEY,
})
