import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import {
  countPasskeyCredentialsForUser,
  countUserAuthMethods,
  createPasskeyCredential,
  deletePasskeyCredentialsForUser,
  findPasskeyCredential,
  findPasskeyCredentialWithUser,
  getPasskeyLoginEnabled,
  listPasskeyCredentialsForUser,
  markPasskeyCredentialUsed,
  markUserLoggedIn,
  runWithIdentityContext,
  setRequestIdentity,
  updatePendingInvitesForUser,
} from '../db/index.js'
import { issueAuthCookies, makeSessionPayload } from '../auth.js'
import { migrateGuestData, signState, verifyState } from './oauth.js'
import { isTrustedRequestOrigin, normalizeOriginHeader, parseTrustedOrigins } from '../env.js'

const relyingPartyName = 'Composure'
const challengeTtlMs = 10 * 60 * 1000

interface WebAuthnContext {
  origin: string
  rpID: string
}

/**
 * The WebAuthn relying-party ID must match the origin the browser ceremony
 * runs on, so it is derived from the request's Origin header — accepted only
 * when that origin is already trusted for CSRF purposes.
 */
function resolveWebAuthnContext(req: FastifyRequest): WebAuthnContext | null {
  const origin = normalizeOriginHeader(req.headers.origin)
  if (!origin) return null

  const trustedOrigins = new Set(parseTrustedOrigins(process.env.CORS_ORIGIN, process.env.NODE_ENV))
  const trusted = isTrustedRequestOrigin({
    originHeader: origin,
    hostHeader: req.headers['x-forwarded-host'] ?? req.headers.host,
    forwardedProtoHeader: req.headers['x-forwarded-proto'],
    trustedOrigins,
  })
  if (!trusted) return null

  try {
    return { origin, rpID: new URL(origin).hostname }
  } catch {
    return null
  }
}

function parseChallengeToken(
  token: unknown,
  kind: 'passkey_register' | 'passkey_login',
): { challenge: string; userId: string | null } | null {
  if (typeof token !== 'string' || token.trim().length === 0) return null
  const payload = verifyState(token.trim())
  if (!payload || payload.kind !== kind) return null

  const ts = typeof payload.ts === 'number' ? payload.ts : Number.NaN
  if (!Number.isFinite(ts) || Date.now() - ts > challengeTtlMs) return null

  const challenge = typeof payload.challenge === 'string' ? payload.challenge : null
  if (!challenge) return null

  return { challenge, userId: typeof payload.userId === 'string' ? payload.userId : null }
}

function parseTransports(value: unknown): AuthenticatorTransportFuture[] | undefined {
  if (!Array.isArray(value)) return undefined
  const transports = value.filter((t): t is AuthenticatorTransportFuture => typeof t === 'string')
  return transports.length > 0 ? transports : undefined
}

