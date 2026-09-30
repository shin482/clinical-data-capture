const { execFile } = require('node:child_process')
const { createDockerClient } = require('./docker-client')
const { compareSemanticVersions, createGhcrVersionProvider } = require('./ghcr-client')

const TEST_CONTAINER_NAME = 'edc-update-test'
const TEST_VOLUME_NAME = 'edc-update-test-data'
const TEST_HOST_PORT = 3010
const TEST_OLD_VERSION = '1.0.0'
const PRODUCTION_CONTAINER_NAME = 'edc-ijh'
const PRODUCTION_VOLUME_NAME = 'ijh-edc-data'
const MARKER_CONTENT = 'EDC_UPDATE_TEST_DATA_PRESERVED'
const MARKER_PATH = '/app/data/update-test-marker.txt'

class DockerTestCommandError extends Error {
  constructor() {
    super('Docker update test command failed')
    this.name = 'DockerTestCommandError'
  }
}

function assertSafeTestSettings(settings) {
  if (settings.containerName === PRODUCTION_CONTAINER_NAME) {
    throw new Error('Production container is not allowed in test update flow.')
  }
  if (settings.volumeName === PRODUCTION_VOLUME_NAME) {
    throw new Error('Production volume is not allowed in test update flow.')
  }
  if (settings.containerName !== TEST_CONTAINER_NAME
    || settings.volumeName !== TEST_VOLUME_NAME
    || settings.hostPort !== TEST_HOST_PORT) {
    throw new Error('Docker update test must use the dedicated test resources.')
  }
}

function createRunner(execFileImpl = execFile) {
  const executable = process.platform === 'win32' ? 'docker.exe' : 'docker'
  return (args, options = {}) => new Promise((resolve, reject) => {
    execFileImpl(executable, args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
      timeout: options.timeout || 30000,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) reject(new DockerTestCommandError())
      else resolve(stdout)
    })
  })
}

function createContainerArgs(settings, image) {
  return [
    'container', 'create',
    '--name', settings.containerName,
    '--publish', `127.0.0.1:${settings.hostPort}:3000`,
    '--env', 'EDC_DATA_DIR=/app/data',
    '--env', 'EDC_SITE=EDC Docker Update Test',
    '--mount', `type=volume,source=${settings.volumeName},target=/app/data`,
    '--restart', 'unless-stopped',
    image,
  ]
}

function validateTestContainerConfig(config, settings) {
  const portBinding = config.ports['3000/tcp']?.[0]
  const dataMount = config.mounts.find((mount) => mount.destination === '/app/data')
  if (config.name !== settings.containerName
    || config.environment.EDC_DATA_DIR !== '/app/data'
    || portBinding?.HostPort !== String(settings.hostPort)
    || dataMount?.name !== settings.volumeName
    || config.restartPolicy.Name !== 'unless-stopped') {
    throw new Error('Test container configuration did not match the protected test settings.')
  }
}

async function waitForHealth(fetchImpl, url, options = {}) {
  const attempts = options.attempts || 30
  const intervalMs = options.intervalMs ?? 2000
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { cache: 'no-store' })
      if (response.ok) return response.status
    } catch {}
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Test EDC health check failed.')
}

