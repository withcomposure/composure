import type {
  Principal,
  ProjectAccessPerson,
  ProjectMemberSummary,
  ProjectRole,
  ProjectRow,
  ProjectSummary,
} from './types.js'
import { ROLE_RANK } from './internal.js'
import { sql } from './connection.js'
import { runWithIdentityContext } from './request-context.js'
import { createProjectForPrincipal, findProjectById } from './projects.js'
import { findUserByEmail, findUserById } from './users.js'

async function projectBelongsToPrincipal(projectId: string, principal: Principal): Promise<boolean> {
  if (!principal.userId) {
    return false
  }

  const row = await findProjectById(projectId)
  if (!row || row.deleted_at != null) return false
  if (row.owner_user_id === principal.userId) return true

  const [membership] = await sql`
    SELECT role
    FROM project_members
    WHERE project_id = ${projectId}
      AND user_id = ${principal.userId}
      AND status = 'accepted'
    LIMIT 1
  `
  return Boolean(membership)
}

function roleAtLeast(role: ProjectRole, minimumRole: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole]
}

interface PrincipalProjectRoleResolution {
  role: ProjectRole | null
  isInvitedMember: boolean
}

async function resolveProjectRoleForPrincipal(
  projectId: string,
  principal: Principal,
): Promise<PrincipalProjectRoleResolution> {
  if (!principal.userId) {
    return { role: null, isInvitedMember: false }
  }

  const project = await findProjectById(projectId)
  if (!project || project.deleted_at != null) {
    return { role: null, isInvitedMember: false }
  }

  if (project.owner_user_id === principal.userId) {
    return { role: 'owner', isInvitedMember: true }
  }

  const [member] = await sql`
    SELECT role, invited_by_user_id
    FROM project_members
    WHERE project_id = ${projectId}
      AND user_id = ${principal.userId}
      AND status = 'accepted'
    LIMIT 1
  `

  if (!member) {
    return { role: null, isInvitedMember: false }
  }

  return {
    role: member.role as ProjectRole,
    isInvitedMember: (member.invited_by_user_id as string | null) != null,
  }
}

function requireRequestingIdentityId(requestingIdentityId: string | null | undefined): string {
  const normalized = requestingIdentityId?.trim()
  if (!normalized) {
    throw new Error('Missing requesting identity for privileged access query')
  }
  return normalized
}

function requireRequestingUserId(requestingUserId: string | null | undefined): string {
  const normalized = requestingUserId?.trim()
  if (!normalized) {
    throw new Error('Missing requesting user for privileged mutation')
  }
  return normalized
}

export async function updatePendingInvitesForUser(userId: string, email: string): Promise<number> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return 0

  const result = await sql`
    UPDATE project_members
    SET user_id = ${userId},
        invited_email = NULL,
        status = 'accepted',
        updated_at = extract(epoch from now())::integer
    WHERE invited_email = ${normalizedEmail} AND user_id IS NULL
  `

  return result.count
}

export async function getProjectRoleForPrincipal(projectId: string, principal: Principal, shareToken?: string): Promise<ProjectRole | null> {
  void shareToken
  const resolved = await resolveProjectRoleForPrincipal(projectId, principal)
  return resolved.role
}

export async function canAccessProjectChat(projectId: string, principal: Principal, shareToken?: string): Promise<{
  ok: boolean
  role: ProjectRole | null
}> {
  void shareToken
  const resolved = await resolveProjectRoleForPrincipal(projectId, principal)
  if (!resolved.role) {
    return { ok: false, role: null }
  }

  const canViewChat = resolved.isInvitedMember || roleAtLeast(resolved.role, 'comment')
  return { ok: canViewChat, role: resolved.role }
}

export async function canAccessProjectWithRole(projectId: string, principal: Principal, requiredRole: ProjectRole, shareToken?: string): Promise<{
  ok: boolean
  role: ProjectRole | null
}> {
  const role = await getProjectRoleForPrincipal(projectId, principal, shareToken)
  if (!role) {
    return { ok: false, role: null }
  }
  return { ok: roleAtLeast(role, requiredRole), role }
}

export async function ensureProjectAccess(projectId: string, principal: Principal, createIfMissing = false): Promise<{
  ok: boolean
  project: ProjectRow | null
  created: boolean
}> {
  const existing = await findProjectById(projectId)
  if (!existing) {
    if (!createIfMissing) {
      return { ok: false, project: null, created: false }
    }

    await createProjectForPrincipal({ projectId, principal })
    const created = await findProjectById(projectId)
    return { ok: Boolean(created), project: created, created: true }
  }

  if (existing.deleted_at != null) {
    return { ok: false, project: existing, created: false }
  }

  const hasAccess = await projectBelongsToPrincipal(projectId, principal)
  return { ok: hasAccess, project: existing, created: false }
}

