import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { canonicalVariableKey, legacyVariableAliases } from '@/lib/study-schema'

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const where: string[] = []
  const values: unknown[] = []

  const subjectId = params.get('subjectId')?.trim()
  const visit = params.get('visit')?.trim()
  const variable = params.get('variable')?.trim()
  const action = params.get('action')?.trim()
  const from = params.get('from')?.trim()
  const to = params.get('to')?.trim()

  if (subjectId) {
    where.push('subject_id = ?')
    values.push(subjectId)
  }
  if (visit) {
    where.push('timepoint = ?')
    values.push(visit)
  }
  if (variable) {
    const canonical = canonicalVariableKey(variable)
    const aliases = Object.keys(legacyVariableAliases).filter((key) => legacyVariableAliases[key] === canonical)
    const terms = [...new Set([variable, canonical, ...aliases])]
    where.push(`(${terms.map(() => 'variable_key LIKE ?').join(' OR ')})`)
    values.push(...terms.map((term) => `%${term}%`))
  }
  if (action) {
    where.push('action = ?')
    values.push(action)
  }
  if (from) {
    where.push('DATE(modified_at) >= DATE(?)')
    values.push(from)
  }
  if (to) {
    where.push('DATE(modified_at) <= DATE(?)')
    values.push(to)
  }

  const query = `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY modified_at DESC`
  const rows = db().prepare(query).all(...values)

  return NextResponse.json(rows)
}
