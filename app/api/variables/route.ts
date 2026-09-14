import { NextResponse } from 'next/server'
import { db, rowToVariable } from '@/lib/db'
import '@/lib/db/seed'

export function GET() {
  const rows = db().prepare('SELECT * FROM variable_definitions WHERE study_active=1 ORDER BY display_order').all() as Record<string, unknown>[]
  return NextResponse.json(rows.map(rowToVariable))
}

export async function POST() {
  return NextResponse.json({ error: 'The study uses the 71 variables defined in the authoritative Excel schema. Edit validation rules on existing variables.' }, { status: 409 })
}
