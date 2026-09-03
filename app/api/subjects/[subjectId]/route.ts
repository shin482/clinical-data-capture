import { NextRequest, NextResponse } from 'next/server'
import { db, ensureSubject } from '@/lib/db'

export async function GET(_request: NextRequest, context: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await context.params
  const subject = db().prepare('SELECT * FROM subjects WHERE subject_id=?').get(subjectId) as { id: number } | undefined
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  const visits = db().prepare('SELECT id, timepoint, visit_date AS visitDate FROM visits WHERE subject_id=? ORDER BY timepoint').all(subject.id)
  const values = db().prepare('SELECT visit_id AS visitId, variable_key AS variableKey, value FROM clinical_values WHERE subject_id=?').all(subject.id)
  return NextResponse.json({ subject: { ...subject, subjectId }, visits, values })
}

export async function POST(request: NextRequest, context: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await context.params
  const body = await request.json() as { timepoint: string; variableKey: string; value: string; modifiedBy?: string }
  const subject = ensureSubject(subjectId)
  const visit = db().prepare('SELECT id FROM visits WHERE subject_id=? AND timepoint=?').get(subject.id, body.timepoint) as { id: number }
  const variable = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=? AND enabled=1').get(body.variableKey) as Record<string, unknown> | undefined
  if (!variable) return NextResponse.json({ error: 'Variable is not enabled or does not exist' }, { status: 400 })
  const old = db().prepare('SELECT value FROM clinical_values WHERE visit_id=? AND variable_key=?').get(visit.id, body.variableKey) as { value: string } | undefined
  db().prepare(`INSERT INTO clinical_values (subject_id,visit_id,variable_key,value,modified_by) VALUES (?,?,?,?,?) ON CONFLICT(visit_id,variable_key) DO UPDATE SET value=excluded.value,modified_by=excluded.modified_by,modified_at=CURRENT_TIMESTAMP`).run(subject.id, visit.id, body.variableKey, body.value, body.modifiedBy || 'local-user')
  if ((old?.value || '') !== body.value) db().prepare('INSERT INTO audit_logs(subject_id,timepoint,variable_key,previous_value,new_value,modified_by) VALUES(?,?,?,?,?,?)').run(subjectId, body.timepoint, body.variableKey, old?.value || '', body.value, body.modifiedBy || 'local-user')
  if (body.variableKey === 'vdt') db().prepare('UPDATE visits SET visit_date=? WHERE id=?').run(body.value || null, visit.id)
  const issues: { type: string; message: string }[] = []
  const value = body.value.trim()
  if (!value && !Boolean(variable.allow_blank)) issues.push({ type: 'MISSING', message: '필수 입력값입니다.' })
  if (value && variable.data_type === 'categorical') {
    const codes = String(variable.category_options || '').split('|').map((option) => option.split('=')[0]).filter(Boolean)
    if (!codes.includes(value) && !(value === '99' && Boolean(variable.allow_unknown_99))) issues.push({ type: 'CATEGORY', message: '허용되지 않은 Category 값입니다.' })
  }
  if (value && variable.data_type === 'integer' && !/^-?\d+$/.test(value)) issues.push({ type: 'INTEGER', message: '정수만 입력할 수 있습니다.' })
  if (value && (variable.data_type === 'integer' || variable.data_type === 'real' || variable.data_type === 'character') && variable.min_value != null) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) issues.push({ type: 'NUMERIC', message: '숫자로 해석할 수 없는 값입니다.' })
    else if (numeric < Number(variable.min_value) || (variable.max_value != null && numeric > Number(variable.max_value))) issues.push({ type: 'RANGE', message: `${variable.min_value}~${variable.max_value} 범위를 벗어났습니다.` })
  }
  const resolve = db().prepare(`UPDATE queries SET status='RESOLVED', resolved_at=CURRENT_TIMESTAMP, current_value=? WHERE subject_id=? AND timepoint=? AND variable_key=? AND status='OPEN'`)
  resolve.run(value, subjectId, body.timepoint, body.variableKey)
  const upsert = db().prepare(`INSERT INTO queries(subject_id,visit_id,timepoint,variable_key,query_type,message,current_value) VALUES(?,?,?,?,?,?,?) ON CONFLICT(subject_id,timepoint,variable_key,query_type) DO UPDATE SET message=excluded.message,current_value=excluded.current_value,status='OPEN',resolved_at=NULL`)
  issues.forEach((issue) => upsert.run(subjectId, visit.id, body.timepoint, body.variableKey, issue.type, issue.message, value))
  return NextResponse.json({ ok: true })
}