export function registerPasskeyRoutes(app: FastifyInstance, apiPath: (p: string) => string): void {
  // POST /auth/passkey/register/options — begin passkey registration (must be authenticated)
  app.post(apiPath('/auth/passkey/register/options'), async (req, reply) => {
    if (!req.authUser) {
      reply.status(401).send({ error: 'Authentication required' })
      return
    }
    if (!(await getPasskeyLoginEnabled())) {
      reply.status(403).send({ error: 'Passkey login is disabled.' })
      return
    }

    const context = resolveWebAuthnContext(req)
    if (!context) {
      reply.status(400).send({ error: 'Could not determine a trusted origin for passkey registration.' })
      return
    }

    const existing = await listPasskeyCredentialsForUser(req.authUser.id)
    const options = await generateRegistrationOptions({
      rpName: relyingPartyName,
      rpID: context.rpID,
      userName: req.authUser.email,
      userDisplayName: req.authUser.displayName,
      attestationType: 'none',
      excludeCredentials: existing.map((cred) => ({
        id: cred.id,
        transports: parseTransports(cred.transports ? JSON.parse(cred.transports) : undefined),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    })

    const token = signState({
      kind: 'passkey_register',
      challenge: options.challenge,
      userId: req.authUser.id,
      ts: Date.now(),
    })

    reply.send({ options, token })
  })

  // POST /auth/passkey/register — finish passkey registration
  app.post(apiPath('/auth/passkey/register'), async (req, reply) => {
    if (!req.authUser) {
      reply.status(401).send({ error: 'Authentication required' })
      return
    }

    const body = req.body as { token?: string; response?: RegistrationResponseJSON } | undefined
    const state = parseChallengeToken(body?.token, 'passkey_register')
    if (!state || state.userId !== req.authUser.id || !body?.response) {
      reply.status(400).send({ error: 'Invalid or expired passkey registration request.' })
      return
    }

    const context = resolveWebAuthnContext(req)
    if (!context) {
      reply.status(400).send({ error: 'Could not determine a trusted origin for passkey registration.' })
      return
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: state.challenge,
        expectedOrigin: context.origin,
        expectedRPID: context.rpID,
        requireUserVerification: false,
      })
    } catch (err) {
      console.error('[passkey] registration verification failed:', err)
      reply.status(400).send({ error: 'Passkey registration could not be verified.' })
      return
    }

    if (!verification.verified || !verification.registrationInfo) {
      reply.status(400).send({ error: 'Passkey registration could not be verified.' })
      return
    }

    const { credential } = verification.registrationInfo
    const existing = await findPasskeyCredential(credential.id)
    if (existing) {
      reply.status(409).send({ error: 'This passkey is already registered.' })
      return
    }

    await createPasskeyCredential({
      id: credential.id,
      userId: req.authUser.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
    })

    reply.send({ ok: true })
  })

  // POST /auth/passkey/login/options — begin passkey login (anonymous)
  app.post(apiPath('/auth/passkey/login/options'), async (req, reply) => {
    if (!(await getPasskeyLoginEnabled())) {
      reply.status(403).send({ error: 'Passkey login is disabled.' })
      return
    }

    const context = resolveWebAuthnContext(req)
    if (!context) {
      reply.status(400).send({ error: 'Could not determine a trusted origin for passkey login.' })
      return
    }

    const options = await generateAuthenticationOptions({
      rpID: context.rpID,
      userVerification: 'preferred',
    })

    const token = signState({
      kind: 'passkey_login',
      challenge: options.challenge,
      ts: Date.now(),
    })

    reply.send({ options, token })
  })

  // POST /auth/passkey/login — finish passkey login and issue a session
  app.post(apiPath('/auth/passkey/login'), async (req, reply) => {
    if (!(await getPasskeyLoginEnabled())) {
      reply.status(403).send({ error: 'Passkey login is disabled.' })
      return
    }

    const body = req.body as { token?: string; response?: AuthenticationResponseJSON } | undefined
    const state = parseChallengeToken(body?.token, 'passkey_login')
    if (!state || !body?.response?.id) {
      reply.status(400).send({ error: 'Invalid or expired passkey login request.' })
      return
    }

    const context = resolveWebAuthnContext(req)
    if (!context) {
      reply.status(400).send({ error: 'Could not determine a trusted origin for passkey login.' })
      return
    }

    const stored = await runWithIdentityContext(
      null,
      'system',
      async () => await findPasskeyCredentialWithUser(body.response!.id),
    )
    if (!stored || stored.user_is_guest) {
      reply.status(401).send({ error: 'Passkey not recognized.' })
      return
    }
    if (stored.user_is_suspended) {
      reply.status(403).send({ error: 'Credentials expired. Contact a server administrator.' })
      return
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: state.challenge,
        expectedOrigin: context.origin,
        expectedRPID: context.rpID,
        requireUserVerification: false,
        credential: {
          id: stored.id,
          publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64url')),
          counter: stored.counter,
          transports: parseTransports(stored.transports ? JSON.parse(stored.transports) : undefined),
        },
      })
    } catch (err) {
      console.error('[passkey] authentication verification failed:', err)
      reply.status(401).send({ error: 'Passkey could not be verified.' })
      return
    }

    if (!verification.verified) {
      reply.status(401).send({ error: 'Passkey could not be verified.' })
      return
    }

    await runWithIdentityContext(null, 'system', async () => {
      await markPasskeyCredentialUsed(stored.id, verification.authenticationInfo.newCounter)
      await markUserLoggedIn(stored.user_id)
    })

    await issueAuthCookies(req, reply, stored.user_id)
    await migrateGuestData(req, reply, stored.user_id)

    const acceptedInvites = await runWithIdentityContext(
      null,
      'system',
      async () => await updatePendingInvitesForUser(stored.user_id, stored.user_email),
    )
    if (acceptedInvites > 0) {
      console.info(`[passkey] accepted pending invites userId=${stored.user_id} count=${acceptedInvites}`)
    }

    req.authUser = {
      id: stored.user_id,
      email: stored.user_email,
      displayName: stored.user_display_name,
      profileImageUrl: stored.user_profile_image_url,
      role: stored.user_role,
      isGuest: false,
    }
    req.principal.userId = stored.user_id
    setRequestIdentity(stored.user_id, stored.user_role)

    reply.send(await makeSessionPayload(req))
  })

  // DELETE /auth/passkey — remove all passkeys from the current account
  app.delete(apiPath('/auth/passkey'), async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser) {
      reply.status(401).send({ error: 'Authentication required' })
      return
    }

    const count = await countPasskeyCredentialsForUser(req.authUser.id)
    if (count === 0) {
      reply.status(404).send({ error: 'No passkeys are registered for this account.' })
      return
    }

    const methodCount = await countUserAuthMethods(req.authUser.id)
    if (methodCount <= 1) {
      reply.status(400).send({ error: 'Cannot remove your only login method. Add another provider or set a password first.' })
      return
    }

    await deletePasskeyCredentialsForUser(req.authUser.id)
    reply.send({ ok: true })
  })
}
