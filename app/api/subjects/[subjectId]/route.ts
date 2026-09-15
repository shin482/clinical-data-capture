import { derivedValues, isDerivedField, isFieldActive } from '@/lib/entry-rules'
import { getCurrentTimestamp } from '@/lib/date-time'
import { NextRequest, NextResponse } from 'next/server'
import { db, ensureSubject, rowToVariable } from '@/lib/db'
import { missingReasons } from '@/lib/crf-metadata'
import type { Visit } from '@/lib/crf-metadata'
import { isCollectedAtVisit } from '@/lib/visit-rules'

export async function GET(_request: NextRequest, context: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await context.params
  const subject = db().prepare('SELECT * FROM subjects WHERE subject_id=?').get(subjectId) as { id: number } | undefined
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  const visits = db().prepare('SELECT id, timepoint, visit_date AS visitDate FROM visits WHERE subject_id=? ORDER BY timepoint').all(subject.id) as { id: number; timepoint: string; visitDate: string | null }[]
  const values = db().prepare('SELECT visit_id AS visitId, variable_key AS variableKey, value, missing_reason AS missingReason FROM clinical_values WHERE subject_id=?').all(subject.id) as { visitId: number; variableKey: string; value: string | null; missingReason: string | null }[]
  for (const visit of visits) {
    for (const [key, value] of Object.entries(derivedValues((key) => values.find((v) => v.visitId === visit.id && v.variableKey === key)?.value))) {
      const existing = values.find((v) => v.visitId === visit.id && v.variableKey === key)
      if (existing) { existing.value = value; existing.missingReason = null }
      else values.push({ visitId: visit.id, variableKey: key, value, missingReason: null })
    }
  }
  const last = db().prepare('SELECT modified_at FROM clinical_values WHERE subject_id=? ORDER BY julianday(modified_at) DESC LIMIT 1').get(subject.id) as { modified_at: string } | undefined
  return NextResponse.json({ subject: { ...subject, subjectId }, visits, values, savedAt: last?.modified_at || null })
}

