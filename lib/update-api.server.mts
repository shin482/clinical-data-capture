import {
  getUpdateCheck,
  isStrictVersion,
  requestUpdate,
  UpdateAgentAuthenticationError,
  UpdateAgentUnavailableError,
  UpdateAlreadyInProgressError,
  type UpdateCheck,
  type UpdateResult,
} from './update-agent-client.server.mts'

type Dependencies = {
  getUpdateCheck?: () => Promise<UpdateCheck>
  requestUpdate?: (version: string) => Promise<UpdateResult>
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function handleUpdateRequest(request: Request, dependencies: Dependencies = {}) {
  let body: unknown
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > 4096) throw new Error()
    body = JSON.parse(text)
  } catch {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  const candidate = body as Record<string, unknown>
  if (Object.keys(candidate).length !== 1 || !Object.hasOwn(candidate, 'version')) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  if (!isStrictVersion(candidate.version)) {
    return json({ error: 'INVALID_VERSION' }, 400)
  }

  const checkUpdate = dependencies.getUpdateCheck || getUpdateCheck
  const sendUpdate = dependencies.requestUpdate || requestUpdate
  try {
    const status = await checkUpdate()
    if (!status.updateAvailable) {
      return json({ error: 'VERSION_NOT_NEWER' }, 409)
    }
    if (candidate.version !== status.latestVersion) {
      return json({ error: 'VERSION_MISMATCH' }, 409)
    }

    const result = await sendUpdate(candidate.version)
    if (result.status === 'not_updated') {
      return json({ error: 'VERSION_NOT_NEWER' }, 409)
    }
    return json({ status: 'update_started', version: result.version }, 202)
  } catch (error) {
    if (error instanceof UpdateAgentAuthenticationError) {
      return json({ error: 'AGENT_AUTHENTICATION_FAILED' }, 502)
    }
    if (error instanceof UpdateAlreadyInProgressError) {
      return json({ error: 'UPDATE_IN_PROGRESS' }, 409)
    }
    if (error instanceof UpdateAgentUnavailableError) {
      return json({ error: 'AGENT_UNAVAILABLE' }, 503)
    }
    return json({ error: 'UPDATE_FAILED' }, 500)
  }
}
