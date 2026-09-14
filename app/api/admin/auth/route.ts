import { NextResponse } from 'next/server'
// Production environments should use server-side authentication/authorization.
// This endpoint only validates the local UI gate; it does not authorize API access.
export async function POST(request: Request) {
  const { password } = await request.json()
  return password === (process.env.ADMIN_PASSWORD || '123456')
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
}
