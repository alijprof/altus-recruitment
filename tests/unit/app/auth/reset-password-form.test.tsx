import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResetPasswordForm } from '@/app/(auth)/reset-password/reset-password-form'

let mockSearchParams = new URLSearchParams()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [k: string]: unknown
  }) => React.createElement('a', { href, ...rest }, children),
}))

const verifyOtp = vi.fn()
const exchangeCodeForSession = vi.fn()
const getSession = vi.fn()
const updateUser = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { verifyOtp, exchangeCodeForSession, getSession, updateUser },
  }),
}))

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  mockReplace.mockReset()
  verifyOtp.mockReset().mockResolvedValue({ error: null })
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
  getSession.mockReset().mockResolvedValue({ data: { session: null } })
  updateUser.mockReset().mockResolvedValue({ error: null })
})

afterEach(() => vi.clearAllMocks())

describe('ResetPasswordForm', () => {
  it('shows the expired state immediately when the URL carries an error param', async () => {
    mockSearchParams = new URLSearchParams({ error: 'access_denied' })
    render(<ResetPasswordForm />)
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /request a new link/i })).toBeInTheDocument()
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('verifies a recovery token_hash and enables the form', async () => {
    mockSearchParams = new URLSearchParams({ token_hash: 'abc123', type: 'recovery' })
    render(<ResetPasswordForm />)
    expect(await screen.findByRole('button', { name: /update password/i })).toBeEnabled()
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'recovery' })
  })

  it('flips to expired when the recovery token is rejected', async () => {
    mockSearchParams = new URLSearchParams({ token_hash: 'bad', type: 'recovery' })
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } })
    render(<ResetPasswordForm />)
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
  })

  it('updates the password and redirects to "/" on a valid submit', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams({ token_hash: 'abc123', type: 'recovery' })
    render(<ResetPasswordForm />)
    const submit = await screen.findByRole('button', { name: /update password/i })
    await user.type(screen.getByLabelText(/^new password$/i), 'brand-new-pw1')
    await user.type(screen.getByLabelText(/confirm new password/i), 'brand-new-pw1')
    await user.click(submit)
    expect(updateUser).toHaveBeenCalledWith({ password: 'brand-new-pw1' })
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('blocks submit on mismatched passwords without calling updateUser', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams({ token_hash: 'abc123', type: 'recovery' })
    render(<ResetPasswordForm />)
    await screen.findByRole('button', { name: /update password/i })
    await user.type(screen.getByLabelText(/^new password$/i), 'brand-new-pw1')
    await user.type(screen.getByLabelText(/confirm new password/i), 'does-not-match9')
    await user.click(screen.getByRole('button', { name: /update password/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/don't match/i)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('exchanges a PKCE ?code and enables the form', async () => {
    mockSearchParams = new URLSearchParams({ code: 'pkce-code-xyz' })
    render(<ResetPasswordForm />)
    expect(await screen.findByRole('button', { name: /update password/i })).toBeEnabled()
    expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-code-xyz')
  })

  it('treats a thrown verifyOtp as an expired link (no wedge)', async () => {
    mockSearchParams = new URLSearchParams({ token_hash: 'abc123', type: 'recovery' })
    verifyOtp.mockRejectedValue(new Error('NavigatorLockAcquireTimeoutError'))
    render(<ResetPasswordForm />)
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
  })
})
