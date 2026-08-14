import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthEntryView } from '../src/auth/AuthEntryView'

const defaults = {
  busy: false,
  error: null,
  guestRetentionDays: 30,
  guestSignupsEnabled: true,
  userCount: 1,
  signupMode: 'open' as const,
  initialMode: 'login' as const,
  enabledLoginProviders: [],
  onLogin: () => {},
  onPasskeyLogin: () => {},
  onSignup: () => {},
  onPasswordReset: () => {},
  onContinueAsGuest: () => {},
}

describe('AuthEntryView', () => {
  it('renders login mode by default', () => {
    const { container } = render(<AuthEntryView {...defaults} />)
    // Submit button inside form says "Log in"
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()
    expect(submitBtn.textContent).toMatch(/log in/i)
  })

  it('renders create account button in open signup mode', () => {
    render(<AuthEntryView {...defaults} />)
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
  })

  it('does not show create account toggle in invite-only mode', () => {
    render(<AuthEntryView {...defaults} signupMode="invite-only" />)
    // In invite-only mode with no invite token, only login should show
    expect(screen.queryByRole('button', { name: /create account/i })).toBeNull()
  })

  it('shows bootstrap message when userCount is 0', () => {
    render(<AuthEntryView {...defaults} userCount={0} />)
    expect(screen.getByText(/first account/i)).toBeInTheDocument()
    expect(screen.getByText(/server administrator/i)).toBeInTheDocument()
  })

  it('shows invite message when inviteToken is provided', () => {
    render(<AuthEntryView {...defaults} inviteToken="abc123" />)
    expect(screen.getByText(/invited/i)).toBeInTheDocument()
  })

  it('passes invite token to OAuth login links', () => {
    render(
      <AuthEntryView
        {...defaults}
        inviteToken="abc123"
        enabledLoginProviders={['github']}
      />,
    )

    const githubLink = screen.getByRole('link', { name: /continue with github/i })
    expect(githubLink).toHaveAttribute('href', expect.stringContaining('invite_token=abc123'))
  })

  it('displays error message', () => {
    render(<AuthEntryView {...defaults} error="Something went wrong" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('shows busy state on submit button', () => {
    render(<AuthEntryView {...defaults} busy={true} />)
    expect(screen.getByRole('button', { name: /please wait/i })).toBeDisabled()
  })

  it('shows guest button with retention days', () => {
    render(<AuthEntryView {...defaults} initialMode="signup" guestRetentionDays={45} />)
    expect(screen.getByRole('button', { name: /continue as guest/i })).toBeInTheDocument()
    expect(screen.getByText(/45 days/i)).toBeInTheDocument()
  })

  it('hides guest button when guest signups are disabled', () => {
    render(<AuthEntryView {...defaults} guestSignupsEnabled={false} />)
    expect(screen.queryByRole('button', { name: /continue as guest/i })).toBeNull()
    expect(screen.queryByText(/days of inactivity/i)).toBeNull()
  })

  it('calls onContinueAsGuest when guest button clicked', async () => {
    const user = userEvent.setup()
    let guestClicked = false
    render(<AuthEntryView {...defaults} initialMode="signup" onContinueAsGuest={() => { guestClicked = true }} />)

    await user.click(screen.getByRole('button', { name: /continue as guest/i }))
    expect(guestClicked).toBe(true)
  })

  it('calls onLogin with email and password', async () => {
    const user = userEvent.setup()
    let loginPayload: { email: string; password: string } | null = null
    const { container } = render(
      <AuthEntryView
        {...defaults}
        onLogin={(input) => { loginPayload = input }}
      />,
    )

    await user.type(screen.getByPlaceholderText(/you@example/i), 'test@test.com')
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement
    await user.type(passwordInput, 'mypassword')
    // Click the submit button (type="submit") to avoid matching the mode-toggle tab
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement
    await user.click(submitBtn)

    expect(loginPayload).toEqual({ email: 'test@test.com', password: 'mypassword' })
  })

  it('shows password reset mode', () => {
    const { container } = render(
      <AuthEntryView
        {...defaults}
        resetToken="reset123"
        resetEmail="user@test.com"
      />,
    )

    // Check that there are two password inputs (new password + confirm password)
    const passwordInputs = container.querySelectorAll('input[type="password"]')
    expect(passwordInputs.length).toBe(2)
    // Submit button should say "Set new password"
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn.textContent).toMatch(/set new password/i)
    // Guest button should NOT show in reset mode
    expect(screen.queryByRole('button', { name: /continue as guest/i })).toBeNull()
  })

  it('shows password mismatch warning', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <AuthEntryView
        {...defaults}
        resetToken="reset123"
        resetEmail="user@test.com"
      />,
    )

    const passwordInputs = container.querySelectorAll('input[type="password"]')
    // First password input is "New password", second is "Confirm password"
    await user.type(passwordInputs[0] as HTMLInputElement, 'password123')
    await user.type(passwordInputs[1] as HTMLInputElement, 'password999')

    expect(screen.getByText(/passwords must match/i)).toBeInTheDocument()
  })

  it('displays display name field in signup mode', () => {
    render(<AuthEntryView {...defaults} initialMode="signup" />)

    expect(screen.getByPlaceholderText(/ada lovelace/i)).toBeInTheDocument()
  })

  it('validates display name minimum length', async () => {
    const user = userEvent.setup()
    render(<AuthEntryView {...defaults} userCount={0} />)

    await user.type(screen.getByPlaceholderText(/ada lovelace/i), 'A')

    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument()
  })
})
