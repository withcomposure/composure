import { sql } from './connection.js'
import { nowUnix } from './internal.js'
import type { AdminUserSummary } from './types.js'
import { createToken } from '../ids.js'

export const PASSWORD_RESET_EXPIRY_SETTING_KEY = 'password_reset_expiry_seconds'

function normalizeExpirySeconds(raw: unknown): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed)) return 86400
  return Math.max(300, Math.min(7 * 24 * 60 * 60, parsed))
}

export async function getServerSettingValue(key: string): Promise<string | null> {
  const [row] = await sql<[{ value: string }?]>`
    SELECT value FROM server_settings WHERE key = ${key}
  `
  return row?.value ?? null
}

export async function setServerSettingValue(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO server_settings (key, value, updated_at)
    VALUES (${key}, ${value}, extract(epoch from now())::integer)
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `
}

export async function getPasswordResetExpirySeconds(): Promise<number> {
  const stored = await getServerSettingValue(PASSWORD_RESET_EXPIRY_SETTING_KEY)
  return normalizeExpirySeconds(stored)
}

export async function setPasswordResetExpirySeconds(nextSeconds: number): Promise<number> {
  const normalized = normalizeExpirySeconds(nextSeconds)
  await setServerSettingValue(PASSWORD_RESET_EXPIRY_SETTING_KEY, String(normalized))
  return normalized
}

export async function listUsersForAdmin(search: string): Promise<AdminUserSummary[]> {
  const normalized = search.trim().toLowerCase()
  const pattern = `%${normalized}%`

  const rows = await sql<Array<{
    id: string
    email: string
    display_name: string
    role: 'user' | 'admin'
    is_suspended: boolean
    max_projects: number | null
    last_login_at: number | null
    created_at: number
  }>>`
    SELECT id, email, display_name, role, is_suspended, max_projects, last_login_at, created_at
    FROM users
    WHERE is_guest = FALSE
      AND (${normalized} = '' OR LOWER(email) LIKE ${pattern} OR LOWER(display_name) LIKE ${pattern})
    ORDER BY created_at DESC
  `

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.is_suspended === true ? 'suspended' as const : 'active' as const,
    maxProjects: row.max_projects,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  }))
}

export async function findUserForAdmin(userId: string): Promise<AdminUserSummary | null> {
  const [row] = await sql<[{
    id: string
    email: string
    display_name: string
    role: 'user' | 'admin'
    is_suspended: boolean
    max_projects: number | null
    last_login_at: number | null
    created_at: number
  }?]>`
    SELECT id, email, display_name, role, is_suspended, max_projects, last_login_at, created_at
    FROM users
    WHERE id = ${userId} AND is_guest = FALSE
    LIMIT 1
  `

  if (!row) return null

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.is_suspended === true ? 'suspended' as const : 'active' as const,
    maxProjects: row.max_projects,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  }
}

export async function createPasswordResetToken(userId: string, expiresInSeconds: number): Promise<{ token: string; expiresAt: number }> {
  const token = createToken(24)
  const createdAt = nowUnix()
  const expiresAt = createdAt + Math.max(300, expiresInSeconds)

  await sql`
    INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at, expired_early_at, used_at)
    VALUES (${token}, ${userId}, ${createdAt}, ${expiresAt}, NULL, NULL)
  `

  return { token, expiresAt }
}

export interface PasswordResetLinkRecord {
  token: string
  tokenPreview: string
  createdAt: number
  expiresAt: number
  usedAt: number | null
  expiredEarlyAt: number | null
}

export async function listPasswordResetLinksForUser(userId: string): Promise<PasswordResetLinkRecord[]> {
  const rows = await sql<Array<{
    token: string
    created_at: number
    expires_at: number
    used_at: number | null
    expired_early_at: number | null
  }>>`
    SELECT token, created_at, expires_at, used_at, expired_early_at
    FROM password_reset_tokens
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `

  return rows.map((row) => ({
    token: row.token,
    tokenPreview: `${row.token.slice(0, 8)}...`,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    expiredEarlyAt: row.expired_early_at,
  }))
}

export async function expirePasswordResetTokenEarly(token: string): Promise<boolean> {
  const result = await sql`
    UPDATE password_reset_tokens
    SET expired_early_at = extract(epoch from now())::integer
    WHERE token = ${token}
      AND used_at IS NULL
      AND expired_early_at IS NULL
      AND expires_at > extract(epoch from now())::integer
  `
  return result.count > 0
}

export async function getPasswordResetTokenState(token: string): Promise<{
  token: string
  userId: string
  email: string
  expiresAt: number
  usedAt: number | null
  expiredEarlyAt: number | null
  isSuspended: boolean
} | null> {
  const [row] = await sql<[{
    token: string
    user_id: string
    email: string
    expires_at: number
    used_at: number | null
    expired_early_at: number | null
    is_suspended: boolean
  }?]>`
    SELECT pr.token, pr.user_id, pr.expires_at, pr.used_at, pr.expired_early_at, u.email, u.is_suspended
    FROM password_reset_tokens pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.token = ${token}
    LIMIT 1
  `

  if (!row) return null

  return {
    token: row.token,
    userId: row.user_id,
    email: row.email,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    expiredEarlyAt: row.expired_early_at,
    isSuspended: row.is_suspended === true,
  }
}

export async function markPasswordResetTokenUsed(token: string): Promise<boolean> {
  const result = await sql`
    UPDATE password_reset_tokens
    SET used_at = extract(epoch from now())::integer
    WHERE token = ${token} AND used_at IS NULL
  `
  return result.count > 0
}

// ---------------------------------------------------------------------------
// Signup mode settings
// ---------------------------------------------------------------------------

export const SIGNUP_MODE_SETTING_KEY = 'signup_mode'
export const GUEST_SIGNUPS_ENABLED_KEY = 'guest_signups_enabled'
export const INVITE_EXPIRY_HOURS_KEY = 'invite_expiry_hours'
export const MAX_PROJECTS_PER_USER_KEY = 'max_projects_per_user'
export const MAX_CONCURRENT_JOBS_KEY = 'max_concurrent_jobs'
export const MAX_UPLOAD_FILE_SIZE_KEY = 'max_upload_file_size_bytes'
export const MAX_TEXT_FILE_SIZE_KEY = 'max_text_file_size_bytes'
export const MAX_FILES_PER_PROJECT_KEY = 'max_files_per_project'
export const TRASH_RETENTION_DAYS_KEY = 'trash_retention_days'
export const LARGE_FILE_THRESHOLD_CHARS_KEY = 'large_file_threshold_chars'
export const CHAT_HISTORY_RETENTION_DAYS_KEY = 'chat_history_retention_days'

export async function getTrashRetentionDays(): Promise<number> {
  const stored = await getServerSettingValue(TRASH_RETENTION_DAYS_KEY)
  const parsed = Number.parseInt(String(stored ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 30
  return Math.min(365, parsed)
}

export async function setTrashRetentionDays(value: number): Promise<number> {
  const clamped = Math.max(1, Math.min(365, Math.round(value)))
  await setServerSettingValue(TRASH_RETENTION_DAYS_KEY, String(clamped))
  return clamped
}

export async function getSignupMode(): Promise<'open' | 'invite-only'> {
  const stored = await getServerSettingValue(SIGNUP_MODE_SETTING_KEY)
  return stored === 'invite-only' ? 'invite-only' : 'open'
}

export async function setSignupMode(mode: 'open' | 'invite-only'): Promise<void> {
  await setServerSettingValue(SIGNUP_MODE_SETTING_KEY, mode)
}

export async function getGuestSignupsEnabled(): Promise<boolean> {
  const stored = await getServerSettingValue(GUEST_SIGNUPS_ENABLED_KEY)
  return stored !== 'false'
}

export async function setGuestSignupsEnabled(enabled: boolean): Promise<void> {
  await setServerSettingValue(GUEST_SIGNUPS_ENABLED_KEY, String(enabled))
}

export async function getInviteExpiryHours(): Promise<number> {
  const stored = await getServerSettingValue(INVITE_EXPIRY_HOURS_KEY)
  const parsed = Number.parseFloat(String(stored ?? ''))
  if (!Number.isFinite(parsed) || parsed < 1) return 72
  return Math.min(8760, parsed)
}

export async function setInviteExpiryHours(hours: number): Promise<number> {
  const normalized = Math.max(1, Math.min(8760, Math.round(hours)))
  await setServerSettingValue(INVITE_EXPIRY_HOURS_KEY, String(normalized))
  return normalized
}

export async function getMaxProjectsPerUser(): Promise<string> {
  const stored = await getServerSettingValue(MAX_PROJECTS_PER_USER_KEY)
  if (!stored || stored === 'unlimited') return 'unlimited'
  const parsed = Number.parseInt(stored, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 'unlimited'
  return String(parsed)
}

export async function setMaxProjectsPerUser(value: string): Promise<string> {
  if (value === 'unlimited' || !value) {
    await setServerSettingValue(MAX_PROJECTS_PER_USER_KEY, 'unlimited')
    return 'unlimited'
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    await setServerSettingValue(MAX_PROJECTS_PER_USER_KEY, 'unlimited')
    return 'unlimited'
  }
  const clamped = String(Math.min(10000, parsed))
  await setServerSettingValue(MAX_PROJECTS_PER_USER_KEY, clamped)
  return clamped
}

export async function getMaxConcurrentJobs(): Promise<number> {
  const stored = await getServerSettingValue(MAX_CONCURRENT_JOBS_KEY)
  const parsed = Number.parseInt(String(stored ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 3
  return Math.min(50, parsed)
}

export async function setMaxConcurrentJobs(value: number): Promise<number> {
  const clamped = Math.max(1, Math.min(50, Math.round(value)))
  await setServerSettingValue(MAX_CONCURRENT_JOBS_KEY, String(clamped))
  return clamped
}

// ---------------------------------------------------------------------------
// Upload / text / file-count limits (all support 'unlimited')
// ---------------------------------------------------------------------------

type LimitValue = number | 'unlimited'

function parseLimitSetting(
  stored: string | null,
  defaultValue: number,
  min: number,
  max: number,
): LimitValue {
  if (!stored) return defaultValue
  if (stored === 'unlimited') return 'unlimited'
  const parsed = Number.parseInt(stored, 10)
  if (!Number.isFinite(parsed) || parsed < min) return defaultValue
  return Math.min(max, parsed)
}

async function storeLimitSetting(
  key: string,
  value: LimitValue,
  min: number,
  max: number,
): Promise<LimitValue> {
  if (value === 'unlimited') {
    await setServerSettingValue(key, 'unlimited')
    return 'unlimited'
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < min) {
    await setServerSettingValue(key, 'unlimited')
    return 'unlimited'
  }
  const clamped = Math.min(max, Math.round(parsed))
  await setServerSettingValue(key, String(clamped))
  return clamped
}

const defaultMaxUpload = 50 * 1024 * 1024 // 50 MB
const minUpload = 1024                    // 1 KB
const maxUpload = 500 * 1024 * 1024       // 500 MB

export async function getMaxUploadFileSize(): Promise<LimitValue> {
  return parseLimitSetting(await getServerSettingValue(MAX_UPLOAD_FILE_SIZE_KEY), defaultMaxUpload, minUpload, maxUpload)
}

export async function setMaxUploadFileSize(value: LimitValue): Promise<LimitValue> {
  return storeLimitSetting(MAX_UPLOAD_FILE_SIZE_KEY, value, minUpload, maxUpload)
}

const defaultMaxText = 5 * 1024 * 1024 // 5 MB
const minText = 1024                   // 1 KB
const maxText = 100 * 1024 * 1024      // 100 MB

export async function getMaxTextFileSize(): Promise<LimitValue> {
  return parseLimitSetting(await getServerSettingValue(MAX_TEXT_FILE_SIZE_KEY), defaultMaxText, minText, maxText)
}

export async function setMaxTextFileSize(value: LimitValue): Promise<LimitValue> {
  return storeLimitSetting(MAX_TEXT_FILE_SIZE_KEY, value, minText, maxText)
}

const defaultMaxFiles = 200
const minFiles = 1
const maxFiles = 10000

export async function getMaxFilesPerProject(): Promise<LimitValue> {
  return parseLimitSetting(await getServerSettingValue(MAX_FILES_PER_PROJECT_KEY), defaultMaxFiles, minFiles, maxFiles)
}

export async function setMaxFilesPerProject(value: LimitValue): Promise<LimitValue> {
  return storeLimitSetting(MAX_FILES_PER_PROJECT_KEY, value, minFiles, maxFiles)
}

const defaultLargeFileThreshold = 500_000
const minLargeFileThreshold = 100_000
const maxLargeFileThreshold = 5_000_000

export async function getLargeFileThresholdChars(): Promise<number> {
  const stored = await getServerSettingValue(LARGE_FILE_THRESHOLD_CHARS_KEY)
  if (!stored) return defaultLargeFileThreshold
  const parsed = Number.parseInt(stored, 10)
  if (!Number.isFinite(parsed) || parsed < minLargeFileThreshold) return defaultLargeFileThreshold
  return Math.min(maxLargeFileThreshold, parsed)
}

export async function setLargeFileThresholdChars(value: number): Promise<number> {
  const clamped = Math.max(minLargeFileThreshold, Math.min(maxLargeFileThreshold, Math.round(value)))
  await setServerSettingValue(LARGE_FILE_THRESHOLD_CHARS_KEY, String(clamped))
  return clamped
}

export type ChatHistoryRetentionDays = number | 'unlimited' | 'off'

const defaultChatHistoryRetentionDays: ChatHistoryRetentionDays = 'unlimited'
const minChatHistoryRetentionDays = 1
const maxChatHistoryRetentionDays = 3650

export async function getChatHistoryRetentionDays(): Promise<ChatHistoryRetentionDays> {
  const stored = await getServerSettingValue(CHAT_HISTORY_RETENTION_DAYS_KEY)
  if (!stored || stored === 'unlimited') {
    return defaultChatHistoryRetentionDays
  }

  if (stored === 'off') {
    return 'off'
  }

  const parsed = Number.parseInt(stored, 10)
  if (!Number.isFinite(parsed) || parsed < minChatHistoryRetentionDays) {
    return defaultChatHistoryRetentionDays
  }

  return Math.min(maxChatHistoryRetentionDays, parsed)
}

export async function setChatHistoryRetentionDays(
  value: ChatHistoryRetentionDays,
): Promise<ChatHistoryRetentionDays> {
  if (value === 'unlimited' || value === 'off') {
    await setServerSettingValue(CHAT_HISTORY_RETENTION_DAYS_KEY, value)
    return value
  }

  const parsed = Number.isFinite(value) ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < minChatHistoryRetentionDays) {
    await setServerSettingValue(CHAT_HISTORY_RETENTION_DAYS_KEY, 'unlimited')
    return 'unlimited'
  }

  const clamped = Math.max(minChatHistoryRetentionDays, Math.min(maxChatHistoryRetentionDays, Math.round(parsed)))
  await setServerSettingValue(CHAT_HISTORY_RETENTION_DAYS_KEY, String(clamped))
  return clamped
}

export async function countProjectsOwnedByUser(userId: string): Promise<number> {
  const [row] = await sql<[{ count: number }]>`
    SELECT COUNT(1)::integer AS count FROM projects WHERE owner_user_id = ${userId} AND deleted_at IS NULL
  `
  return row.count
}

// ---------------------------------------------------------------------------
// Invite tokens
// ---------------------------------------------------------------------------

export interface InviteTokenRecord {
  token: string
  tokenPreview: string
  createdAt: number
  expiresAt: number
  email: string | null
  usedAt: number | null
}

export async function createInviteToken(createdBy: string, email: string | null): Promise<{ token: string; expiresAt: number }> {
  const token = createToken(24)
  const createdAt = nowUnix()
  const expiryHours = await getInviteExpiryHours()
  const expiresAt = createdAt + Math.round(expiryHours * 3600)

  await sql`
    INSERT INTO invite_tokens (token, created_by, created_at, expires_at, used_at, email)
    VALUES (${token}, ${createdBy}, ${createdAt}, ${expiresAt}, NULL, ${email || null})
  `

  return { token, expiresAt }
}

export async function listActiveInviteTokens(): Promise<InviteTokenRecord[]> {
  const rows = await sql<Array<{
    token: string
    created_at: number
    expires_at: number
    used_at: number | null
    email: string | null
  }>>`
    SELECT token, created_at, expires_at, used_at, email
    FROM invite_tokens
    WHERE expires_at > extract(epoch from now())::integer
    ORDER BY created_at DESC
  `

  return rows.map((row) => ({
    token: row.token,
    tokenPreview: `${row.token.slice(0, 8)}...`,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    email: row.email,
    usedAt: row.used_at,
  }))
}

export async function revokeInviteToken(token: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM invite_tokens
    WHERE token = ${token}
      AND used_at IS NULL
  `
  return result.count > 0
}

