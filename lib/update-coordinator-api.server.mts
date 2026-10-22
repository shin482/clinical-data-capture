import { isStrictVersion, requestCoordinator, UpdateAgentUnavailableError } from './update-agent-client.server.mts'
import { parseUpdateHistoryItem, parseUpdateHistoryPage } from './update-history.ts'

type Dependencies = {
  requestCoordinator?: typeof requestCoordinator
  enabled?: boolean
  historyEnabled?: boolean
  expectedHospital?: 'IJH' | 'EWH' | 'SCH'
  expectedInstallationId?: string
}
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}

export function coordinatorFeatureEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.EDC_UPDATE_COORDINATOR_API_ENABLED === 'true'
}

export function coordinatorHistoryEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.EDC_UPDATE_HISTORY_ENABLED === 'true'
}

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).origin === new URL(request.url).origin } catch { return false }
}

function safeId(value: unknown) { return typeof value === 'string' && idPattern.test(value) }

function disabled() { return json({ error: 'OPERATING_MUTATION_DISABLED' }, 503) }

export async function submitCoordinatorUpdate(request: Request, dependencies: Dependencies = {}) {
  if (!(dependencies.enabled ?? coordinatorFeatureEnabled())) return disabled()
  let value: unknown
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > 4096) throw new Error()
    value = JSON.parse(text)
  } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'INVALID_REQUEST' }, 400)
  const body = value as Record<string, unknown>
  if (Object.keys(body).sort().join(',') !== 'requestId,version' || !safeId(body.requestId) || !isStrictVersion(body.version)) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  try {
    const result = await (dependencies.requestCoordinator || requestCoordinator)('/v1/coordinator/jobs/update', { method: 'POST', body })
    if (result.status !== 202 || result.body.durableAccepted !== true || !safeId(result.body.jobId)
      || result.body.requestId !== body.requestId || result.body.operatingMutationAuthorized !== true) {
      return json({ error: typeof result.body.error === 'string' ? result.body.error : 'COORDINATOR_NOT_READY' }, result.status === 409 ? 409 : 503)
    }
    return json({ status: 'accepted', jobId: result.body.jobId, requestId: body.requestId }, 202)
  } catch (error) {
    if (error instanceof UpdateAgentUnavailableError) return json({ error: 'AGENT_UNAVAILABLE' }, 503)
    return json({ error: 'COORDINATOR_NOT_READY' }, 503)
  }
}

export async function readCoordinatorResource(kind: 'jobs' | 'requests', id: string, dependencies: Dependencies = {}) {
  if (!(dependencies.enabled ?? coordinatorFeatureEnabled())) return disabled()
  if (!safeId(id)) return json({ error: 'INVALID_REQUEST' }, 400)
  try {
    const result = await (dependencies.requestCoordinator || requestCoordinator)(`/v1/coordinator/${kind}/${encodeURIComponent(id)}`)
    if (result.status !== 200) return json({ error: typeof result.body.error === 'string' ? result.body.error : 'COORDINATOR_UNAVAILABLE' }, result.status)
    if (dependencies.expectedHospital && result.body.hospital !== dependencies.expectedHospital) {
      return json({ error: 'IDENTITY_SCOPE_MISMATCH' }, 403)
    }
    return json(result.body, 200)
  } catch { return json({ error: 'AGENT_UNAVAILABLE' }, 503) }
}

export async function readCoordinatorRecovery(jobId: string, dependencies: Dependencies = {}) {
  if (!(dependencies.enabled ?? coordinatorFeatureEnabled())) return disabled()
  if (!safeId(jobId)) return json({ error: 'INVALID_REQUEST' }, 400)
  try {
    const result = await (dependencies.requestCoordinator || requestCoordinator)(`/v1/coordinator/jobs/${encodeURIComponent(jobId)}/recovery-assessment`)
    if (result.status !== 200) return json({ error: typeof result.body.error === 'string' ? result.body.error : 'COORDINATOR_UNAVAILABLE' }, result.status)
    if (dependencies.expectedHospital && result.body.hospital !== dependencies.expectedHospital) return json({ error: 'IDENTITY_SCOPE_MISMATCH' }, 403)
    return json(result.body, 200)
  } catch { return json({ error: 'AGENT_UNAVAILABLE' }, 503) }
}


function historyUnavailable() { return json({ error: 'HISTORY_UNAVAILABLE' }, 503) }

function validPage(value: number, maximum: number) {
  return Number.isInteger(value) && value >= 1 && value <= maximum
}

function historyScopeMatches(item: { hospital: string; installationId: string }, dependencies: Dependencies) {
  return (!dependencies.expectedHospital || item.hospital === dependencies.expectedHospital)
    && (!dependencies.expectedInstallationId || item.installationId === dependencies.expectedInstallationId)
}

export async function readCoordinatorHistory(page: number, pageSize: number, dependencies: Dependencies = {}) {
  if (!(dependencies.historyEnabled ?? coordinatorHistoryEnabled())) return historyUnavailable()
  if (!dependencies.expectedHospital || !dependencies.expectedInstallationId) return historyUnavailable()
  if (!validPage(page, 1000000) || !validPage(pageSize, 25)) return json({ error: 'INVALID_REQUEST' }, 400)
  try {
    const result = await (dependencies.requestCoordinator || requestCoordinator)(`/v1/coordinator/history?page=${page}&pageSize=${pageSize}`)
    if (result.status !== 200) {
      const error = result.body.error === 'HISTORY_UNAVAILABLE' ? 'HISTORY_UNAVAILABLE' : 'COORDINATOR_UNAVAILABLE'
      return json({ error }, result.status === 401 || result.status === 403 ? result.status : 503)
    }
    const history = parseUpdateHistoryPage(result.body)
    if (!history) return json({ error: 'HISTORY_CORRUPT' }, 503)
    if (history.items.some((item) => !historyScopeMatches(item, dependencies))) {
      return json({ error: 'IDENTITY_SCOPE_MISMATCH' }, 403)
    }
    history.items.sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt))
    return json(history, 200)
  } catch { return historyUnavailable() }
}

export async function readCoordinatorHistoryJob(jobId: string, dependencies: Dependencies = {}) {
  if (!(dependencies.historyEnabled ?? coordinatorHistoryEnabled())) return historyUnavailable()
  if (!dependencies.expectedHospital || !dependencies.expectedInstallationId) return historyUnavailable()
  if (!safeId(jobId)) return json({ error: 'INVALID_REQUEST' }, 400)
  try {
    const result = await (dependencies.requestCoordinator || requestCoordinator)(`/v1/coordinator/history/${encodeURIComponent(jobId)}`)
    if (result.status !== 200) {
      const error = result.body.error === 'JOB_NOT_FOUND' ? 'JOB_NOT_FOUND'
        : result.body.error === 'HISTORY_UNAVAILABLE' ? 'HISTORY_UNAVAILABLE' : 'COORDINATOR_UNAVAILABLE'
      return json({ error }, result.status === 404 ? 404 : 503)
    }
    const item = parseUpdateHistoryItem(result.body)
    if (!item) return json({ error: 'HISTORY_CORRUPT' }, 503)
    if (!historyScopeMatches(item, dependencies)) return json({ error: 'IDENTITY_SCOPE_MISMATCH' }, 403)
    return json(item, 200)
  } catch { return historyUnavailable() }
}
