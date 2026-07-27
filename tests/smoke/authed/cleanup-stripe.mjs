// Cleanup: cancel the smoke subscription and delete the test customer in Stripe,
// so production Stripe isn't left in a test-subscribed state. REST only (no SDK).
const KEY = process.env.STRIPE_SECRET_KEY
const CUSTOMER = process.env.SMOKE_CUSTOMER ?? 'cus_UeAVysEmOtvFgR'
const SUB = process.env.SMOKE_SUB ?? 'sub_1TesPXPBItVyToLkQ0ynim3E'

if (!KEY) {
  console.error('STRIPE_SECRET_KEY not set')
  process.exit(1)
}
const auth = 'Basic ' + Buffer.from(KEY + ':').toString('base64')

// 1) Cancel the subscription immediately (fires customer.subscription.deleted).
const cancel = await fetch(`https://api.stripe.com/v1/subscriptions/${SUB}`, {
  method: 'DELETE',
  headers: { Authorization: auth },
})
const cancelBody = await cancel.json().catch(() => ({}))
console.log('[cleanup] cancel subscription:', cancel.status, cancelBody.status ?? cancelBody.error?.message ?? '')

// 2) Delete the test customer (removes the customer object from test mode).
const del = await fetch(`https://api.stripe.com/v1/customers/${CUSTOMER}`, {
  method: 'DELETE',
  headers: { Authorization: auth },
})
const delBody = await del.json().catch(() => ({}))
console.log('[cleanup] delete customer:', del.status, delBody.deleted ?? delBody.error?.message ?? '')
console.log('[cleanup] stripe cleanup done.')
