import { createHash } from 'node:crypto'
import { parseUpdateHistoryItem } from './update-history.ts'

export function buildUpdateDiagnostic(input: unknown, generatedAt = new Date().toISOString()) {
  const item = parseUpdateHistoryItem(input)
  if (!item || !Number.isFinite(Date.parse(generatedAt))) return null
  const jobReference = `job-${createHash('sha256').update(item.jobId, 'utf8').digest('hex').slice(0, 16)}`
  return {
    diagnosticSchemaVersion: 1,
    hospital: item.hospital,
    jobReference,
    previousVersion: item.previousVersion,
    targetVersion: item.targetVersion,
    requestedAt: item.requestedAt,
    finishedAt: item.finishedAt,
    state: item.state,
    errorCode: item.errorCode,
    stages: item.stages.map(({ code, status, at, errorCode }) => ({ code, status, at, errorCode })),
    manualReviewRequired: item.manualReviewRequired,
    generatedAt,
  }
}
