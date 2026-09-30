import { NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-session.server'

export function GET(request: Request) { return NextResponse.json({ isAdmin: isAdminRequest(request) }) }
