import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import '@/lib/db/seed'

export async function GET(request: NextRequest) {
  const subjectId = request.nextUrl.searchParams.get('subject')
  const subjects = db().prepare(`SELECT subject_id FROM subjects ${subjectId ? 'WHERE subject_id=?' : ''} ORDER BY subject_id`).all(...(subjectId ? [subjectId] : [])) as { subject_id: string }[]
  const variables = db().prepare('SELECT * FROM variable_definitions ORDER BY display_order').all() as Record<string, unknown>[]
  const valueRows = db().prepare(`SELECT s.subject_id, v.timepoint, c.variable_key, c.value FROM clinical_values c JOIN subjects s ON s.id=c.subject_id JOIN visits v ON v.id=c.visit_id ${subjectId ? 'WHERE s.subject_id=?' : ''}`).all(...(subjectId ? [subjectId] : [])) as { subject_id: string; timepoint: string; variable_key: string; value: string }[]
  const data = subjects.map((subject) => { const row: Record<string, string> = { SUBJECT_ID: subject.subject_id }; valueRows.filter((value) => value.subject_id === subject.subject_id).forEach((value) => { row[`${value.variable_key}_${value.timepoint.toLowerCase()}`] = value.value || '' }); return row })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), 'Data')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(db().prepare('SELECT * FROM queries').all()), 'Queries')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(variables), 'Variable Dictionary')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(db().prepare('SELECT * FROM audit_logs').all()), 'Audit Trail')
  const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(output, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="edc-export.xlsx"' } })
}