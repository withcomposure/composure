import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareModal } from '../src/workspace/ShareModal'

function baseProps() {
  return {
    open: true,
    inviteEmail: '',
    inviteRole: 'view' as const,
    inviting: false,
    linkEnabled: true,
    linkRole: 'view' as const,
    people: [],
    canManage: true,
    shareUrl: 'https://example.test/project/abc?share=token123',
    onClose: vi.fn(),
    onInviteEmailChange: vi.fn(),
    onInviteRoleChange: vi.fn(),
    onInvite: vi.fn(),
    onMemberRoleChange: vi.fn(),
    onLinkToggle: vi.fn(),
    onLinkRoleChange: vi.fn(),
    onLinkInvalidate: vi.fn(),
  }
}

describe('ShareModal link sharing controls', () => {
  it('shows share link field with copy and rotate actions when link sharing is enabled', () => {
    render(<ShareModal {...baseProps()} />)

    expect(screen.getByRole('textbox', { name: 'Share link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invalidate' })).not.toBeInTheDocument()
  })

  it('does not auto-focus the share link when toggled from off to on', async () => {
    const props = baseProps()
    const { rerender } = render(<ShareModal {...props} linkEnabled={false} />)

    rerender(<ShareModal {...props} linkEnabled={true} />)

    const input = await screen.findByRole('textbox', { name: 'Share link' }) as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
  })

  it('supports engine-aware role options for whiteboards (view/edit only)', async () => {
    const user = userEvent.setup()
    render(<ShareModal {...baseProps()} allowedRoles={['view', 'edit']} />)

    await user.click(screen.getAllByRole('button', { name: 'Can view' })[0])

    expect(screen.getAllByText('Can view').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Can edit').length).toBeGreaterThan(0)
    expect(screen.queryByText('Can comment')).not.toBeInTheDocument()
  })
})
