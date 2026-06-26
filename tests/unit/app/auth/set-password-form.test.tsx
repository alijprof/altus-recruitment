import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SetPasswordForm } from '@/app/(app)/settings/security/set-password-form'

const updateUser = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser } }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}))

beforeEach(() => {
  updateUser.mockReset().mockResolvedValue({ error: null })
  toastSuccess.mockReset()
  toastError.mockReset()
})

afterEach(() => vi.clearAllMocks())

describe('SetPasswordForm', () => {
  it('rejects a password shorter than 8 characters without calling updateUser', async () => {
    const user = userEvent.setup()
    render(<SetPasswordForm />)
    await user.type(screen.getByLabelText(/^new password$/i), 'short')
    await user.type(screen.getByLabelText(/confirm new password/i), 'short')
    await user.click(screen.getByRole('button', { name: /save password/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    const user = userEvent.setup()
    render(<SetPasswordForm />)
    await user.type(screen.getByLabelText(/^new password$/i), 'longenough1')
    await user.type(screen.getByLabelText(/confirm new password/i), 'different12')
    await user.click(screen.getByRole('button', { name: /save password/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/don't match/i)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('calls updateUser with the raw (untrimmed) password and toasts success', async () => {
    const user = userEvent.setup()
    render(<SetPasswordForm />)
    const pw = '  Str0ng Pass!  '
    await user.type(screen.getByLabelText(/^new password$/i), pw)
    await user.type(screen.getByLabelText(/confirm new password/i), pw)
    await user.click(screen.getByRole('button', { name: /save password/i }))
    expect(updateUser).toHaveBeenCalledWith({ password: pw })
    expect(toastSuccess).toHaveBeenCalledWith('Password updated')
  })

  it('surfaces an updateUser error and does not falsely report success', async () => {
    const user = userEvent.setup()
    updateUser.mockResolvedValue({ error: { message: 'New password should be different.' } })
    render(<SetPasswordForm />)
    await user.type(screen.getByLabelText(/^new password$/i), 'longenough1')
    await user.type(screen.getByLabelText(/confirm new password/i), 'longenough1')
    await user.click(screen.getByRole('button', { name: /save password/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/should be different/i)
    expect(toastError).toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows the strength meter label as the password is typed', async () => {
    const user = userEvent.setup()
    render(<SetPasswordForm />)
    await user.type(screen.getByLabelText(/^new password$/i), 'Abcdefghij12')
    // Strong = all four heuristics satisfied; label is announced to AT.
    expect(await screen.findByText(/strong/i)).toBeInTheDocument()
  })
})
