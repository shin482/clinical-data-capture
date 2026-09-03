import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export function GET() {
  try {
    const result = db().prepare('SELECT 1 AS ok').get() as { ok: number }
    return NextResponse.json({ connected: result.ok === 1 })
  } catch {
    return NextResponse.json({ connected: false }, { status: 503 })
  }
}