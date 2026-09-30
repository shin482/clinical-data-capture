import { handleUpdateRequest } from '@/lib/update-api.server.mts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleUpdateRequest(request)
}
