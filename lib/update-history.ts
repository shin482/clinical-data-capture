export const UPDATE_HISTORY_STATES = [
  'PENDING', 'RUNNING', 'BLOCKED', 'RECOVERY_REQUIRED',
  'FAILED_SAFE', 'COMPLETED', 'CANCELLED', 'UNKNOWN',
] as const

export type UpdateHistoryState = typeof UPDATE_HISTORY_STATES[number]
export type UpdateHistoryStage = {
  code: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'
  at: string | null
  errorCode: string | null
}
export type UpdateHistoryItem = {
  jobId: string
  installationId: string
  hospital: 'IJH' | 'EWH' | 'SCH'
  requestedAt: string
  previousVersion: string | null
  targetVersion: string
  state: UpdateHistoryState
  finishedAt: string | null
  errorCode: string | null
  manualReviewRequired: boolean
  stages: UpdateHistoryStage[]
}
export type UpdateHistoryPage = { page: number; pageSize: number; total: number; items: UpdateHistoryItem[] }

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const installationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][A-Za-z0-9.-]+)?$/
const safeCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/
const stageStatus = new Set(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'SKIPPED'])
const historyStates = new Set<string>(UPDATE_HISTORY_STATES)

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function date(value: unknown, nullable = false): string | null | undefined {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined
  return value
}
function optionalVersion(value: unknown) {
  return value === null ? null : typeof value === 'string' && versionPattern.test(value) ? value : undefined
}
function optionalCode(value: unknown) {
  return value === null ? null : typeof value === 'string' && safeCodePattern.test(value) ? value : undefined
}

export function parseUpdateHistoryItem(input: unknown): UpdateHistoryItem | null {
  const value = record(input)
  if (!value || typeof value.jobId !== 'string' || !idPattern.test(value.jobId)
    || typeof value.installationId !== 'string' || !installationPattern.test(value.installationId)
    || !['IJH', 'EWH', 'SCH'].includes(String(value.hospital))
    || typeof value.targetVersion !== 'string' || !versionPattern.test(value.targetVersion)
    || !historyStates.has(String(value.state)) || typeof value.manualReviewRequired !== 'boolean'
    || !Array.isArray(value.stages)) return null
  const requestedAt = date(value.requestedAt)
  const finishedAt = date(value.finishedAt, true)
  const previousVersion = optionalVersion(value.previousVersion)
  const errorCode = optionalCode(value.errorCode)
  if (requestedAt === undefined || finishedAt === undefined || previousVersion === undefined || errorCode === undefined) return null
  const stages: UpdateHistoryStage[] = []
  for (const entry of value.stages) {
    const stage = record(entry)
    if (!stage || typeof stage.code !== 'string' || !safeCodePattern.test(stage.code)
      || !stageStatus.has(String(stage.status))) return null
    const at = date(stage.at, true)
    const stageError = optionalCode(stage.errorCode)
    if (at === undefined || stageError === undefined) return null
    stages.push({ code: stage.code, status: stage.status as UpdateHistoryStage['status'], at, errorCode: stageError })
  }
  const completedVerified = value.finalVerificationVerified === true
  const requestedState = value.state as UpdateHistoryState
  return {
    jobId: value.jobId,
    installationId: value.installationId,
    hospital: value.hospital as UpdateHistoryItem['hospital'],
    requestedAt: requestedAt as string,
    previousVersion,
    targetVersion: value.targetVersion,
    state: requestedState === 'COMPLETED' && !completedVerified ? 'UNKNOWN' : requestedState,
    finishedAt,
    errorCode: requestedState === 'COMPLETED' && !completedVerified ? 'COMPLETION_EVIDENCE_MISSING' : errorCode,
    manualReviewRequired: requestedState === 'COMPLETED' && !completedVerified ? true : value.manualReviewRequired,
    stages,
  }
}

export function parseUpdateHistoryPage(input: unknown): UpdateHistoryPage | null {
  const value = record(input)
  if (!value || !Number.isInteger(value.page) || Number(value.page) < 1
    || !Number.isInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 25
    || !Number.isInteger(value.total) || Number(value.total) < 0 || !Array.isArray(value.items)) return null
  const items = value.items.map(parseUpdateHistoryItem)
  if (items.some((item) => !item)) return null
  return { page: Number(value.page), pageSize: Number(value.pageSize), total: Number(value.total), items: items as UpdateHistoryItem[] }
}
