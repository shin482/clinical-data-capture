import { sortSubjectsNumerically } from '@/lib/clinical-utils'
import { NextRequest, NextResponse } from 'next/server'
import { createSubject, db, rowToVariable } from '@/lib/db'
import { completionVisits, getSubjectVisitProgress, type EntryValue } from '@/lib/data-entry'
import type { Visit } from '@/lib/crf-metadata'

export function GET() {
  const rows = db().prepare(`SELECT s.subject_id, s.updated_at, COUNT(q.id) AS open_queries FROM subjects s LEFT JOIN queries q ON q.subject_id=s.subject_id AND q.status='OPEN' GROUP BY s.id`).all() as { subject_id: string; updated_at: string; open_queries: number }[]
  const rules = (db().prepare('SELECT * FROM variable_definitions WHERE study_active=1').all() as Record<string, unknown>[]).map(rowToVariable)
  const visits = db().prepare('SELECT v.id, s.subject_id, v.timepoint FROM visits v JOIN subjects s ON s.id=v.subject_id').all() as { id: number; subject_id: string; timepoint: Visit }[]
  const entries = db().prepare('SELECT visit_id, variable_key AS variableKey, value, missing_reason AS missingReason FROM clinical_values').all() as (EntryValue & { visit_id: number })[]
  const byVisit = new Map<number, EntryValue[]>()
  for (const entry of entries) {
    const list = byVisit.get(entry.visit_id) || []
    list.push(entry)
    byVisit.set(entry.visit_id, list)
  }
  const visitIds = new Map(visits.map((visit) => [JSON.stringify([visit.subject_id, visit.timepoint]), visit.id]))
  return NextResponse.json(sortSubjectsNumerically(rows).map((subject) => {
    const progress = completionVisits.map((visit) => {
      const id = visitIds.get(JSON.stringify([subject.subject_id, visit]))
      const stats = getSubjectVisitProgress(subject.subject_id, visit, rules, byVisit.get(id!) || [])
      return { visit, ...stats, complete: id !== undefined && stats.complete }
    })
    return {
      ...subject,
      visit_completion: Object.fromEntries(progress.map((stats) => [stats.visit, stats.complete])),
      visit_progress: Object.fromEntries(progress.map(({ visit, ...stats }) => [visit, stats])),
    }
  }))
}

export async function POST(request: NextRequest) {
  try { const body = await request.json(); return NextResponse.json(createSubject(String(body.subjectId || '')), { status: 201 }) } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create subject'
    return NextResponse.json({ error: message }, { status: message.includes('이미 등록된') ? 409 : 400 })
  }
}
