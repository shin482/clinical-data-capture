import { NextResponse } from 'next/server'
import { db, rowToVariable } from '@/lib/db'
import '@/lib/db/seed'

export function GET() {
  const rows = db().prepare('SELECT * FROM variable_definitions ORDER BY display_order').all() as Record<string, unknown>[]
  return NextResponse.json(rows.map(rowToVariable))
}