import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  try {
    const { password } = await request.json()
    const entered = String(password || '').trim()
    if (!entered) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    const settings = db().prepare("SELECT value FROM hospital_settings WHERE key='admin_password_hash'").get() as { value?: string } | undefined
    const hash = settings?.value || bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10)

    if (!settings) {
      db().prepare("INSERT OR REPLACE INTO hospital_settings(key, value) VALUES('admin_password_hash', ?)").run(hash)
    }

    const matches = await bcrypt.compare(entered, hash)
    if (!matches) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    return NextResponse.json({ ok: true, isAdmin: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to authenticate' }, { status: 500 })
  }
}
