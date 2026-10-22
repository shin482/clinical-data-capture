import { isAdminRequest } from '@/lib/admin-session.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  return Response.json({ error: 'LEGACY_UPDATE_DISABLED' }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
