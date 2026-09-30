const { execFile } = require('node:child_process')

const dockerNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const imageRepositoryPattern = /^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

class DockerCommandError extends Error {
  constructor(message = 'Docker command failed') {
    super(message)
    this.name = 'DockerCommandError'
  }
}

class DockerUpdateError extends DockerCommandError {
  constructor(code, recoveryRequired = false) {
    super(code)
    this.name = 'DockerUpdateError'
    this.code = code
    this.recoveryRequired = recoveryRequired
  }
}

function createDockerRunner(options = {}) {
  const execFileImpl = options.execFileImpl || execFile
  const executable = process.platform === 'win32' ? 'docker.exe' : 'docker'

  return function runDocker(args, commandOptions = {}) {
    return new Promise((resolve, reject) => {
      execFileImpl(executable, args, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        shell: false,
        timeout: commandOptions.timeout || 30000,
        windowsHide: true,
      }, (error, stdout) => {
        if (error) {
          reject(new DockerCommandError())
          return
        }
        resolve(stdout)
      })
    })
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Docker client configuration is required')
  if (!dockerNamePattern.test(config.containerName || '')) throw new Error('Invalid EDC container name')
  if (!dockerNamePattern.test(config.dataVolume || '')) throw new Error('Invalid EDC data Volume name')
  if (!imageRepositoryPattern.test(config.imageRepository || '')) throw new Error('Invalid EDC image repository')
  if (!Number.isInteger(config.edcPort) || config.edcPort < 1 || config.edcPort > 65535) {
    throw new Error('Invalid EDC port')
  }
}

function parseInspectOutput(output, resource) {
  try {
    const parsed = JSON.parse(output)
    if (!Array.isArray(parsed) || !parsed[0] || typeof parsed[0] !== 'object') throw new Error()
    return parsed[0]
  } catch {
    throw new DockerCommandError(`Docker ${resource} inspection returned invalid data`)
  }
}

function environmentMap(entries) {
  return Object.fromEntries((entries || []).map((entry) => {
    const separator = entry.indexOf('=')
    return separator < 0 ? [entry, ''] : [entry.slice(0, separator), entry.slice(separator + 1)]
  }))
}

