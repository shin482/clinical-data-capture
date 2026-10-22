import { isAdminRequest } from '@/lib/admin-session.server'
import { isSameOriginMutation, submitCoordinatorUpdate } from '@/lib/update-coordinator-api.server.mts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!isSameOriginMutation(request)) return Response.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  return submitCoordinatorUpdate(request)
}
