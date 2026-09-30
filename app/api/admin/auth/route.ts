import { NextResponse } from 'next/server'
import { ADMIN_AUTH_TTL_MS } from '@/lib/admin-auth-config'
import { ADMIN_SESSION_COOKIE, configuredAdminPassword, createAdminSession } from '@/lib/admin-session.server'

export async function POST(request: Request) {
  const { password } = await request.json()
  const { site, password: configuredPassword } = configuredAdminPassword()
  if (!configuredPassword) return NextResponse.json({ error: `ADMIN_PASSWORD_${site} is not configured` }, { status: 503 })
  if (password !== configuredPassword) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSession(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: Math.floor(ADMIN_AUTH_TTL_MS / 1000),
  })
  return response
}
