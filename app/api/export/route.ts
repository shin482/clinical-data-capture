import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import { sortSubjectsNumerically } from '@/lib/clinical-utils'
import '@/lib/db/seed'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  if (params.get('history') === '1') return NextResponse.json(db().prepare('SELECT * FROM export_history ORDER BY id DESC').all())
  const subjectId = params.get('subject')
  const visit = params.get('visit')
  if (visit && !['T1', 'T2', 'T3'].includes(visit)) return NextResponse.json({ error: 'Invalid visit' }, { status: 400 })
  const subjects = sortSubjectsNumerically(db().prepare(`SELECT subject_id FROM subjects ${subjectId ? 'WHERE subject_id=?' : ''}`).all(...(subjectId ? [subjectId] : [])) as { subject_id: string }[])
  if (subjectId && !subjects.length) return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  const where = [subjectId ? 's.subject_id=?' : '', visit ? 'v.timepoint=?' : ''].filter(Boolean)
  const args = [...(subjectId ? [subjectId] : []), ...(visit ? [visit] : [])]
  const valueRows = db().prepare(`SELECT s.subject_id, v.timepoint, c.variable_key, c.value, c.missing_reason FROM clinical_values c JOIN subjects s ON s.id=c.subject_id JOIN visits v ON v.id=c.visit_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).all(...args) as { subject_id: string; timepoint: string; variable_key: string; value: string; missing_reason: string | null }[]
  const data = subjects.map((subject) => {
    const row: Record<string, string> = { SUBJECT_ID: subject.subject_id }
    valueRows.filter((v) => v.subject_id === subject.subject_id).forEach((v) => {
      const key = `${v.variable_key}_${v.timepoint.toLowerCase()}`
      row[key] = v.value || ''
      if (v.missing_reason) row[`${key}_missing_reason`] = v.missing_reason
    })
    return row
  })
  const scopedWhere = [subjectId ? 'subject_id=?' : '', visit ? 'timepoint=?' : ''].filter(Boolean)
  const scope = scopedWhere.length ? ' WHERE ' + scopedWhere.join(' AND ') : ''
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), 'Data')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(db().prepare('SELECT * FROM queries' + scope).all(...args)), 'Queries')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(db().prepare('SELECT * FROM variable_definitions ORDER BY display_order').all()), 'Variable Dictionary')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(db().prepare('SELECT * FROM audit_logs' + scope).all(...args)), 'Audit Trail')
  const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const filename = `${subjectId ? 'subject_' + subjectId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'all_subjects'}_${visit || 'all_visits'}.xlsx`
  db().transaction(() => {
    db().prepare('INSERT INTO export_history(user_name,subject_id,visit,file_name) VALUES(?,?,?,?)').run('Minji Jung', subjectId, visit, filename)
    db().prepare("INSERT INTO audit_logs(subject_id,timepoint,new_value,modified_by,action) VALUES(?,?,?,?, 'EXPORT')").run(subjectId, visit, filename, 'Minji Jung')
  })()
  return new NextResponse(output, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } })
}
