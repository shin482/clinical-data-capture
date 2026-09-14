import { NextResponse } from 'next/server'
// A configured password is not an authenticated session. UI access uses sessionStorage.
export function GET() { return NextResponse.json({ isAdmin: false }) }
