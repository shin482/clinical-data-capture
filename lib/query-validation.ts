import type Database from 'better-sqlite3'
import { getCurrentTimestamp } from './date-time'
import { isFieldActive } from './entry-rules'
import { rowToVariable } from './db'
import type { Visit } from './crf-metadata'
import { isCollectedAtVisit } from './visit-rules'
import { applicationWriterGate } from './db/writer-gate'

const visits: Visit[] = ['T1', 'T2', 'T3']
const managedTypes = ['MISSING', 'DATE_AFTER_VISIT', 'DIAGNOSIS_REGRESSION'] as const

export function isDiagnosisStatus(label: string) {
  return label.replace(/\s+/g, '').endsWith('\uC9C4\uB2E8\uC5EC\uBD80')
}

export function validateSubjectQueries(database: Database.Database, subjectId: string, onlyVisit?: Visit, includeMissing = false) {
  return applicationWriterGate.runWrite(() => {
  const subject = database.prepare('SELECT id FROM subjects WHERE subject_id=?').get(subjectId) as { id: number } | undefined
  if (!subject) return
  const definitions = database.prepare('SELECT * FROM variable_definitions WHERE study_active=1 AND enabled=1 ORDER BY display_order').all() as Record<string, unknown>[]
  const visitRows = database.prepare('SELECT id,timepoint,visit_date FROM visits WHERE subject_id=? ORDER BY timepoint').all(subject.id) as { id: number; timepoint: Visit; visit_date: string | null }[]
  const values = database.prepare('SELECT visit_id,variable_key,value,missing_reason FROM clinical_values WHERE subject_id=?').all(subject.id) as { visit_id: number; variable_key: string; value: string | null; missing_reason: string | null }[]
  const now = getCurrentTimestamp()
  const upsert = database.prepare(`INSERT INTO queries(subject_id,visit_id,timepoint,variable_key,query_type,message,current_value,detected_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_id,timepoint,variable_key,query_type) DO UPDATE SET message=excluded.message,current_value=excluded.current_value,status='OPEN',resolved_at=NULL,updated_at=excluded.updated_at`)
  const resolve = database.prepare("UPDATE queries SET status='RESOLVED',resolved_at=?,updated_at=? WHERE subject_id=? AND timepoint=? AND variable_key=? AND query_type=? AND status='OPEN'")

  for (const visit of visitRows) {
    if (onlyVisit && visit.timepoint !== onlyVisit) continue
    const visitValues = values.filter((item) => item.visit_id === visit.id)
    const valueOf = (key: string) => key === 'vdt' ? (visit.visit_date || visitValues.find((item) => item.variable_key === key)?.value) : visitValues.find((item) => item.variable_key === key)?.value
    for (const row of definitions) {
      const rule = rowToVariable(row)
      if (!isCollectedAtVisit(rule, visit.timepoint)) continue
      const stored = visitValues.find((item) => item.variable_key === rule.variableKey)
      const value = String(valueOf(rule.variableKey) || '').trim()
      const active = isFieldActive(rule, valueOf)
      const issues = new Map<string, string>()
      const checkMissing = includeMissing || rule.variableKey === 'vdt'
      if (checkMissing && active && !value && !stored?.missing_reason && !rule.allowBlank) issues.set('MISSING', '\uD544\uC218 \uC785\uB825\uAC12\uC785\uB2C8\uB2E4.')
      if (active && rule.dataType === 'datetime' && rule.variableKey !== 'vdt' && value && visit.visit_date && value > visit.visit_date) {
        issues.set('DATE_AFTER_VISIT', '\uBC29\uBB38\uC77C\uBCF4\uB2E4 \uC774\uD6C4 \uB0A0\uC9DC\uB97C \uC785\uB825\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.')
      }
      if (active && isDiagnosisStatus(rule.label) && value === '0') {
        const priorVisits = visits.slice(0, visits.indexOf(visit.timepoint))
        const diagnosedBefore = visitRows.some((prior) => priorVisits.includes(prior.timepoint) && values.some((item) => item.visit_id === prior.id && item.variable_key === rule.variableKey && item.value === '1'))
        if (diagnosedBefore) issues.set('DIAGNOSIS_REGRESSION', '\uACFC\uAC70 \uBC29\uBB38\uC5D0\uC11C \uC9C4\uB2E8\uBC1B\uC74C(1)\uC774 \uC785\uB825\uB418\uC5B4 \uC774\uD6C4 \uBC29\uBB38\uC5D0\uB294 \uC9C4\uB2E8\uBC1B\uC9C0\uC54A\uC74C(0)\uC744 \uC785\uB825\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.')
      }
      for (const type of managedTypes) {
        if (type === 'MISSING' && !checkMissing) continue
        const message = issues.get(type)
        if (message) upsert.run(subjectId, visit.id, visit.timepoint, rule.variableKey, type, message, value, now, now)
        else resolve.run(now, now, subjectId, visit.timepoint, rule.variableKey, type)
      }
    }
  }
  })
}

export function validateQueries(database: Database.Database, subjectId?: string | null, visit?: Visit | null, includeMissing = false) {
  const subjects = database.prepare(`SELECT subject_id FROM subjects ${subjectId ? 'WHERE subject_id=?' : ''}`).all(...(subjectId ? [subjectId] : [])) as { subject_id: string }[]
  return applicationWriterGate.runTransaction(database,
    () => subjects.forEach((subject) => validateSubjectQueries(database, subject.subject_id, visit || undefined, includeMissing)))
}
