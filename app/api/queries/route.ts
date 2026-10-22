import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { queryHistoryForm } from '@/lib/query-history'
import { validateQueries } from '@/lib/query-validation'
import type { NextRequest } from 'next/server'

export function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('validate') === '1') {
    const visit = request.nextUrl.searchParams.get('visit')
    validateQueries(db(), request.nextUrl.searchParams.get('subject'), visit === 'T1' || visit === 'T2' || visit === 'T3' ? visit : null, true)
  }
  const rows = db().prepare("SELECT q.*, v.section, COALESCE(v.label, q.variable_key) AS variable_name FROM queries q LEFT JOIN variable_definitions v ON v.variable_key=q.variable_key ORDER BY julianday(COALESCE(q.updated_at,q.resolved_at,q.detected_at)) DESC").all() as Record<string, unknown>[]
  return NextResponse.json(rows.map(({ section, ...row }) => ({ ...row, form_name: queryHistoryForm(section as string | null) })))
}