async function listProjectMembers(projectId: string, requestingIdentityId: string): Promise<ProjectMemberSummary[]> {
  requireRequestingIdentityId(requestingIdentityId)
  // The access route checks project visibility before calling this; use a system
  // read here so users-table RLS does not strip visible collaborators' profiles.
  return await runWithIdentityContext(null, 'system', async () => {
    const rows = await sql`
      SELECT
        pm.user_id,
        COALESCE(u.email, pm.invited_email) AS email,
        COALESCE(u.display_name, pm.invited_email, 'Pending invite') AS display_name,
        COALESCE(u.profile_image_url, NULL) AS profile_image_url,
        pm.role,
        pm.status,
        pm.created_at
      FROM project_members pm
      LEFT JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ${projectId}
      ORDER BY pm.created_at ASC
    `

    return rows.map((row) => ({
      userId: row.user_id as string | null,
      email: row.email as string | null,
      displayName: row.display_name as string,
      role: row.role as ProjectRole,
      status: row.status as 'pending' | 'accepted',
      profileImageUrl: row.profile_image_url as string | null,
      invitedAt: row.created_at as number,
    }))
  })
}

export async function listPeopleWithAccess(input: {
  projectId: string
  requestingIdentityId: string
  includeEmails?: boolean
}): Promise<ProjectAccessPerson[]> {
  requireRequestingIdentityId(input.requestingIdentityId)
  const includeEmails = input.includeEmails ?? true
  const project = await findProjectById(input.projectId)
  if (!project || project.deleted_at != null) {
    return []
  }

  const people: ProjectAccessPerson[] = []

  if (project.owner_user_id) {
    const owner = await runWithIdentityContext(null, 'system', async () => await findUserById(project.owner_user_id))
    if (owner) {
      people.push({
        userId: owner.id,
        email: includeEmails ? owner.email : null,
        displayName: owner.displayName,
        profileImageUrl: owner.profileImageUrl,
        role: 'owner',
        status: 'accepted',
        isOwner: true,
      })
    }
  } else {
    people.push({
      userId: null,
      email: null,
      displayName: 'Unknown owner',
      profileImageUrl: null,
      role: 'owner',
      status: 'accepted',
      isOwner: true,
    })
  }

  const members = await listProjectMembers(input.projectId, input.requestingIdentityId)
  for (const member of members) {
    if (member.role === 'owner' || (member.userId != null && member.userId === project.owner_user_id)) {
      continue
    }

    people.push({
      userId: member.userId,
      email: includeEmails ? member.email : null,
      displayName: member.displayName,
      profileImageUrl: member.profileImageUrl,
      role: member.role,
      status: member.status,
      isOwner: false,
    })
  }

  return people
}

export async function ensureProjectOwnerMembership(
  projectId: string,
  ownerUserId: string,
  requestingUserId: string,
): Promise<void> {
  requireRequestingUserId(requestingUserId)
  await runWithIdentityContext(null, 'system', async () => {
    await sql`
      INSERT INTO project_members (
        project_id,
        user_id,
        invited_email,
        role,
        status,
        invited_by_user_id,
        created_at,
        updated_at
      )
      VALUES (${projectId}, ${ownerUserId}, NULL, 'owner', 'accepted', ${ownerUserId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
      ON CONFLICT (project_id, user_id)
      WHERE user_id IS NOT NULL
      DO UPDATE SET
        role = 'owner',
        status = 'accepted',
        invited_email = NULL,
        updated_at = excluded.updated_at
    `
  })
}

export async function upsertProjectMemberInvite(input: {
  projectId: string
  requestingUserId: string
  invitedByUserId: string | null
  email: string
  role: Exclude<ProjectRole, 'owner'>
}): Promise<{ status: 'pending' | 'accepted'; userId: string | null }> {
  const requestingUserId = requireRequestingUserId(input.requestingUserId)
  if (input.invitedByUserId && input.invitedByUserId !== requestingUserId) {
    throw new Error('Invited-by user does not match requesting user')
  }
  const normalizedEmail = input.email.trim().toLowerCase()
  const targetUser = await runWithIdentityContext(null, 'system', async () => await findUserByEmail(normalizedEmail))

  if (targetUser) {
    const project = await findProjectById(input.projectId)
    if (project?.owner_user_id === targetUser.id) {
      await ensureProjectOwnerMembership(input.projectId, targetUser.id, requestingUserId)
      return { status: 'accepted', userId: targetUser.id }
    }

    await sql`
      INSERT INTO project_members (
        project_id, user_id, invited_email, role, status, invited_by_user_id, created_at, updated_at
      ) VALUES (${input.projectId}, ${targetUser.id}, NULL, ${input.role}, 'accepted', ${input.invitedByUserId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
      ON CONFLICT(project_id, user_id) WHERE user_id IS NOT NULL
      DO UPDATE SET
        role = excluded.role,
        status = 'accepted',
        invited_email = NULL,
        invited_by_user_id = excluded.invited_by_user_id,
        updated_at = excluded.updated_at
    `

    await sql`
      DELETE FROM project_members
      WHERE project_id = ${input.projectId} AND invited_email = ${normalizedEmail} AND user_id IS NULL
    `

    return { status: 'accepted', userId: targetUser.id }
  }

  await sql`
    INSERT INTO project_members (
      project_id, user_id, invited_email, role, status, invited_by_user_id, created_at, updated_at
    ) VALUES (${input.projectId}, NULL, ${normalizedEmail}, ${input.role}, 'pending', ${input.invitedByUserId}, extract(epoch from now())::integer, extract(epoch from now())::integer)
    ON CONFLICT(project_id, invited_email) WHERE invited_email IS NOT NULL
    DO UPDATE SET role = excluded.role, status = 'pending', updated_at = excluded.updated_at
  `

  return { status: 'pending', userId: null }
}

