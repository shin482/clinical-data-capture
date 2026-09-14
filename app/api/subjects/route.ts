import { sortSubjectsNumerically } from '@/lib/clinical-utils'
import { NextRequest, NextResponse } from 'next/server'
import { db, ensureSubject } from '@/lib/db'

export function GET() {
  const rows = db().prepare(`SELECT s.subject_id, s.updated_at, COUNT(q.id) AS open_queries FROM subjects s LEFT JOIN queries q ON q.subject_id=s.subject_id AND q.status='OPEN' GROUP BY s.id ORDER BY s.updated_at DESC`).all()
  return NextResponse.json(sortSubjectsNumerically(rows as { subject_id: string }[]))
}

export async function POST(request: NextRequest) {
  try { const body = await request.json(); return NextResponse.json(ensureSubject(String(body.subjectId || '')), { status: 201 }) } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create subject' }, { status: 400 }) }
}