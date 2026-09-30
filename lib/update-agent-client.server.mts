import { clearTimeout, setTimeout } from 'node:timers'

export type UpdateAgentStatus = {
  installedVersion: string
  containerName: string
  image: string
  volume: string
  port: number
}

export type UpdateCheck = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
}

export type UpdateResult =
  | { status: 'updated'; previousVersion: string; version: string }
  | {
    status: 'not_updated'
    reason: 'VERSION_NOT_NEWER'
    currentVersion: string
    requestedVersion: string
  }

type ClientOptions = {
  environment?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class UpdateAgentUnavailableError extends Error {
  constructor() {
    super('Update Agent unavailable')
    this.name = 'UpdateAgentUnavailableError'
  }
}

export class UpdateAgentAuthenticationError extends Error {
  constructor() {
    super('Update Agent authentication failed')
    this.name = 'UpdateAgentAuthenticationError'
  }
}

export class UpdateAlreadyInProgressError extends Error {
  constructor() {
    super('Update already in progress')
    this.name = 'UpdateAlreadyInProgressError'
  }
}

function loadConnection(environment: NodeJS.ProcessEnv) {
  const rawUrl = environment.UPDATE_AGENT_URL?.trim()
  const authToken = environment.UPDATE_AGENT_AUTH_TOKEN?.trim()
  if (!rawUrl || !authToken || authToken.length < 32) throw new UpdateAgentUnavailableError()

  let baseUrl: URL
  try {
    baseUrl = new URL(rawUrl)
  } catch {
    throw new UpdateAgentUnavailableError()
  }

  const allowedHost = baseUrl.hostname === '127.0.0.1' || baseUrl.hostname === 'host.docker.internal'
  if (baseUrl.protocol !== 'http:'
    || !allowedHost
    || (baseUrl.pathname !== '/' && baseUrl.pathname !== '')
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash) {
    throw new UpdateAgentUnavailableError()
  }

  return { baseUrl, authToken }
}

async function requestAgent(path: '/status' | '/update/check', options: ClientOptions = {}) {
  const { baseUrl, authToken } = loadConnection(options.environment || process.env)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 5000)

  try {
    const response = await (options.fetchImpl || fetch)(new URL(path, baseUrl), {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controller.signal,
    })
    if (!response.ok) throw new UpdateAgentUnavailableError()
    return await response.json() as unknown
  } catch {
    throw new UpdateAgentUnavailableError()
  } finally {
    clearTimeout(timeout)
  }
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}

export function isStrictVersion(value: unknown): value is string {
  return isVersion(value)
}

export async function getUpdateAgentStatus(options?: ClientOptions): Promise<UpdateAgentStatus> {
  const body = await requestAgent('/status', options)
  if (!body || typeof body !== 'object') throw new UpdateAgentUnavailableError()
  const value = body as Record<string, unknown>
  if (!isVersion(value.installedVersion)
    || typeof value.containerName !== 'string'
    || typeof value.image !== 'string'
    || typeof value.volume !== 'string'
    || typeof value.port !== 'number') {
    throw new UpdateAgentUnavailableError()
  }
  return {
    installedVersion: value.installedVersion,
    containerName: value.containerName,
    image: value.image,
    volume: value.volume,
    port: value.port,
  }
}

export async function getUpdateCheck(options?: ClientOptions): Promise<UpdateCheck> {
  const body = await requestAgent('/update/check', options)
  if (!body || typeof body !== 'object') throw new UpdateAgentUnavailableError()
  const value = body as Record<string, unknown>
  if (!isVersion(value.currentVersion)
    || !isVersion(value.latestVersion)
    || typeof value.updateAvailable !== 'boolean') {
    throw new UpdateAgentUnavailableError()
  }
  return {
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    updateAvailable: value.updateAvailable,
  }
}

export async function requestUpdate(version: string, options: ClientOptions = {}): Promise<UpdateResult> {
  if (!isVersion(version)) throw new UpdateAgentUnavailableError()
  const { baseUrl, authToken } = loadConnection(options.environment || process.env)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000)

  try {
    const response = await (options.fetchImpl || fetch)(new URL('/update', baseUrl), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version }),
      signal: controller.signal,
    })
    if (response.status === 401) throw new UpdateAgentAuthenticationError()
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (response.status === 409 && body?.error === 'UPDATE_IN_PROGRESS') {
      throw new UpdateAlreadyInProgressError()
    }
    if (response.status === 409
      && body?.status === 'not_updated'
      && body.reason === 'VERSION_NOT_NEWER'
      && isVersion(body.currentVersion)
      && isVersion(body.requestedVersion)) {
      return {
        status: 'not_updated',
        reason: 'VERSION_NOT_NEWER',
        currentVersion: body.currentVersion,
        requestedVersion: body.requestedVersion,
      }
    }
    if (!response.ok || !body
      || body.status !== 'updated'
      || !isVersion(body.previousVersion)
      || !isVersion(body.version)) {
      throw new UpdateAgentUnavailableError()
    }
    return {
      status: 'updated',
      previousVersion: body.previousVersion,
      version: body.version,
    }
  } catch (error) {
    if (error instanceof UpdateAgentAuthenticationError
      || error instanceof UpdateAlreadyInProgressError) throw error
    throw new UpdateAgentUnavailableError()
  } finally {
    clearTimeout(timeout)
  }
}
