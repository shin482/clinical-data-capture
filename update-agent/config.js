const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_AGENT_PORT = 3210

function required(environment, name) {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requireSecret(environment, name) {
  const value = required(environment, name)
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters`)
  return value
}

function parsePort(value, name) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535`)
  }
  return port
}

function validateDockerName(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new Error(`${name} contains unsupported characters`)
  }
  return value
}

function validateImageRepository(value) {
  if (!/^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)) {
    throw new Error('EDC_IMAGE_REPOSITORY must be an untagged ghcr.io owner/repository path')
  }
  return value
}

function loadConfig(environment = process.env) {
  return Object.freeze({
    host: LOOPBACK_HOST,
    agentPort: parsePort(environment.UPDATE_AGENT_PORT || DEFAULT_AGENT_PORT, 'UPDATE_AGENT_PORT'),
    containerName: validateDockerName(required(environment, 'EDC_CONTAINER_NAME'), 'EDC_CONTAINER_NAME'),
    imageRepository: validateImageRepository(required(environment, 'EDC_IMAGE_REPOSITORY').toLowerCase()),
    dataVolume: validateDockerName(required(environment, 'EDC_DATA_VOLUME'), 'EDC_DATA_VOLUME'),
    edcPort: parsePort(required(environment, 'EDC_PORT'), 'EDC_PORT'),
    ghcrUsername: required(environment, 'GHCR_USERNAME'),
    ghcrToken: required(environment, 'GHCR_TOKEN'),
    authToken: requireSecret(environment, 'UPDATE_AGENT_AUTH_TOKEN'),
  })
}

module.exports = { DEFAULT_AGENT_PORT, LOOPBACK_HOST, loadConfig }
