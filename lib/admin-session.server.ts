import { createHmac, timingSafeEqual } from 'node:crypto'
import { appConfig } from '@/lib/app-config'
import { ADMIN_AUTH_TTL_MS } from '@/lib/admin-auth-config'
import { getSiteCode } from '@/lib/site-config'

export const ADMIN_SESSION_COOKIE = 'edc_admin_session'

export function configuredAdminPassword() {
  const site = getSiteCode(process.env.EDC_SITE || appConfig.site)
  const password = process.env[`ADMIN_PASSWORD_${site}`]?.trim() || null
  return { site, password }
}

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createAdminSession(now = Date.now()) {
  const { site, password } = configuredAdminPassword()
  if (!password) throw new Error(`ADMIN_PASSWORD_${site} is required`)
  const payload = Buffer.from(JSON.stringify({ site, expiresAt: now + ADMIN_AUTH_TTL_MS })).toString('base64url')
  return `${payload}.${signature(payload, password)}`
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get('cookie') || ''
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

export function isAdminRequest(request: Request, now = Date.now()) {
  const token = cookieValue(request, ADMIN_SESSION_COOKIE)
  if (!token) return false
  const separator = token.lastIndexOf('.')
  if (separator < 1) return false
  const payload = token.slice(0, separator)
  const actual = Buffer.from(token.slice(separator + 1))
  const { site, password } = configuredAdminPassword()
  if (!password) return false
  const expected = Buffer.from(signature(payload, password))
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { site?: string; expiresAt?: number }
    return session.site === site && typeof session.expiresAt === 'number' && session.expiresAt > now && session.expiresAt <= now + ADMIN_AUTH_TTL_MS
  } catch {
    return false
  }
}
