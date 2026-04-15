import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PopupDialog } from '../src/components/PopupDialog'

describe('PopupDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <PopupDialog open={false} title="Test" actions={[]} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders title and message when open', () => {
    render(
      <PopupDialog
        open={true}
        title="Confirm Action"
        message="Are you sure?"
        actions={[]}
      />,
    )
    expect(screen.getByText('Confirm Action')).toBeInTheDocument()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('renders action buttons', () => {
    render(
      <PopupDialog
        open={true}
        title="Test"
        actions={[
          { label: 'Save', onClick: () => {} },
          { label: 'Delete', onClick: () => {}, variant: 'danger' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('calls action onClick when clicked', async () => {
    const user = userEvent.setup()
    let clicked = false
    render(
      <PopupDialog
        open={true}
        title="Test"
        actions={[{ label: 'Confirm', onClick: () => { clicked = true } }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(clicked).toBe(true)
  })

  it('renders dismiss button', async () => {
    const user = userEvent.setup()
    let dismissed = false
    render(
      <PopupDialog
        open={true}
        title="Test"
        actions={[]}
        dismiss={{ label: 'Cancel', onClick: () => { dismissed = true } }}
      />,
    )
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelBtn).toBeInTheDocument()
    await user.click(cancelBtn)
    expect(dismissed).toBe(true)
  })

  it('renders children content', () => {
    render(
      <PopupDialog open={true} title="Test" actions={[]}>
        <p>Custom content here</p>
      </PopupDialog>,
    )
    expect(screen.getByText('Custom content here')).toBeInTheDocument()
  })

  it('disables action button when disabled prop set', () => {
    render(
      <PopupDialog
        open={true}
        title="Test"
        actions={[{ label: 'Save', onClick: () => {}, disabled: true }]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('renders dialog with role="dialog"', () => {
    render(
      <PopupDialog open={true} title="Test" actions={[]} />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
