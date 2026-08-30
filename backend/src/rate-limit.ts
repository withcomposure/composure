import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'

export interface RateLimitRule {
  max: number
  windowMs: number
}

interface WindowState {
  count: number
  resetAt: number
}

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

/**
 * Fixed-window, in-memory rate limiter.
 *
 * In-memory means the counters are per-process: correct for a single backend
 * instance (or sticky routing). If the API is ever scaled to multiple replicas
 * behind a load balancer, this must move to a shared store (e.g. Redis) or the
 * effective limit becomes `max * replicas`.
 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, WindowState>()
  private lastSweepAt = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  check(key: string, rule: RateLimitRule): RateLimitDecision {
    const t = this.now()
    this.sweep(t)

    let state = this.buckets.get(key)
    if (!state || state.resetAt <= t) {
      state = { count: 0, resetAt: t + rule.windowMs }
      this.buckets.set(key, state)
    }

    state.count += 1
    const allowed = state.count <= rule.max
    return {
      allowed,
      remaining: Math.max(0, rule.max - state.count),
      retryAfterMs: allowed ? 0 : Math.max(0, state.resetAt - t),
    }
  }

  private sweep(t: number): void {
    if (t - this.lastSweepAt < 60_000) return
    this.lastSweepAt = t
    for (const [key, state] of this.buckets) {
      if (state.resetAt <= t) this.buckets.delete(key)
    }
  }

  reset(): void {
    this.buckets.clear()
    this.lastSweepAt = 0
  }
}

/**
 * Fastify `trustProxy` value from env.
 *
 * Getting this right is what makes per-IP limiting real: behind a proxy you
 * must name the hop so `request.ip` resolves to the client, not the proxy
 * (which would collapse everyone into one bucket). Trusting blindly (`true`)
 * lets an attacker spoof `X-Forwarded-For` for a fresh bucket per request, so
 * that is opt-in only. Default: trust nothing (use the socket address).
 *
 * Accepted: unset/"false" → false; "true" → true; anything else → a
 * comma-separated IP/subnet allowlist passed through verbatim. Numeric hop
 * counts are rejected (fail closed): Fastify >= 5.12 ignores them because a
 * hop count cannot validate the immediate peer, so honoring one here would
 * silently trust nothing anyway.
 */
export function resolveTrustProxy(raw: string | undefined): boolean | string {
  const value = String(raw ?? '').trim()
  if (!value || value.toLowerCase() === 'false') return false
  if (value.toLowerCase() === 'true') return true
  const asNumber = Number(value)
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    console.warn(
      `[server] TRUST_PROXY=${value}: numeric hop counts are no longer supported; trusting nothing. List your proxy IPs/subnets instead.`,
    )
    return false
  }
  return value
}

/**
 * Normalize a client IP into a rate-limit key component.
 *
 * IPv6 clients routinely control a whole /64 (or larger), so a single actor can
 * cycle through effectively unlimited individual addresses. Key IPv6 on the /64
 * prefix instead of the full address. IPv4 (including IPv4-mapped IPv6) is used
 * whole.
 */
export function clientIpKey(ip: string): string {
  if (!ip) return 'unknown'
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip)
  if (mapped) return mapped[1]
  if (ip.includes(':')) return ipv6Prefix64(ip)
  return ip
}

function ipv6Prefix64(addr: string): string {
  const zoneless = addr.split('%', 1)[0]
  const [head, tail] = zoneless.split('::')
  const headParts = head ? head.split(':').filter(Boolean) : []
  const tailParts = tail != null ? tail.split(':').filter(Boolean) : []
  const missing = 8 - (headParts.length + tailParts.length)
  const full = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts]
  const first4 = full.slice(0, 4).map((group) => group || '0')
  return `${first4.join(':')}::/64`
}

export interface KeyedRule {
  key: string
  rule: RateLimitRule
}

/**
 * Build a preHandler that enforces one or more keyed limits. If any is
 * exceeded, responds 429 with a Retry-After header. `keys` returns the list of
 * (key, rule) pairs to check for a given request — e.g. an ip+email key and a
 * looser email-only key.
 */
export function rateLimitPreHandler(
  limiter: FixedWindowRateLimiter,
  keys: (req: FastifyRequest) => KeyedRule[],
): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    let worst: RateLimitDecision | null = null
    for (const { key, rule } of keys(req)) {
      const decision = limiter.check(key, rule)
      if (!decision.allowed && (!worst || decision.retryAfterMs > worst.retryAfterMs)) {
        worst = decision
      }
    }
    if (worst) {
      const retryAfterSec = Math.ceil(worst.retryAfterMs / 1000)
      reply.header('Retry-After', String(retryAfterSec))
      reply.status(429).send({ error: 'Too many requests. Please try again later.' })
    }
  }
}

export function normalizeEmailForKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}
