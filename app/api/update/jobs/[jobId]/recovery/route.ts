import { configuredAdminPassword, isAdminRequest } from '@/lib/admin-session.server'
import { readCoordinatorRecovery } from '@/lib/update-coordinator-api.server.mts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  return readCoordinatorRecovery((await context.params).jobId, { expectedHospital: configuredAdminPassword().site })
}
