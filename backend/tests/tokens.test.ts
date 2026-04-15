import { describe, it, expect, beforeEach } from 'vitest'
import { initTestDatabase, sql } from '../src/db/connection.js'
import {
  createInviteToken,
  getInviteTokenState,
  markInviteTokenUsed,
  revokeInviteToken,
  createPasswordResetToken,
  getPasswordResetTokenState,
  markPasswordResetTokenUsed,
} from '../src/db/admin.js'
import { createTestUser } from './helpers/setup.js'

beforeEach(async () => {
  await initTestDatabase()
})

describe('invite token lifecycle', () => {
  it('creates and retrieves a valid invite token', async () => {
    const admin = await createTestUser({ email: 'admin@test.com' })
    const { token } = await createInviteToken(admin.id, null)

    const state = await getInviteTokenState(token)
    expect(state).not.toBeNull()
    expect(state!.usedAt).toBeNull()
    expect(state!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('marks token as used', async () => {
    const admin = await createTestUser()
    const { token } = await createInviteToken(admin.id, null)

    await markInviteTokenUsed(token)

    const state = await getInviteTokenState(token)
    expect(state).not.toBeNull()
    expect(state!.usedAt).not.toBeNull()
  })

  it('email-restricted invite token stores email', async () => {
    const admin = await createTestUser()
    const { token } = await createInviteToken(admin.id, 'specific@test.com')

    const state = await getInviteTokenState(token)
    expect(state).not.toBeNull()
    expect(state!.email).toBe('specific@test.com')
  })

  it('returns null for non-existent token', async () => {
    const state = await getInviteTokenState('nonexistent-token')
    expect(state).toBeNull()
  })

  it('revokes an invite token', async () => {
    const admin = await createTestUser()
    const { token } = await createInviteToken(admin.id, null)

    await revokeInviteToken(token)

    const state = await getInviteTokenState(token)
    expect(state).toBeNull()
  })
})

describe('password reset token lifecycle', () => {
  it('creates and retrieves a valid password reset token', async () => {
    const user = await createTestUser()
    const { token } = await createPasswordResetToken(user.id, 3600)

    const state = await getPasswordResetTokenState(token)
    expect(state).not.toBeNull()
    expect(state!.userId).toBe(user.id)
    expect(state!.usedAt).toBeNull()
  })

  it('marks token as used', async () => {
    const user = await createTestUser()
    const { token } = await createPasswordResetToken(user.id, 3600)

    await markPasswordResetTokenUsed(token)

    const state = await getPasswordResetTokenState(token)
    expect(state).not.toBeNull()
    expect(state!.usedAt).not.toBeNull()
  })

  it('returns null for non-existent token', async () => {
    const state = await getPasswordResetTokenState('does-not-exist')
    expect(state).toBeNull()
  })

  it('expired token state is still retrievable but past expiry', async () => {
    const user = await createTestUser()
    const token = 'expired-test-token'
    const now = Math.floor(Date.now() / 1000)
    await sql`INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at)
       VALUES (${token}, ${user.id}, ${now - 7200}, ${now - 3600})`

    const state = await getPasswordResetTokenState(token)
    expect(state).not.toBeNull()
    expect(state!.expiresAt).toBeLessThanOrEqual(now)
  })
})
