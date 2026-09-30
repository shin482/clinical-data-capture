const { compareSemanticVersions, parseSemanticVersion } = require('./ghcr-client')

class UpdateRequestError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'UpdateRequestError'
    this.code = code
  }
}

function validateRequestedVersion(value) {
  if (typeof value !== 'string' || !parseSemanticVersion(value)) {
    throw new UpdateRequestError('INVALID_VERSION', 'version must use major.minor.patch')
  }
  return value
}

function validateUpdateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new UpdateRequestError('INVALID_REQUEST')
  }
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'version') {
    throw new UpdateRequestError('INVALID_REQUEST')
  }
  return validateRequestedVersion(body.version)
}

function createUpdateService(dockerClient) {
  if (!dockerClient) throw new Error('Docker client is required')

  return async function updateEdc(requestBody) {
    const requestedVersion = validateUpdateBody(requestBody)
    const currentVersion = await dockerClient.getCurrentVersion()

    if (compareSemanticVersions(requestedVersion, currentVersion) <= 0) {
      return {
        status: 'not_updated',
        reason: 'VERSION_NOT_NEWER',
        currentVersion,
        requestedVersion,
      }
    }

    const containerConfig = await dockerClient.getContainerConfig()
    await dockerClient.inspectVolume()
    if (!await dockerClient.remoteImageExists(requestedVersion)) {
      throw new UpdateRequestError('IMAGE_NOT_FOUND')
    }
    const image = await dockerClient.pullImage(requestedVersion)
    let database
    try {
      database = await dockerClient.prepareDatabaseForUpdate(containerConfig, image)
    } catch (error) {
      if (error?.recoveryRequired) throw new UpdateRequestError('RECOVERY_REQUIRED')
      throw error
    }
    if (database.status === 'recovery_required') {
      throw new UpdateRequestError('RECOVERY_REQUIRED')
    }
    if (database.status !== 'ready') {
      throw new UpdateRequestError('DATABASE_MIGRATION_FAILED')
    }
    try {
      await dockerClient.replacePreparedContainer(containerConfig, image)
    } catch (error) {
      if (error?.recoveryRequired) throw new UpdateRequestError('RECOVERY_REQUIRED')
      throw error
    }
    const installedVersion = await dockerClient.getCurrentVersion()
    if (installedVersion !== requestedVersion) {
      throw new Error('Updated container version verification failed')
    }

    return {
      status: 'updated',
      previousVersion: currentVersion,
      version: installedVersion,
    }
  }
}

module.exports = {
  UpdateRequestError,
  createUpdateService,
  validateRequestedVersion,
  validateUpdateBody,
}
