import { NextResponse } from 'next/server'
import { appConfig } from '@/lib/app-config'

export function GET() {
  return NextResponse.json({
    version: appConfig.version,
    site: process.env.EDC_SITE || appConfig.site,
  })
}