export async function POST(request: NextRequest, context: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await context.params
  const body = await request.json() as { timepoint: string; variableKey: string; value: string | null; missingReason?: string | null; modifiedBy?: string }
  if (!['T1', 'T2', 'T3'].includes(body.timepoint) || typeof body.variableKey !== 'string' || (body.value !== null && typeof body.value !== 'string')) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  if (body.missingReason && !missingReasons.some((reason) => reason.code === body.missingReason)) return NextResponse.json({ error: 'Invalid missing reason' }, { status: 400 })
  if (body.missingReason && body.value) return NextResponse.json({ error: 'Value and missing reason conflict' }, { status: 400 })
  if (isDerivedField(body.variableKey)) return NextResponse.json({ error: 'Calculated field is read-only' }, { status: 400 })
  const missingReason = body.missingReason || null
  const storedValue = missingReason ? null : body.value || ''
  const variable = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=? AND enabled=1 AND study_active=1').get(body.variableKey) as Record<string, unknown> | undefined
  if (!variable) return NextResponse.json({ error: 'Variable is not enabled or does not exist' }, { status: 400 })
  if (!isCollectedAtVisit(rowToVariable(variable), body.timepoint as Visit)) return NextResponse.json({ error: 'Variable is not collected at this visit' }, { status: 400 })
  return db().transaction(() => {
  const savedAt = getCurrentTimestamp()
  const subject = ensureSubject(subjectId)
  const visit = db().prepare('SELECT id FROM visits WHERE subject_id=? AND timepoint=?').get(subject.id, body.timepoint) as { id: number }
  const old = db().prepare('SELECT value, missing_reason FROM clinical_values WHERE visit_id=? AND variable_key=?').get(visit.id, body.variableKey) as { value: string | null; missing_reason: string | null } | undefined
  db().prepare(`INSERT INTO clinical_values (subject_id,visit_id,variable_key,value,missing_reason,modified_by,modified_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(visit_id,variable_key) DO UPDATE SET value=excluded.value,missing_reason=excluded.missing_reason,modified_by=excluded.modified_by,modified_at=excluded.modified_at`).run(subject.id, visit.id, body.variableKey, storedValue, missingReason, body.modifiedBy || 'local-user', savedAt)
  if ((old?.value || '') !== (storedValue || '') || (old?.missing_reason || null) !== missingReason) db().prepare('INSERT INTO audit_logs(subject_id,timepoint,variable_key,previous_value,new_value,modified_by,modified_at) VALUES(?,?,?,?,?,?,?)').run(subjectId, body.timepoint, body.variableKey, JSON.stringify({ value: old?.value ?? null, missingReason: old?.missing_reason ?? null }), JSON.stringify({ value: storedValue, missingReason }), body.modifiedBy || 'local-user', savedAt)
  if (body.variableKey === 'vdt') db().prepare('UPDATE visits SET visit_date=? WHERE id=?').run(storedValue || null, visit.id)
  const visitValues = db().prepare('SELECT variable_key,value FROM clinical_values WHERE visit_id=?').all(visit.id) as { variable_key: string; value: string | null }[]
  const valueOf = (key: string) => visitValues.find((v) => v.variable_key === key)?.value
  for (const [key, calculated] of Object.entries(derivedValues(valueOf))) {
    const definition = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=? AND study_active=1').get(key) as Record<string, unknown> | undefined
    if (!definition || !isCollectedAtVisit(rowToVariable(definition), body.timepoint as Visit)) continue
    const previous = valueOf(key)
    if ((previous ?? '') === calculated) continue
    db().prepare(`INSERT INTO clinical_values(subject_id,visit_id,variable_key,value,modified_by,modified_at) VALUES(?,?,?,?,?,?) ON CONFLICT(visit_id,variable_key) DO UPDATE SET value=excluded.value,missing_reason=NULL,modified_by=excluded.modified_by,modified_at=excluded.modified_at`).run(subject.id, visit.id, key, calculated, body.modifiedBy || 'local-user', savedAt)
    db().prepare('INSERT INTO audit_logs(subject_id,timepoint,variable_key,previous_value,new_value,modified_by,modified_at) VALUES(?,?,?,?,?,?,?)').run(subjectId, body.timepoint, key, previous ?? null, calculated, body.modifiedBy || 'local-user', savedAt)
    db().prepare("UPDATE queries SET status='RESOLVED',resolved_at=?,updated_at=? WHERE subject_id=? AND timepoint=? AND variable_key=? AND status='OPEN'").run(savedAt, savedAt, subjectId, body.timepoint, key)
  }
  const active = isFieldActive(rowToVariable(variable), valueOf)
  const issues: { type: string; message: string }[] = []
  const value = (storedValue || '').trim()
  if (active && !value && !missingReason && !Boolean(variable.allow_blank)) issues.push({ type: 'MISSING', message: '필수 입력값입니다.' })
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
  db().prepare('UPDATE subjects SET updated_at=? WHERE id=?').run(savedAt, subject.id)
  const resolve = db().prepare(`UPDATE queries SET status='RESOLVED', resolved_at=?, updated_at=?, current_value=? WHERE subject_id=? AND timepoint=? AND variable_key=? AND status='OPEN'`)
  resolve.run(savedAt, savedAt, value, subjectId, body.timepoint, body.variableKey)
  const upsert = db().prepare(`INSERT INTO queries(subject_id,visit_id,timepoint,variable_key,query_type,message,current_value,detected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_id,timepoint,variable_key,query_type) DO UPDATE SET message=excluded.message,current_value=excluded.current_value,status='OPEN',resolved_at=NULL,updated_at=excluded.updated_at`)
  issues.forEach((issue) => upsert.run(subjectId, visit.id, body.timepoint, body.variableKey, issue.type, issue.message, value, savedAt, savedAt))
  return NextResponse.json({ ok: true, savedAt })
  })()
}
