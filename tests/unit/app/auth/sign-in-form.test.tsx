import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SignInForm } from '@/app/(auth)/sign-in/sign-in-form'

// --- mocks -----------------------------------------------------------------
let mockSearchParams = new URLSearchParams()
const mockReplace = vi.fn()
const mockRefresh = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh, push: mockPush }),
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

const signInWithPassword = vi.fn()
const signInWithOtp = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword, signInWithOtp },
  }),
}))

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  mockReplace.mockReset()
  mockRefresh.mockReset()
  mockPush.mockReset()
  signInWithPassword.mockReset().mockResolvedValue({ error: null })
  signInWithOtp.mockReset().mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SignInForm', () => {
  it('defaults to magic link with no password field', () => {
    render(<SignInForm inviteMode={false} />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /sign in with a password instead/i }),
    ).toBeInTheDocument()
  })

  it('reveals the password field (and forgot link) after toggling', async () => {
    const user = userEvent.setup()
    render(<SignInForm inviteMode={false} />)
    await user.click(screen.getByRole('button', { name: /password instead/i }))
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forgot \/ set a password/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  it('shows a friendly "no password set yet" message on invalid_credentials', async () => {
    const user = userEvent.setup()
    signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
    })
    render(<SignInForm inviteMode={false} />)
    await user.click(screen.getByRole('button', { name: /password instead/i }))
    await user.type(screen.getByLabelText(/email/i), 'returning@agency.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/add a password in Settings/i)
    // Must NOT surface the raw Supabase string with no guidance.
    expect(alert).not.toHaveTextContent(/^Invalid login credentials$/)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('routes unconfirmed users to the magic link on email_not_confirmed', async () => {
    const user = userEvent.setup()
    signInWithPassword.mockResolvedValue({
      error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
    })
    render(<SignInForm inviteMode={false} />)
    await user.click(screen.getByRole('button', { name: /password instead/i }))
    await user.type(screen.getByLabelText(/email/i), 'new@agency.com')
    await user.type(screen.getByLabelText(/^password$/i), 'whatever12')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm your email first/i)
  })

  it('does not trim the password and redirects to "/" on success', async () => {
    const user = userEvent.setup()
    render(<SignInForm inviteMode={false} />)
    await user.click(screen.getByRole('button', { name: /password instead/i }))
    await user.type(screen.getByLabelText(/email/i), 'ok@agency.com')
    // Leading/trailing spaces must survive verbatim.
    await user.type(screen.getByLabelText(/^password$/i), '  Sp aced-pw1  ')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ok@agency.com',
      password: '  Sp aced-pw1  ',
    })
    expect(mockReplace).toHaveBeenCalledWith('/')
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('honours the ?next= deep-link on password sign-in (via safeNext)', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams({ next: '/candidates/abc' })
    render(<SignInForm inviteMode={false} />)
    await user.click(screen.getByRole('button', { name: /password instead/i }))
    await user.type(screen.getByLabelText(/email/i), 'ok@agency.com')
    await user.type(screen.getByLabelText(/^password$/i), 'good-pw-123')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(mockReplace).toHaveBeenCalledWith('/candidates/abc')
  })

  it('rejects an off-origin ?next= (open-redirect guard)', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams({ next: 'https://evil.com' })
    render(<SignInForm inviteMode={false} />)
    await user.click(screen.getByRole('button', { name: /password instead/i }))
    await user.type(screen.getByLabelText(/email/i), 'ok@agency.com')
    await user.type(screen.getByLabelText(/^password$/i), 'good-pw-123')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('hides the password method in invite mode and forwards no ?next', async () => {
    const user = userEvent.setup()
    render(<SignInForm inviteMode={true} />)
    // No password toggle for invitees (they have no account yet).
    expect(screen.queryByRole('button', { name: /password instead/i })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/email/i), 'invitee@agency.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'invitee@agency.com',
        options: expect.objectContaining({ shouldCreateUser: true }),
      }),
    )
    // Confirmation state is shown after a successful send.
    expect(await screen.findByText(/check/i)).toBeInTheDocument()
  })

  it('sends a magic link with shouldCreateUser:false for normal sign-in', async () => {
    const user = userEvent.setup()
    render(<SignInForm inviteMode={false} />)
    await user.type(screen.getByLabelText(/email/i), 'someone@agency.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'someone@agency.com',
        options: expect.objectContaining({ shouldCreateUser: false }),
      }),
    )
  })
})
