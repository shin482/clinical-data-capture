import { NextResponse } from 'next/server'
import { getUpdateCheck } from '@/lib/update-agent-client.server.mts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const status = await getUpdateCheck()
    return NextResponse.json(status)
  } catch {
    return NextResponse.json({ error: 'Update Agent unavailable' }, { status: 503 })
  }
}
