import crypto from 'crypto'
import {
  SignJWT,
  jwtVerify,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  calculateJwkThumbprint,
  createLocalJWKSet,
  type JWK,
  type JWTPayload,
} from 'jose'

const jwtAlgorithm = 'ES256'
const accessTokenTtlSeconds = 15 * 60

let initialized = false
let issuer = process.env.JWT_ISSUER?.trim() || 'composure'
let privateKey: CryptoKey
let jwks: { keys: JWK[] }
let localJwks: ReturnType<typeof createLocalJWKSet>

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

async function exportPublicJwkFromPrivateKey(key: CryptoKey): Promise<JWK> {
  const privateJwk = await exportJWK(key)
  if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.x || !privateJwk.y) {
    throw new Error('JWT_PRIVATE_KEY_PEM must be an EC P-256 private key for ES256 signing.')
  }

  return {
    kty: privateJwk.kty,
    crv: privateJwk.crv,
    x: privateJwk.x,
    y: privateJwk.y,
  }
}

async function initializeKeys(): Promise<void> {
  if (initialized) {
    return
  }

  const privatePem = process.env.JWT_PRIVATE_KEY_PEM?.trim()

  let publicJwk: JWK

  if (privatePem) {
    privateKey = await importPKCS8(privatePem, jwtAlgorithm)
    const exportablePrivateKey = await importPKCS8(privatePem, jwtAlgorithm, { extractable: true })
    publicJwk = await exportPublicJwkFromPrivateKey(exportablePrivateKey)
  } else {
    const generated = await generateKeyPair(jwtAlgorithm)
    privateKey = generated.privateKey
    publicJwk = await exportJWK(generated.publicKey)
    console.warn('[auth] JWT_PRIVATE_KEY_PEM not configured; using ephemeral in-memory keypair.')
  }

  publicJwk.alg = jwtAlgorithm
  publicJwk.use = 'sig'
  publicJwk.kid = await calculateJwkThumbprint(publicJwk, 'sha256')

  jwks = { keys: [publicJwk] }
  localJwks = createLocalJWKSet(jwks)
  initialized = true
}

export async function getJwksResponse(): Promise<{ keys: JWK[] }> {
  await initializeKeys()
  return jwks
}

export async function signAccessToken(subject: string): Promise<{ token: string; expiresAt: number }> {
  await initializeKeys()

  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + accessTokenTtlSeconds
  const [key] = jwks.keys
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: jwtAlgorithm, kid: key?.kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(privateKey)

  return { token, expiresAt }
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  await initializeKeys()
  try {
    const verified = await jwtVerify(token, localJwks, {
      algorithms: [jwtAlgorithm],
      issuer,
    })
    return verified.payload
  } catch {
    return null
  }
}

export async function decodeAccessTokenUnsafe(token: string): Promise<JWTPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  try {
    const payloadRaw = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')
    return JSON.parse(payloadRaw) as JWTPayload
  } catch {
    return null
  }
}

export function createRefreshFamilyId(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function getAccessTokenTtlSeconds(): number {
  return accessTokenTtlSeconds
}

export function getRefreshTokenTtlSeconds(): number {
  const configured = Number.parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS ?? '', 10)
  if (Number.isFinite(configured) && configured > 0) {
    return configured
  }
  return 30 * 24 * 60 * 60
}

export function getJwtIssuer(): string {
  return issuer
}

export function setJwtIssuer(nextIssuer: string | null | undefined): void {
  const normalized = nextIssuer?.trim()
  if (!normalized) {
    return
  }
  issuer = normalized
}

export function resetJwtForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetJwtForTests is only available in test mode.')
  }

  initialized = false
  issuer = process.env.JWT_ISSUER?.trim() || 'composure'
}

export function tokenExpiresInSeconds(expiresAtUnix: number): number {
  return Math.max(0, expiresAtUnix - toEpochSeconds(new Date()))
}
