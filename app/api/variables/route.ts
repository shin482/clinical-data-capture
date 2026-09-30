import { NextRequest, NextResponse } from 'next/server'
import { db, rowToVariable } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-session.server'

export function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('admin') === '1' && !isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = db().prepare('SELECT * FROM variable_definitions WHERE study_active=1 ORDER BY display_order').all() as Record<string, unknown>[]
  return NextResponse.json(rows.map(rowToVariable))
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ error: 'The study uses the 71 variables defined in the authoritative Excel schema. Edit validation rules on existing variables.' }, { status: 409 })
}