export async function updateProjectMemberRole(projectId: string, userId: string, role: Exclude<ProjectRole, 'owner'>): Promise<boolean> {
  const result = await sql`
    UPDATE project_members pm
    SET role = ${role}, updated_at = extract(epoch from now())::integer
    WHERE pm.project_id = ${projectId}
      AND pm.user_id = ${userId}
      AND NOT EXISTS (
        SELECT 1
        FROM projects p
        WHERE p.id = pm.project_id
          AND p.owner_user_id = pm.user_id
      )
  `

  return result.count > 0
}

export async function updatePendingProjectMemberInviteRole(
  projectId: string,
  email: string,
  role: Exclude<ProjectRole, 'owner'>,
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    return false
  }

  const result = await sql`
    UPDATE project_members pm
    SET role = ${role}, updated_at = extract(epoch from now())::integer
    WHERE pm.project_id = ${projectId}
      AND pm.invited_email = ${normalizedEmail}
      AND pm.user_id IS NULL
      AND pm.status = 'pending'
  `

  return result.count > 0
}

export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM project_members pm
    WHERE pm.project_id = ${projectId}
      AND pm.user_id = ${userId}
      AND NOT EXISTS (
        SELECT 1
        FROM projects p
        WHERE p.id = pm.project_id
          AND p.owner_user_id = pm.user_id
      )
  `

  return result.count > 0
}

export async function removePendingProjectMemberInvite(projectId: string, email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    return false
  }

  const result = await sql`
    DELETE FROM project_members pm
    WHERE pm.project_id = ${projectId}
      AND pm.invited_email = ${normalizedEmail}
      AND pm.user_id IS NULL
      AND pm.status = 'pending'
  `

  return result.count > 0
}

export async function listSharedProjectsForUser(userId: string): Promise<ProjectSummary[]> {
  const rows = await sql`
    SELECT p.id, p.title, p.root_file, p.engine, p.created_at, p.last_active_at,
           (
             SELECT COUNT(1)::integer
             FROM project_comments pc
             WHERE pc.project_id = p.id AND pc.parent_comment_id IS NULL
           ) AS top_level_comment_count,
           p.owner_user_id,
           owner.display_name AS owner_display_name,
           owner.profile_image_url AS owner_profile_image_url,
           COALESCE(owner.is_guest, FALSE) AS owner_is_guest
    FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    LEFT JOIN users owner ON owner.id = p.owner_user_id
    WHERE pm.user_id = ${userId}
      AND pm.status = 'accepted'
      AND pm.role != 'owner'
      AND p.deleted_at IS NULL
    ORDER BY p.last_active_at DESC
  `

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    rootFile: row.root_file as string,
    engine: row.engine as string | null,
    createdAt: row.created_at as number,
    lastActiveAt: row.last_active_at as number,
    topLevelCommentCount: row.top_level_comment_count as number,
    ownerType: (row.owner_is_guest as boolean) ? 'guest' : 'user',
    ownerDisplayName: (row.owner_display_name as string) ?? 'Deleted User',
    ownerProfileImageUrl: row.owner_profile_image_url as string | null,
  }))
}

export async function redeemShareTokenForUser(token: string, userId: string): Promise<{ projectId: string; role: Exclude<ProjectRole, 'owner'> } | null> {
  const normalizedToken = token.trim()
  if (!normalizedToken || !userId) {
    return null
  }

  const [shared] = await sql`
    SELECT project_id, role
    FROM share_tokens
    WHERE token = ${normalizedToken}
    LIMIT 1
  `

  if (!shared) {
    return null
  }

  const projectId = shared.project_id as string
  const role = shared.role as Exclude<ProjectRole, 'owner'>

  await sql`
    INSERT INTO project_members (
      project_id,
      user_id,
      invited_email,
      role,
      status,
      invited_by_user_id,
      created_at,
      updated_at
    )
    VALUES (${projectId}, ${userId}, NULL, ${role}, 'accepted', NULL, extract(epoch from now())::integer, extract(epoch from now())::integer)
    ON CONFLICT (project_id, user_id)
    WHERE user_id IS NOT NULL
    DO UPDATE SET
      role = excluded.role,
      status = 'accepted',
      invited_email = NULL,
      updated_at = excluded.updated_at
  `

  return { projectId, role }
}