export async function getInviteTokenState(token: string): Promise<{
  token: string
  expiresAt: number
  usedAt: number | null
  email: string | null
} | null> {
  const [row] = await sql<[{
    token: string
    expires_at: number
    used_at: number | null
    email: string | null
  }?]>`
    SELECT token, expires_at, used_at, email FROM invite_tokens WHERE token = ${token}
  `

  if (!row) return null
  return {
    token: row.token,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    email: row.email,
  }
}

export async function markInviteTokenUsed(token: string): Promise<boolean> {
  const result = await sql`
    UPDATE invite_tokens
    SET used_at = extract(epoch from now())::integer
    WHERE token = ${token} AND used_at IS NULL
  `
  return result.count > 0
}

// ---------------------------------------------------------------------------
// SMTP settings (stored in server_settings KV table)
// ---------------------------------------------------------------------------

const smtpKeys = {
  host: 'smtp_host',
  port: 'smtp_port',
  username: 'smtp_username',
  password: 'smtp_password',
  senderName: 'smtp_sender_name',
  senderAddress: 'smtp_sender_address',
  encryption: 'smtp_encryption',
} as const

export interface SmtpSettings {
  host: string
  port: number
  username: string
  password: string
  senderName: string
  senderAddress: string
  encryption: 'none' | 'starttls' | 'tls'
}

