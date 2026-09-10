import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const settings = db().prepare("SELECT value FROM hospital_settings WHERE key='admin_password_hash'").get() as { value?: string } | undefined
  return NextResponse.json({ isAdmin: Boolean(settings?.value) })
}
