import { configuredAdminPassword, isAdminRequest } from '@/lib/admin-session.server'
import { readCoordinatorHistoryJob } from '@/lib/update-coordinator-api.server.mts'
import { buildUpdateDiagnostic } from '@/lib/update-diagnostic.server.mts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const response = await readCoordinatorHistoryJob((await context.params).jobId, {
    expectedHospital: configuredAdminPassword().site,
    expectedInstallationId: process.env.EDC_INSTALLATION_ID?.trim(),
  })
  if (!response.ok) return response
  const report = buildUpdateDiagnostic(await response.json())
  if (!report) return Response.json({ error: 'HISTORY_CORRUPT' }, { status: 503 })
  return new Response(`${JSON.stringify(report, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="edc-update-diagnostic.json"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