async function readEdcVersion(fetchImpl, baseUrl) {
  const response = await fetchImpl(`${baseUrl}/api/config`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Test EDC version check failed.')
  const body = await response.json()
  if (typeof body.version !== 'string') throw new Error('Test EDC version response was invalid.')
  return body.version
}

function redactContainerConfig(config) {
  const environment = Object.fromEntries(Object.entries(config.environment).map(([key, value]) => [
    key,
    /password|token|secret/i.test(key) ? '[REDACTED]' : value,
  ]))
  return { ...config, environment }
}

async function runDockerUpdateTest(options) {
  const settings = {
    containerName: options.containerName || TEST_CONTAINER_NAME,
    volumeName: options.volumeName || TEST_VOLUME_NAME,
    hostPort: options.hostPort || TEST_HOST_PORT,
    oldVersion: options.oldVersion || TEST_OLD_VERSION,
  }
  const log = options.log || (() => {})
  const runDocker = options.runDocker || createRunner(options.execFileImpl)
  const fetchImpl = options.fetchImpl || fetch

  if (!options.skipBanner) {
    log('Docker update test')
    log(`Container: ${settings.containerName}`)
    log(`Volume: ${settings.volumeName}`)
    log(`Host Port: ${settings.hostPort}`)
    log(`Production container: ${PRODUCTION_CONTAINER_NAME}`)
    log(`Production volume: ${PRODUCTION_VOLUME_NAME}`)
  }
  assertSafeTestSettings(settings)

  const existingContainer = await runDocker([
    'container', 'ls', '-a', '--filter', `name=^/${settings.containerName}$`, '--format', '{{.Names}}',
  ])
  if (existingContainer.trim()) {
    throw new Error('Test container already exists. No resources were changed.')
  }
  const existingVolume = await runDocker([
    'volume', 'ls', '--filter', `name=^${settings.volumeName}$`, '--format', '{{.Name}}',
  ])
  if (existingVolume.trim()) {
    throw new Error('Test Volume already exists. No resources were changed.')
  }

  const latestVersion = await options.getLatestVersion()
  if (compareSemanticVersions(latestVersion, settings.oldVersion) <= 0) {
    log('No newer GHCR image is available for test.')
    return { status: 'skipped', currentVersion: settings.oldVersion, latestVersion }
  }

  const dockerClient = createDockerClient({
    containerName: settings.containerName,
    dataVolume: settings.volumeName,
    imageRepository: options.imageRepository,
    edcPort: settings.hostPort,
  }, { runDocker })

  const oldImage = await dockerClient.pullImage(settings.oldVersion)
  const newImage = await dockerClient.pullImage(latestVersion)
  await runDocker(['volume', 'create', '--name', settings.volumeName])
  await runDocker(createContainerArgs(settings, oldImage))
  await runDocker(['container', 'start', settings.containerName])

  const baseUrl = `http://127.0.0.1:${settings.hostPort}`
  const healthUrl = `${baseUrl}/api/health`
  const oldHttpStatus = await waitForHealth(fetchImpl, healthUrl, options.healthOptions)
  const oldVersion = await readEdcVersion(fetchImpl, baseUrl)
  await runDocker([
    'container', 'exec', settings.containerName, 'node', '-e',
    `require('node:fs').writeFileSync('${MARKER_PATH}','${MARKER_CONTENT}')`,
  ])
  const markerBefore = (await runDocker([
    'container', 'exec', settings.containerName, 'node', '-e',
    `process.stdout.write(require('node:fs').readFileSync('${MARKER_PATH}','utf8'))`,
  ])).trim()

  const oldInfo = await dockerClient.getContainerInfo()
  const oldConfig = await dockerClient.getContainerConfig()
  validateTestContainerConfig(oldConfig, settings)
  if (oldInfo.Config?.Image !== oldImage || oldVersion !== `v${settings.oldVersion}`) {
    throw new Error('Old test EDC image or version did not match 1.0.0.')
  }
  const oldStatus = oldInfo.State?.Status || 'unknown'

  await runDocker(['container', 'stop', settings.containerName])
  await runDocker(['container', 'rm', settings.containerName])
  await runDocker(createContainerArgs(settings, newImage))
  await runDocker(['container', 'start', settings.containerName])

  const newHttpStatus = await waitForHealth(fetchImpl, healthUrl, options.healthOptions)
  const newVersion = await readEdcVersion(fetchImpl, baseUrl)
  const markerAfter = (await runDocker([
    'container', 'exec', settings.containerName, 'node', '-e',
    `process.stdout.write(require('node:fs').readFileSync('${MARKER_PATH}','utf8'))`,
  ])).trim()
  const newInfo = await dockerClient.getContainerInfo()
  const newConfig = await dockerClient.getContainerConfig()
  validateTestContainerConfig(newConfig, settings)
  const newStatus = newInfo.State?.Status || 'unknown'

  if (newInfo.Config?.Image !== newImage || newVersion !== `v${latestVersion}`) {
    throw new Error('New test EDC image or version did not match the latest GHCR version.')
  }

  if (markerBefore !== MARKER_CONTENT || markerAfter !== MARKER_CONTENT) {
    throw new Error('Test Volume marker was not preserved.')
  }

  const result = {
    status: 'passed',
    oldImage,
    newImage,
    testContainer: settings.containerName,
    oldContainerStatus: oldStatus,
    newContainerStatus: newStatus,
    oldContainerConfig: JSON.stringify(redactContainerConfig(oldConfig)),
    testVolume: settings.volumeName,
    markerBefore,
    markerAfter,
    healthUrl,
    oldHttpStatus,
    newHttpStatus,
    oldVersion,
    newVersion,
  }
  for (const [key, value] of Object.entries(result)) log(`${key}: ${value}`)
  return result
}

async function main() {
  const imageRepository = (process.env.EDC_IMAGE_REPOSITORY
    || 'ghcr.io/shin482/clinical-data-capture-web-app').trim().toLowerCase()
  console.log('Docker update test')
  console.log(`Container: ${TEST_CONTAINER_NAME}`)
  console.log(`Volume: ${TEST_VOLUME_NAME}`)
  console.log(`Host Port: ${TEST_HOST_PORT}`)
  console.log(`Production container: ${PRODUCTION_CONTAINER_NAME}`)
  console.log(`Production volume: ${PRODUCTION_VOLUME_NAME}`)

  if (!process.env.GHCR_USERNAME?.trim() || !process.env.GHCR_TOKEN?.trim()) {
    throw new Error('GHCR_USERNAME and GHCR_TOKEN are required. No Docker resources were changed.')
  }

  const getLatestVersion = createGhcrVersionProvider({
    imageRepository,
    ghcrUsername: process.env.GHCR_USERNAME.trim(),
    ghcrToken: process.env.GHCR_TOKEN.trim(),
  })

  return runDockerUpdateTest({
    getLatestVersion,
    imageRepository,
    log: console.log,
    skipBanner: true,
  })
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Docker update test stopped: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  MARKER_CONTENT,
  PRODUCTION_CONTAINER_NAME,
  PRODUCTION_VOLUME_NAME,
  TEST_CONTAINER_NAME,
  TEST_HOST_PORT,
  TEST_OLD_VERSION,
  TEST_VOLUME_NAME,
  assertSafeTestSettings,
  createContainerArgs,
  readEdcVersion,
  redactContainerConfig,
  runDockerUpdateTest,
  validateTestContainerConfig,
  waitForHealth,
}
