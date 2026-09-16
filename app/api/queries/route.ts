import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { queryHistoryForm } from '@/lib/query-history'

export function GET() {
  const rows = db().prepare("SELECT q.*, v.section, COALESCE(v.label, q.variable_key) AS variable_name FROM queries q LEFT JOIN variable_definitions v ON v.variable_key=q.variable_key ORDER BY julianday(COALESCE(q.updated_at,q.resolved_at,q.detected_at)) DESC").all() as Record<string, unknown>[]
  return NextResponse.json(rows.map(({ section, ...row }) => ({ ...row, form_name: queryHistoryForm(section as string | null) })))
}