export interface SmtpSettingsMasked {
  host: string
  port: number
  username: string
  hasPassword: boolean
  senderName: string
  senderAddress: string
  encryption: 'none' | 'starttls' | 'tls'
}

function normalizeEncryption(raw: string | null): 'none' | 'starttls' | 'tls' {
  if (raw === 'starttls' || raw === 'tls') return raw
  return 'none'
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  return {
    host: (await getServerSettingValue(smtpKeys.host)) ?? '',
    port: Number.parseInt((await getServerSettingValue(smtpKeys.port)) ?? '587', 10) || 587,
    username: (await getServerSettingValue(smtpKeys.username)) ?? '',
    password: (await getServerSettingValue(smtpKeys.password)) ?? '',
    senderName: (await getServerSettingValue(smtpKeys.senderName)) ?? '',
    senderAddress: (await getServerSettingValue(smtpKeys.senderAddress)) ?? '',
    encryption: normalizeEncryption(await getServerSettingValue(smtpKeys.encryption)),
  }
}

export async function getSmtpSettingsMasked(): Promise<SmtpSettingsMasked> {
  const settings = await getSmtpSettings()
  return {
    host: settings.host,
    port: settings.port,
    username: settings.username,
    hasPassword: settings.password.length > 0,
    senderName: settings.senderName,
    senderAddress: settings.senderAddress,
    encryption: settings.encryption,
  }
}

export async function updateSmtpSettings(patch: Partial<{
  host: string
  port: number
  username: string
  password: string
  senderName: string
  senderAddress: string
  encryption: string
}>): Promise<void> {
  if (patch.host !== undefined) await setServerSettingValue(smtpKeys.host, patch.host)
  if (patch.port !== undefined) await setServerSettingValue(smtpKeys.port, String(patch.port))
  if (patch.username !== undefined) await setServerSettingValue(smtpKeys.username, patch.username)
  if (typeof patch.password === 'string' && patch.password.length > 0) {
    await setServerSettingValue(smtpKeys.password, patch.password)
  }
  if (patch.senderName !== undefined) await setServerSettingValue(smtpKeys.senderName, patch.senderName)
  if (patch.senderAddress !== undefined) await setServerSettingValue(smtpKeys.senderAddress, patch.senderAddress)
  if (patch.encryption !== undefined) {
    await setServerSettingValue(smtpKeys.encryption, normalizeEncryption(patch.encryption))
  }
}
