import { NextResponse } from 'next/server'
import { appConfig } from '@/lib/app-config'
import { getSiteCode, type SiteCode } from '@/lib/site-config'

const sitePasswords: Record<SiteCode, string> = {
  IJH: '202509021',
  EWH: '202601040',
  SCH: '202509006',
}
// Production environments should use server-side authentication/authorization.
// This endpoint only validates the local UI gate; it does not authorize API access.
export async function POST(request: Request) {
  const { password } = await request.json()
  const site = getSiteCode(process.env.EDC_SITE || appConfig.site)
  const configuredPassword = process.env[`ADMIN_PASSWORD_${site}`] || sitePasswords[site]
  return password === configuredPassword
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
}
