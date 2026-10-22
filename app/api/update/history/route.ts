import { configuredAdminPassword, isAdminRequest } from '@/lib/admin-session.server'
import { readCoordinatorHistory } from '@/lib/update-coordinator-api.server.mts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const url = new URL(request.url)
  const page = Number(url.searchParams.get('page') || '1')
  const pageSize = Number(url.searchParams.get('pageSize') || '5')
  return readCoordinatorHistory(page, pageSize, {
    expectedHospital: configuredAdminPassword().site,
    expectedInstallationId: process.env.EDC_INSTALLATION_ID?.trim(),
  })
}
