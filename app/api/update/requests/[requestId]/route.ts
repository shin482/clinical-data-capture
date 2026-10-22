import { isAdminRequest } from '@/lib/admin-session.server'
import { configuredAdminPassword } from '@/lib/admin-session.server'
import { readCoordinatorResource } from '@/lib/update-coordinator-api.server.mts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  return readCoordinatorResource('requests', (await context.params).requestId, { expectedHospital: configuredAdminPassword().site })
}