function normalizedContainerConfig(inspect) {
  return {
    name: typeof inspect.Name === 'string' ? inspect.Name.replace(/^\//, '') : '',
    image: inspect.Config?.Image || '',
    environment: environmentMap(inspect.Config?.Env),
    ports: inspect.HostConfig?.PortBindings || {},
    mounts: (inspect.Mounts || []).map((mount) => ({
      type: mount.Type,
      name: mount.Name || null,
      source: mount.Source,
      destination: mount.Destination,
      readOnly: mount.RW === false,
    })),
    restartPolicy: inspect.HostConfig?.RestartPolicy || { Name: 'no', MaximumRetryCount: 0 },
    networks: Object.keys(inspect.NetworkSettings?.Networks || {}),
    workingDirectory: inspect.Config?.WorkingDir || '',
    command: inspect.Config?.Cmd || [],
    entrypoint: inspect.Config?.Entrypoint || [],
  }
}

function imageVersion(image, repository) {
  const prefix = `${repository}:`
  if (typeof image !== 'string' || !image.startsWith(prefix)) {
    throw new DockerCommandError('EDC container does not use the configured image repository')
  }
  const tag = image.slice(prefix.length)
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  if (!semanticVersionPattern.test(version)) {
    throw new DockerCommandError('EDC container image does not use a semantic version tag')
  }
  return version
}

function mountArgument(mount) {
  const fields = [`type=${mount.type}`]
  if (mount.type === 'volume') fields.push(`source=${mount.name}`)
  else if (mount.type === 'bind') fields.push(`source=${mount.source}`)
  else throw new DockerCommandError('Unsupported EDC container mount type')
  fields.push(`target=${mount.destination}`)
  if (mount.readOnly) fields.push('readonly')
  return fields.join(',')
}

function createContainerArguments(config, containerConfig, image) {
  const args = ['container', 'create', '--name', config.containerName]
  const restart = containerConfig.restartPolicy || {}
  if (restart.Name && restart.Name !== 'no') {
    const suffix = restart.Name === 'on-failure' && restart.MaximumRetryCount
      ? `:${restart.MaximumRetryCount}` : ''
    args.push('--restart', `${restart.Name}${suffix}`)
  }
  for (const entry of Object.entries(containerConfig.environment || {})) {
    args.push('--env', `${entry[0]}=${entry[1]}`)
  }
  for (const [containerPort, bindings] of Object.entries(containerConfig.ports || {})) {
    for (const binding of bindings || []) {
      const host = binding.HostIp ? `${binding.HostIp}:` : ''
      args.push('--publish', `${host}${binding.HostPort}:${containerPort}`)
    }
  }
  for (const mount of containerConfig.mounts || []) {
    args.push('--mount', mountArgument(mount))
  }
  if (containerConfig.networks?.[0]) args.push('--network', containerConfig.networks[0])
  if (containerConfig.workingDirectory) args.push('--workdir', containerConfig.workingDirectory)
  const entrypoint = containerConfig.entrypoint || []
  if (entrypoint.length > 0) args.push('--entrypoint', entrypoint[0])
  args.push(image, ...entrypoint.slice(1), ...(containerConfig.command || []))
  return args
}

function createDockerClient(config, options = {}) {
  validateConfig(config)
  const runDocker = options.runDocker || createDockerRunner(options)
  const fetchImpl = options.fetchImpl || fetch
  const sleep = options.sleepImpl || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const helperName = `${config.containerName}-db-update-helper`

  function allowedImage(version) {
    if (!semanticVersionPattern.test(version)) throw new Error('Image version must use major.minor.patch')
    return `${config.imageRepository}:${version}`
  }

  async function getContainerInfo() {
    const output = await runDocker(['container', 'inspect', config.containerName])
    return parseInspectOutput(output, 'container')
  }

  async function getContainerImage() {
    const inspect = await getContainerInfo()
    if (typeof inspect.Config?.Image !== 'string' || !inspect.Config.Image) {
      throw new DockerCommandError('Docker container image was unavailable')
    }
    return inspect.Config.Image
  }

  async function getCurrentVersion() {
    return imageVersion(await getContainerImage(), config.imageRepository)
  }

  async function getContainerConfig() {
    return normalizedContainerConfig(await getContainerInfo())
  }

  async function inspectVolume() {
    const output = await runDocker(['volume', 'inspect', config.dataVolume])
    return parseInspectOutput(output, 'Volume')
  }

  async function imageExists(version) {
    try {
      await runDocker(['image', 'inspect', allowedImage(version)])
      return true
    } catch (error) {
      if (error instanceof DockerCommandError) return false
      throw error
    }
  }

  async function pullImage(version) {
    const image = allowedImage(version)
    await runDocker(['image', 'pull', image], { timeout: 5 * 60 * 1000 })
    return image
  }


  async function remoteImageExists(version) {
    try {
      await runDocker(['manifest', 'inspect', allowedImage(version)], { timeout: 60000 })
      return true
    } catch (error) {
      if (error instanceof DockerCommandError) return false
      throw error
    }
  }

  async function waitForHealth(hostPort) {
    const attempts = options.healthAttempts || 20
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetchImpl(`http://127.0.0.1:${hostPort}/api/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        })
        if (response.ok) return
      } catch {}
      if (attempt + 1 < attempts) await sleep(options.healthDelayMs || 2000)
    }
    throw new DockerUpdateError('CONTAINER_HEALTH_CHECK_FAILED')
  }

  function assertUpdateTarget(containerConfig) {
    if (containerConfig.name !== config.containerName) {
      throw new DockerCommandError('Inspected container name does not match configuration')
    }
    imageVersion(containerConfig.image, config.imageRepository)
    const dataMount = containerConfig.mounts.find((mount) => mount.destination === '/app/data')
    if (!dataMount || dataMount.type !== 'volume' || dataMount.name !== config.dataVolume) {
      throw new DockerCommandError('EDC data Volume is not mounted at /app/data')
    }
    const configuredContainerPort = `${config.edcPort}/tcp`
    const configuredBindings = containerConfig.ports?.[configuredContainerPort]
    const configuredBinding = Array.isArray(configuredBindings)
      && configuredBindings.find((binding) => {
        const hostPort = binding?.HostPort
        const parsedHostPort = Number(hostPort)
        return typeof hostPort === 'string'
          && /^\d+$/.test(hostPort)
          && Number.isInteger(parsedHostPort)
          && parsedHostPort >= 1
          && parsedHostPort <= 65535
      })
    if (!configuredBinding) {
      throw new DockerCommandError('EDC container port binding does not match configuration')
    }
    return Number(configuredBinding.HostPort)
  }

  async function restartOriginalContainer(hostPort) {
    await runDocker(['container', 'start', config.containerName])
    await waitForHealth(hostPort)
  }

  async function prepareDatabaseForUpdate(containerConfig, newImage) {
    const hostPort = assertUpdateTarget(containerConfig)
    if (newImage !== allowedImage(imageVersion(newImage, config.imageRepository))) {
      throw new DockerCommandError('Invalid database helper image')
    }
    let originalStopped = false
    let helperCreated = false
    try {
      await runDocker(['container', 'stop', config.containerName])
      originalStopped = true
      await runDocker([
        'container', 'create',
        '--name', helperName,
        '--mount', `type=volume,source=${config.dataVolume},target=/app/data`,
        '--env', 'EDC_DATA_DIR=/app/data',
        '--entrypoint', 'node',
        newImage,
        'update-agent/db-update-helper.js',
      ])
      helperCreated = true
      const output = await runDocker(['container', 'start', '--attach', helperName], { timeout: 10 * 60 * 1000 })
      let result
      try { result = JSON.parse(output.trim()) } catch { throw new DockerUpdateError('DATABASE_HELPER_INVALID_RESPONSE') }
      await runDocker(['container', 'rm', helperName])
      helperCreated = false
      if (!result || !['ready', 'recovered', 'recovery_required'].includes(result.status)) {
        throw new DockerUpdateError('DATABASE_HELPER_INVALID_RESPONSE')
      }
      if (result.status === 'recovered') {
        await restartOriginalContainer(hostPort)
        originalStopped = false
      }
      return result
    } catch (error) {
      if (helperCreated) {
        try { await runDocker(['container', 'stop', helperName]) } catch {}
        try { await runDocker(['container', 'rm', helperName]) } catch {}
      }
      if (originalStopped) {
        try { await restartOriginalContainer(hostPort) } catch {
          throw new DockerUpdateError('DATABASE_PREPARATION_RECOVERY_FAILED', true)
        }
      }
      throw error
    }
  }

  async function replacePreparedContainer(containerConfig, newImage) {
    const hostPort = assertUpdateTarget(containerConfig)
    const replacementArguments = createContainerArguments(config, containerConfig, newImage)
    const recoveryArguments = createContainerArguments(config, containerConfig, containerConfig.image)
    let originalRemoved = false
    let replacementCreated = false
    try {
      await runDocker(['container', 'rm', config.containerName])
      originalRemoved = true
      await runDocker(replacementArguments)
      replacementCreated = true
      for (const network of containerConfig.networks.slice(1)) {
        await runDocker(['network', 'connect', network, config.containerName])
      }
      await runDocker(['container', 'start', config.containerName])
      await waitForHealth(hostPort)
    } catch (error) {
      try {
        if (!originalRemoved) {
          await restartOriginalContainer(hostPort)
        } else {
          if (replacementCreated) {
            try { await runDocker(['container', 'stop', config.containerName]) } catch {}
            try { await runDocker(['container', 'rm', config.containerName]) } catch {}
          }
          await runDocker(recoveryArguments)
          for (const network of containerConfig.networks.slice(1)) {
            await runDocker(['network', 'connect', network, config.containerName])
          }
          await runDocker(['container', 'start', config.containerName])
          await waitForHealth(hostPort)
        }
      } catch {
        throw new DockerUpdateError('CONTAINER_RECOVERY_FAILED', true)
      }
      throw error
    }
  }

  async function replaceContainer(containerConfig, newImage) {
    assertUpdateTarget(containerConfig)
    const previousImage = containerConfig.image
    const replacementArguments = createContainerArguments(config, containerConfig, newImage)
    const recoveryArguments = createContainerArguments(config, containerConfig, previousImage)
    let stopped = false
    let removed = false
    let replacementCreated = false
    try {
      await runDocker(['container', 'stop', config.containerName])
      stopped = true
      await runDocker(['container', 'rm', config.containerName])
      removed = true
      await runDocker(replacementArguments)
      replacementCreated = true
      for (const network of containerConfig.networks.slice(1)) {
        await runDocker(['network', 'connect', network, config.containerName])
      }
      await runDocker(['container', 'start', config.containerName])
      return
    } catch (updateError) {
      try {
        if (stopped && !removed) {
          await runDocker(['container', 'start', config.containerName])
        } else if (removed) {
          if (replacementCreated) {
            try { await runDocker(['container', 'stop', config.containerName]) } catch {}
            try { await runDocker(['container', 'rm', config.containerName]) } catch {}
          }
          await runDocker(recoveryArguments)
          for (const network of containerConfig.networks.slice(1)) {
            await runDocker(['network', 'connect', network, config.containerName])
          }
          await runDocker(['container', 'start', config.containerName])
        }
      } catch {
        // Recovery is best effort. Never expose Docker output through the API.
      }
      throw updateError
    }
  }

  return Object.freeze({
    getContainerConfig,
    getContainerImage,
    getContainerInfo,
    getCurrentVersion,
    imageExists,
    inspectVolume,
    pullImage,
    prepareDatabaseForUpdate,
    remoteImageExists,
    replaceContainer,
    replacePreparedContainer,
    waitForHealth,
  })
}

module.exports = {
  DockerUpdateError,
  createDockerClient,
}
