import { describe, it, expect } from 'vitest'

// parseRoute reads window.location, so we need to set it up for each test
function setLocation(pathname: string, search = '') {
  Object.defineProperty(window, 'location', {
    value: { pathname, search, hash: '', href: `http://localhost${pathname}${search}` },
    writable: true,
  })
}

// We dynamically import the function after setting window.location
async function getParser() {
  const mod = await import('../src/pages/utils')
  return mod.parseRoute
}

describe('parseRoute', () => {
  it('/ → projects route', async () => {
    setLocation('/')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'projects' })
  })

  it('/index.html → projects route', async () => {
    setLocation('/index.html')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'projects' })
  })

  it('/projects → projects route', async () => {
    setLocation('/projects')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'projects' })
  })

  it('/settings → settings route', async () => {
    setLocation('/settings')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'settings' })
  })

  it('/account → settings route (alias)', async () => {
    setLocation('/account')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'settings' })
  })

  it('/admin → admin route', async () => {
    setLocation('/admin')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'admin' })
  })

  it('/project/ with valid project ID → project route', async () => {
    setLocation('/project/11a0ec5340b04612b57194f60da95db7')
    const parse = (await getParser())
    expect(parse()).toEqual({
      kind: 'project',
      projectId: '11a0ec5340b04612b57194f60da95db7',
      shareToken: undefined,
    })
  })

  it('project with share query param', async () => {
    setLocation('/project/11a0ec5340b04612b57194f60da95db7', '?share=abc123')
    const parse = (await getParser())
    const result = parse()
    expect(result.kind).toBe('project')
    if (result.kind === 'project') {
      expect(result.shareToken).toBe('abc123')
    }
  })

  it('/reset-password?token=xxx → reset-password route', async () => {
    setLocation('/reset-password', '?token=resettoken123')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'reset-password', token: 'resettoken123' })
  })

  it('/invite?token=xxx → invite route', async () => {
    setLocation('/invite', '?token=invitetoken456')
    const parse = (await getParser())
    expect(parse()).toEqual({ kind: 'invite', token: 'invitetoken456' })
  })

  it('unknown route → not-found', async () => {
    setLocation('/unknown-page')
    const parse = (await getParser())
    const result = parse()
    expect(result.kind).toBe('not-found')
  })

  it('wrong pathname → not-found', async () => {
    setLocation('/some-other-page')
    const parse = (await getParser())
    const result = parse()
    expect(result.kind).toBe('not-found')
  })
})

describe('isValidProjectId', () => {
  it('accepts valid 32-char hex ID', async () => {
    const { isValidProjectId } = await import('../src/pages/utils')
    expect(isValidProjectId('11a0ec5340b04612b57194f60da95db7')).toBe(true)
  })

  it('rejects short strings', async () => {
    const { isValidProjectId } = await import('../src/pages/utils')
    expect(isValidProjectId('short')).toBe(false)
  })

  it('rejects strings with invalid characters', async () => {
    const { isValidProjectId } = await import('../src/pages/utils')
    expect(isValidProjectId('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(false)
  })
})

describe('fmtRelativeTime', () => {
  it('returns "Less than 1m ago" for timestamps within the last 60 seconds', async () => {
    const { fmtRelativeTime } = await import('../src/pages/utils')
    const now = Math.floor(Date.now() / 1000)
    expect(fmtRelativeTime(now)).toBe('Less than 1m ago')
    expect(fmtRelativeTime(now - 30)).toBe('Less than 1m ago')
    expect(fmtRelativeTime(now - 59)).toBe('Less than 1m ago')
  })

  it('returns minutes for 60-3599 seconds ago', async () => {
    const { fmtRelativeTime } = await import('../src/pages/utils')
    const now = Math.floor(Date.now() / 1000)
    expect(fmtRelativeTime(now - 60)).toBe('1m ago')
    expect(fmtRelativeTime(now - 300)).toBe('5m ago')
  })

  it('returns hours for timestamps hours ago', async () => {
    const { fmtRelativeTime } = await import('../src/pages/utils')
    const now = Math.floor(Date.now() / 1000)
    expect(fmtRelativeTime(now - 3600)).toBe('1h ago')
    expect(fmtRelativeTime(now - 7200)).toBe('2h ago')
  })

  it('returns days for timestamps days ago', async () => {
    const { fmtRelativeTime } = await import('../src/pages/utils')
    const now = Math.floor(Date.now() / 1000)
    expect(fmtRelativeTime(now - 86400)).toBe('1d ago')
    expect(fmtRelativeTime(now - 172800)).toBe('2d ago')
  })
})
