import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompleteProfileView } from '../src/auth/CompleteProfileView'

describe('CompleteProfileView', () => {
  it('renders provider and display name context', () => {
    render(
      <CompleteProfileView
        busy={false}
        error={null}
        provider="orcid"
        displayName="Test User"
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByText(/finish signing in with ORCID/i)).toBeInTheDocument()
    expect(screen.getByText(/Signed in as Test User/i)).toBeInTheDocument()
  })

  it('submits normalized email', async () => {
    const user = userEvent.setup()
    let submitted: string | null = null

    render(
      <CompleteProfileView
        busy={false}
        error={null}
        provider="orcid"
        onSubmit={(email) => {
          submitted = email
        }}
        onCancel={() => {}}
      />,
    )

    await user.type(screen.getByPlaceholderText(/you@example.com/i), '  Person@Example.COM  ')
    await user.click(screen.getByRole('button', { name: /complete sign in/i }))

    expect(submitted).toBe('person@example.com')
  })

  it('calls cancel handler', async () => {
    const user = userEvent.setup()
    let cancelled = false

    render(
      <CompleteProfileView
        busy={false}
        error={null}
        provider="orcid"
        onSubmit={() => {}}
        onCancel={() => {
          cancelled = true
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /start over/i }))
    expect(cancelled).toBe(true)
  })
})
