import { NextRequest, NextResponse } from 'next/server'
import { db, ensureSubject, rowToVariable } from '@/lib/db'
import { missingReasons } from '@/lib/crf-metadata'
import type { Visit } from '@/lib/crf-metadata'
import { isCollectedAtVisit } from '@/lib/visit-rules'

export async function GET(_request: NextRequest, context: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await context.params
  const subject = db().prepare('SELECT * FROM subjects WHERE subject_id=?').get(subjectId) as { id: number } | undefined
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  const visits = db().prepare('SELECT id, timepoint, visit_date AS visitDate FROM visits WHERE subject_id=? ORDER BY timepoint').all(subject.id)
  const values = db().prepare('SELECT visit_id AS visitId, variable_key AS variableKey, value, missing_reason AS missingReason FROM clinical_values WHERE subject_id=?').all(subject.id)
  return NextResponse.json({ subject: { ...subject, subjectId }, visits, values })
}

export async function POST(request: NextRequest, context: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await context.params
  const body = await request.json() as { timepoint: string; variableKey: string; value: string | null; missingReason?: string | null; modifiedBy?: string }
  if (!['T1', 'T2', 'T3'].includes(body.timepoint) || typeof body.variableKey !== 'string' || (body.value !== null && typeof body.value !== 'string')) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  if (body.missingReason && !missingReasons.some((reason) => reason.code === body.missingReason)) return NextResponse.json({ error: 'Invalid missing reason' }, { status: 400 })
  if (body.missingReason && body.value) return NextResponse.json({ error: 'Value and missing reason conflict' }, { status: 400 })
  const missingReason = body.missingReason || null
  const storedValue = missingReason ? null : body.value || ''
  const variable = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=? AND enabled=1').get(body.variableKey) as Record<string, unknown> | undefined
  if (!variable) return NextResponse.json({ error: 'Variable is not enabled or does not exist' }, { status: 400 })
  if (!isCollectedAtVisit(rowToVariable(variable), body.timepoint as Visit)) return NextResponse.json({ error: 'Variable is not collected at this visit' }, { status: 400 })
  return db().transaction(() => {
  const subject = ensureSubject(subjectId)
  const visit = db().prepare('SELECT id FROM visits WHERE subject_id=? AND timepoint=?').get(subject.id, body.timepoint) as { id: number }
  const old = db().prepare('SELECT value, missing_reason FROM clinical_values WHERE visit_id=? AND variable_key=?').get(visit.id, body.variableKey) as { value: string | null; missing_reason: string | null } | undefined
  db().prepare(`INSERT INTO clinical_values (subject_id,visit_id,variable_key,value,missing_reason,modified_by) VALUES (?,?,?,?,?,?) ON CONFLICT(visit_id,variable_key) DO UPDATE SET value=excluded.value,missing_reason=excluded.missing_reason,modified_by=excluded.modified_by,modified_at=CURRENT_TIMESTAMP`).run(subject.id, visit.id, body.variableKey, storedValue, missingReason, body.modifiedBy || 'local-user')
  if ((old?.value || '') !== (storedValue || '') || (old?.missing_reason || null) !== missingReason) db().prepare('INSERT INTO audit_logs(subject_id,timepoint,variable_key,previous_value,new_value,modified_by) VALUES(?,?,?,?,?,?)').run(subjectId, body.timepoint, body.variableKey, JSON.stringify({ value: old?.value ?? null, missingReason: old?.missing_reason ?? null }), JSON.stringify({ value: storedValue, missingReason }), body.modifiedBy || 'local-user')
  if (body.variableKey === 'vdt') db().prepare('UPDATE visits SET visit_date=? WHERE id=?').run(storedValue || null, visit.id)
  const issues: { type: string; message: string }[] = []
  const value = (storedValue || '').trim()
  if (!value && !missingReason && !Boolean(variable.allow_blank)) issues.push({ type: 'MISSING', message: '필수 입력값입니다.' })
  if (value && variable.data_type === 'categorical') {
    const codes = String(variable.category_options || '').split('|').map((option) => option.split('=')[0].trim()).filter(Boolean)
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
  })()
}
