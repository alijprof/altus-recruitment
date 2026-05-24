import { z } from 'zod'

// Quick task 260524-bpy: Team page server actions input schemas.
//
// Email is lowercased here (defence in depth — the DB has a CHECK constraint
// requiring lower(email) = email; the trim+lowercase in this schema guarantees
// the action body never has to handle case sensitivity).

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email.')
    .max(255, 'Too long'),
})
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

export const revokeInviteSchema = z.object({
  inviteId: z.string().uuid('Invalid invitation id.'),
})
export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>

export const resendInviteSchema = z.object({
  inviteId: z.string().uuid('Invalid invitation id.'),
})
export type ResendInviteInput = z.infer<typeof resendInviteSchema>
