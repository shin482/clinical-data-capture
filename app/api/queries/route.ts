import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export function GET() {
  return NextResponse.json(db().prepare("SELECT q.*, COALESCE(v.section, 'Other') AS form_name, COALESCE(v.label, q.variable_key) AS variable_name FROM queries q LEFT JOIN variable_definitions v ON v.variable_key=q.variable_key ORDER BY julianday(COALESCE(q.updated_at,q.resolved_at,q.detected_at)) DESC").all())
}