const http = require('node:http')
const { createHash, timingSafeEqual } = require('node:crypto')
const { createDockerClient } = require('./docker-client')
const { compareSemanticVersions, createGhcrVersionProvider } = require('./ghcr-client')
const { UpdateRequestError, createUpdateService } = require('./update-service')

function secretDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest()
}

function isAuthorized(authorization, expectedToken) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false
  const suppliedToken = authorization.slice('Bearer '.length)
  return timingSafeEqual(secretDigest(suppliedToken), secretDigest(expectedToken))
}

function writeJson(response, statusCode, body, additionalHeaders = {}) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...additionalHeaders,
  })
  response.end(JSON.stringify(body))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    let tooLarge = false
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      if (tooLarge) return
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > 4096) {
        tooLarge = true
      }
    })
    request.on('end', () => {
      if (tooLarge) {
        reject(new UpdateRequestError('INVALID_REQUEST'))
        return
      }
      try { resolve(JSON.parse(body)) } catch { reject(new UpdateRequestError('INVALID_REQUEST')) }
    })
    request.on('error', reject)
  })
}

function createRequestHandler(config, dependencies = {}) {
  const getLatestVersion = dependencies.getLatestVersion
    || createGhcrVersionProvider(config)
  const dockerClient = dependencies.dockerClient || createDockerClient(config)
  const updateEdc = dependencies.updateEdc || createUpdateService(dockerClient)
  let updateInProgress = false

  return async function requestHandler(request, response) {
    const url = new URL(request.url || '/', 'http://127.0.0.1')

    if (url.pathname === '/update' && request.method === 'POST') {
      if (!isAuthorized(request.headers.authorization, config.authToken)) {
        writeJson(response, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' })
        return
      }
      if (updateInProgress) {
        writeJson(response, 409, { error: 'UPDATE_IN_PROGRESS' })
        return
      }
      updateInProgress = true
      try {
        const result = await updateEdc(await readJsonBody(request))
        writeJson(response, result.status === 'not_updated' ? 409 : 200, result)
      } catch (error) {
        if (error instanceof UpdateRequestError && error.code === 'INVALID_REQUEST') {
          writeJson(response, 400, { error: 'INVALID_REQUEST' })
        } else if (error instanceof UpdateRequestError && error.code === 'INVALID_VERSION') {
          writeJson(response, 400, { error: 'INVALID_VERSION' })
        } else if (error instanceof UpdateRequestError && error.code === 'RECOVERY_REQUIRED') {
          writeJson(response, 500, { error: 'RECOVERY_REQUIRED' })
        } else if (error instanceof UpdateRequestError && error.code === 'DATABASE_MIGRATION_FAILED') {
          writeJson(response, 500, { error: 'DATABASE_MIGRATION_FAILED' })
        } else {
          console.error('EDC update failed')
          writeJson(response, 500, { error: 'UPDATE_FAILED' })
        }
      } finally {
        updateInProgress = false
      }
      return
    }

    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' })
      return
    }

    if (url.pathname === '/health') {
      writeJson(response, 200, { status: 'ok' })
      return
    }

    if ((url.pathname === '/status' || url.pathname === '/update/check')
      && !isAuthorized(request.headers.authorization, config.authToken)) {
      writeJson(response, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' })
      return
    }

    if (url.pathname === '/status') {
      try {
        const [installedVersion, image] = await Promise.all([
          dockerClient.getCurrentVersion(),
          dockerClient.getContainerImage(),
        ])
        writeJson(response, 200, {
          installedVersion,
          containerName: config.containerName,
          image,
          volume: config.dataVolume,
          port: config.edcPort,
        })
      } catch {
        console.error('EDC container status check failed')
        writeJson(response, 503, { error: 'Failed to inspect EDC container' })
      }
      return
    }

    if (url.pathname === '/update/check') {
      try {
        const [currentVersion, latestVersion] = await Promise.all([
          dockerClient.getCurrentVersion(),
          getLatestVersion(),
        ])
        writeJson(response, 200, {
          currentVersion,
          latestVersion,
          updateAvailable: compareSemanticVersions(latestVersion, currentVersion) > 0,
        })
      } catch {
        // Never log registry errors here: request metadata can contain secrets.
        console.error('Update check failed')
        writeJson(response, 503, { error: 'Failed to check latest EDC version' })
      }
      return
    }

    writeJson(response, 404, { error: 'not_found' })
  }
}

function createUpdateAgent(config, dependencies) {
  return http.createServer(createRequestHandler(config, dependencies))
}

module.exports = { createRequestHandler, createUpdateAgent }
