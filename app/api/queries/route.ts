import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export function GET() {
  return NextResponse.json(db().prepare('SELECT * FROM queries ORDER BY detected_at DESC').all())
}