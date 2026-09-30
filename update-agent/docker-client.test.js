const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createDockerClient } = require('./docker-client')

const config = {
  containerName: 'test-edc-container',
  dataVolume: 'test-edc-data',
  imageRepository: 'ghcr.io/test-owner/clinical-data-capture-web-app',
  edcPort: 3000,
}

const inspect = [{
  Name: '/test-edc-container',
  Config: {
    Image: 'ghcr.io/test-owner/clinical-data-capture-web-app:1.0.0',
    Env: ['ADMIN_PASSWORD=private-test-value', 'EDC_DATA_DIR=/app/data'],
    WorkingDir: '/app',
    Cmd: ['node', 'scripts/docker-entrypoint.js'],
    Entrypoint: null,
  },
  HostConfig: {
    PortBindings: { '3000/tcp': [{ HostIp: '', HostPort: '3100' }] },
    RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
  },
  Mounts: [{
    Type: 'volume',
    Name: 'test-edc-data',
    Source: '/var/lib/docker/volumes/test-edc-data/_data',
    Destination: '/app/data',
    RW: true,
  }],
  NetworkSettings: { Networks: { bridge: {} } },
}]

function mockClient(response = JSON.stringify(inspect)) {
  const calls = []
  const client = createDockerClient(config, {
    runDocker: async (args, options) => {
      calls.push({ args, options })
      return response
    },
  })
  return { calls, client }
}

test('container inspection uses the configured test container', async () => {
  const { calls, client } = mockClient()
  const info = await client.getContainerInfo()
  assert.equal(info.Name, '/test-edc-container')
  assert.deepEqual(calls[0].args, ['container', 'inspect', 'test-edc-container'])
})

test('current version comes from the configured running container image tag', async () => {
  const { client } = mockClient()
  assert.equal(await client.getCurrentVersion(), '1.0.0')
})

test('a v-prefixed container image tag is normalized to strict semantic version', async () => {
  const tagged = structuredClone(inspect)
  tagged[0].Config.Image = `${config.imageRepository}:v1.1.0`
  const { client } = mockClient(JSON.stringify(tagged))
  assert.equal(await client.getCurrentVersion(), '1.1.0')
})

test('invalid container image tags fail without a package version fallback', async () => {
  for (const tag of ['latest', 'dev', 'beta', 'rc', '1.1', 'v1.1']) {
    const tagged = structuredClone(inspect)
    tagged[0].Config.Image = `${config.imageRepository}:${tag}`
    const { client } = mockClient(JSON.stringify(tagged))
    await assert.rejects(client.getCurrentVersion(), /semantic version tag/)
  }
})

test('container inspection failure fails without a package version fallback', async () => {
  const client = createDockerClient(config, {
    runDocker: async () => { throw new Error('mock inspect failure') },
  })
  await assert.rejects(client.getCurrentVersion(), /mock inspect failure/)
})

test('container configuration preserves update-critical settings without logging them', async () => {
  const { client } = mockClient()
  const originalLog = console.log
  const originalError = console.error
  const logs = []
  console.log = (...values) => logs.push(values.join(' '))
  console.error = (...values) => logs.push(values.join(' '))
  let result
  try {
    result = await client.getContainerConfig()
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  assert.equal(result.environment.ADMIN_PASSWORD, 'private-test-value')
  assert.equal(result.environment.EDC_DATA_DIR, '/app/data')
  assert.equal(result.mounts[0].name, 'test-edc-data')
  assert.equal(result.ports['3000/tcp'][0].HostPort, '3100')
  assert.equal(result.restartPolicy.Name, 'unless-stopped')
  assert.equal(logs.some((line) => line.includes('private-test-value')), false)
})

test('volume inspection is read-only and targets the configured test Volume', async () => {
  const volume = [{ Name: 'test-edc-data', Mountpoint: '/test-only' }]
  const { calls, client } = mockClient(JSON.stringify(volume))
  assert.equal((await client.inspectVolume()).Name, 'test-edc-data')
  assert.deepEqual(calls[0].args, ['volume', 'inspect', 'test-edc-data'])
})

test('image inspection accepts only the configured repository and semantic version', async () => {
  const { calls, client } = mockClient('[]')
  assert.equal(await client.imageExists('1.1.0'), true)
  assert.deepEqual(calls[0].args, [
    'image', 'inspect', 'ghcr.io/test-owner/clinical-data-capture-web-app:1.1.0',
  ])
})

test('pull construction is repository-bound and is mock-only in this test', async () => {
  const { calls, client } = mockClient('mock pull output')
  const image = await client.pullImage('1.1.0')
  assert.equal(image, 'ghcr.io/test-owner/clinical-data-capture-web-app:1.1.0')
  assert.deepEqual(calls[0].args, [
    'image', 'pull', 'ghcr.io/test-owner/clinical-data-capture-web-app:1.1.0',
  ])
  assert.equal(calls[0].options.timeout, 5 * 60 * 1000)
})

test('shell injection values are rejected before a Docker runner is called', async () => {
  let calls = 0
  assert.throws(() => createDockerClient({
    ...config,
    containerName: 'test-edc-container; rm -rf /',
  }, { runDocker: async () => { calls += 1 } }), /Invalid EDC container name/)

  const client = createDockerClient(config, { runDocker: async () => { calls += 1 } })
  await assert.rejects(client.pullImage('1.1.0; docker stop anything'), /major\.minor\.patch/)
  assert.equal(calls, 0)
})

test('the real runner uses execFile argument arrays with shell disabled', async () => {
  let invocation
  const client = createDockerClient(config, {
    execFileImpl: (file, args, options, callback) => {
      invocation = { file, args, options }
      callback(null, JSON.stringify(inspect), '')
    },
  })
  await client.getContainerInfo()
  assert.match(invocation.file, /^docker(?:\.exe)?$/)
  assert.deepEqual(invocation.args, ['container', 'inspect', 'test-edc-container'])
  assert.equal(invocation.options.shell, false)
})

test('no mutating production container or Volume commands are generated', async () => {
  const { calls, client } = mockClient()
  await client.getContainerInfo()
  await client.inspectVolume()
  await client.imageExists('1.1.0')
  const commands = calls.map(({ args }) => args.join(' '))
  assert.equal(commands.some((command) => /\b(stop|rm|run|restart|prune)\b/.test(command)), false)
  assert.equal(commands.some((command) => command.includes('edc-ijh')), false)
  assert.equal(commands.some((command) => command.includes('ijh-edc-data')), false)
})

test('replacement preserves inspected settings and never deletes a Volume', async () => {
  const calls = []
  const client = createDockerClient(config, {
    runDocker: async (args) => { calls.push(args); return '' },
  })
  const saved = {
    name: config.containerName,
    image: `${config.imageRepository}:1.0.0`,
    environment: { ADMIN_PASSWORD: 'private-test-value', EDC_DATA_DIR: '/app/data' },
    ports: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3100' }] },
    mounts: [{ type: 'volume', name: config.dataVolume, source: '/mock', destination: '/app/data', readOnly: false }],
    restartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
    networks: ['front', 'metrics'],
    workingDirectory: '/app',
    command: ['node', 'scripts/docker-entrypoint.js'],
    entrypoint: ['/usr/bin/tini', '--'],
  }
  await client.replaceContainer(saved, `${config.imageRepository}:1.1.0`)
  assert.deepEqual(calls[0], ['container', 'stop', config.containerName])
  assert.deepEqual(calls[1], ['container', 'rm', config.containerName])
  const create = calls[2]
  assert.deepEqual(create.slice(0, 4), ['container', 'create', '--name', config.containerName])
  assert.ok(create.includes('ADMIN_PASSWORD=private-test-value'))
  assert.ok(create.includes('127.0.0.1:3100:3000/tcp'))
  assert.ok(create.includes(`type=volume,source=${config.dataVolume},target=/app/data`))
  assert.ok(create.includes('unless-stopped'))
  assert.ok(create.includes('front'))
  assert.ok(create.includes('/app'))
  assert.ok(create.includes('/usr/bin/tini'))
  assert.ok(create.includes('--'))
  assert.ok(create.includes('scripts/docker-entrypoint.js'))
  assert.deepEqual(calls[3], ['network', 'connect', 'metrics', config.containerName])
  assert.deepEqual(calls[4], ['container', 'start', config.containerName])
  assert.equal(calls.some((args) => args[0] === 'volume' && ['rm', 'prune'].includes(args[1])), false)
  assert.equal(calls.some((args) => args.includes('-f') || args.includes('--force')), false)
})

test('a stop failure leaves the original container untouched', async () => {
  const calls = []
  const client = createDockerClient(config, {
    runDocker: async (args) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'stop') throw new Error('mock stop failure')
      return ''
    },
  })
  const saved = {
    name: config.containerName,
    image: `${config.imageRepository}:1.0.0`,
    environment: {}, ports: { '3000/tcp': [{ HostIp: '', HostPort: '3100' }] },
    mounts: [{ type: 'volume', name: config.dataVolume, destination: '/app/data', readOnly: false }],
    restartPolicy: { Name: 'no', MaximumRetryCount: 0 }, networks: [],
    workingDirectory: '', command: [], entrypoint: [],
  }
  await assert.rejects(client.replaceContainer(saved, `${config.imageRepository}:1.1.0`))
  assert.deepEqual(calls, [['container', 'stop', config.containerName]])
})

test('a recreate failure attempts recovery with the previous image and settings', async () => {
  const calls = []
  let createCount = 0
  const client = createDockerClient(config, {
    runDocker: async (args) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'create' && ++createCount === 1) {
        throw new Error('mock recreate failure')
      }
      return ''
    },
  })
  const saved = {
    name: config.containerName,
    image: `${config.imageRepository}:1.0.0`,
    environment: {}, ports: { '3000/tcp': [{ HostIp: '', HostPort: '3100' }] },
    mounts: [{ type: 'volume', name: config.dataVolume, destination: '/app/data', readOnly: false }],
    restartPolicy: { Name: 'no', MaximumRetryCount: 0 }, networks: [],
    workingDirectory: '', command: [], entrypoint: [],
  }
  await assert.rejects(client.replaceContainer(saved, `${config.imageRepository}:1.1.0`))
  const creates = calls.filter((args) => args[0] === 'container' && args[1] === 'create')
  assert.equal(creates.length, 2)
  assert.ok(creates[0].includes(`${config.imageRepository}:1.1.0`))
  assert.ok(creates[1].includes(`${config.imageRepository}:1.0.0`))
  assert.deepEqual(calls.at(-1), ['container', 'start', config.containerName])
})

test('remote image inspection is repository-bound and not a generic command API', async () => {
  const { calls, client } = mockClient('{}')
  assert.equal(await client.remoteImageExists('1.1.0'), true)
  assert.deepEqual(calls[0].args, [
    'manifest', 'inspect', 'ghcr.io/test-owner/clinical-data-capture-web-app:1.1.0',
  ])
  await assert.rejects(client.remoteImageExists('latest'), /major\.minor\.patch/)
})

test('database preparation uses only the fixed helper, configured Volume, and new image', async () => {
  const calls = []
  const client = createDockerClient(config, {
    runDocker: async (args, options) => {
      calls.push({ args, options })
      if (args[0] === 'container' && args[1] === 'start' && args.includes('--attach')) {
        return JSON.stringify({ status: 'ready', backupCreated: true, migrationsApplied: [] })
      }
      return ''
    },
    fetchImpl: async () => new Response('{}', { status: 200 }),
    healthAttempts: 1,
  })
  const saved = await mockClient().client.getContainerConfig()
  const image = `${config.imageRepository}:1.1.0`
  const result = await client.prepareDatabaseForUpdate(saved, image)
  assert.equal(result.status, 'ready')
  assert.deepEqual(calls[0].args, ['container', 'stop', config.containerName])
  const create = calls[1].args
  assert.deepEqual(create.slice(0, 4), ['container', 'create', '--name', `${config.containerName}-db-update-helper`])
  assert.ok(create.includes(`type=volume,source=${config.dataVolume},target=/app/data`))
  assert.ok(create.includes('EDC_DATA_DIR=/app/data'))
  assert.ok(create.includes(image))
  assert.ok(create.includes('update-agent/db-update-helper.js'))
  assert.equal(create.some((value) => value.includes('/var/lib/docker/volumes')), false)
  assert.deepEqual(calls[2].args, ['container', 'start', '--attach', `${config.containerName}-db-update-helper`])
  assert.deepEqual(calls[3].args, ['container', 'rm', `${config.containerName}-db-update-helper`])
  assert.equal(calls.some(({ args }) => args[0] === 'volume' && ['rm', 'prune'].includes(args[1])), false)
})

function databasePreparationClient() {
  const calls = []
  const client = createDockerClient(config, {
    runDocker: async (args) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'start' && args.includes('--attach')) {
        return JSON.stringify({ status: 'ready', backupCreated: true, migrationsApplied: [] })
      }
      return ''
    },
    fetchImpl: async () => new Response('{}', { status: 200 }),
    healthAttempts: 1,
  })
  return { calls, client }
}

function savedContainerWithPorts(ports) {
  return {
    name: config.containerName,
    image: `${config.imageRepository}:1.0.0`,
    environment: {},
    ports,
    mounts: [{
      type: 'volume', name: config.dataVolume, source: '/mock',
      destination: '/app/data', readOnly: false,
    }],
    restartPolicy: { Name: 'no', MaximumRetryCount: 0 },
    networks: [], workingDirectory: '', command: [], entrypoint: [],
  }
}

test('port validation accepts host 3010 mapped to configured container port 3000', async () => {
  const { client } = databasePreparationClient()
  const saved = savedContainerWithPorts({
    '3000/tcp': [{ HostIp: '', HostPort: '3010' }],
  })
  const result = await client.prepareDatabaseForUpdate(saved, `${config.imageRepository}:1.1.0`)
  assert.equal(result.status, 'ready')
})

test('port validation accepts host 3000 mapped to configured container port 3000', async () => {
  const { client } = databasePreparationClient()
  const saved = savedContainerWithPorts({
    '3000/tcp': [{ HostIp: '', HostPort: '3000' }],
  })
  const result = await client.prepareDatabaseForUpdate(saved, `${config.imageRepository}:1.1.0`)
  assert.equal(result.status, 'ready')
})

for (const [hostPort, expectedUrl] of [
  ['3010', 'http://127.0.0.1:3010/api/health'],
  ['3000', 'http://127.0.0.1:3000/api/health'],
]) {
  test(`prepared replacement health check uses mapped host port ${hostPort}`, async () => {
    const urls = []
    const client = createDockerClient(config, {
      runDocker: async () => '',
      fetchImpl: async (url) => {
        urls.push(url)
        return new Response('{}', { status: 200 })
      },
      healthAttempts: 1,
    })
    const saved = savedContainerWithPorts({
      '3000/tcp': [{ HostIp: '', HostPort: hostPort }],
    })
    await client.replacePreparedContainer(saved, `${config.imageRepository}:1.1.0`)
    assert.deepEqual(urls, [expectedUrl])
  })
}

test('port validation rejects host 3010 mapped to container port 3001', async () => {
  const { calls, client } = databasePreparationClient()
  const saved = savedContainerWithPorts({
    '3001/tcp': [{ HostIp: '', HostPort: '3010' }],
  })
  await assert.rejects(
    client.prepareDatabaseForUpdate(saved, `${config.imageRepository}:1.1.0`),
    /EDC container port binding does not match configuration/,
  )
  assert.deepEqual(calls, [])
})

test('port validation rejects missing or invalid bindings for the configured container port', async () => {
  for (const ports of [
    {},
    { '3000/tcp': [] },
    { '3000/tcp': [{ HostIp: '', HostPort: '' }] },
    { '3000/tcp': [{ HostIp: '', HostPort: 'invalid' }] },
  ]) {
    const { calls, client } = databasePreparationClient()
    await assert.rejects(
      client.prepareDatabaseForUpdate(
        savedContainerWithPorts(ports),
        `${config.imageRepository}:1.1.0`,
      ),
      /EDC container port binding does not match configuration/,
    )
    assert.deepEqual(calls, [])
  }
})

test('database migration failure restarts and health-checks the original container', async () => {
  const calls = []
  let healthChecks = 0
  const client = createDockerClient(config, {
    runDocker: async (args) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'start' && args.includes('--attach')) {
        return JSON.stringify({ status: 'recovered', backupCreated: true, migrationsApplied: [], error: 'DATABASE_MIGRATION_FAILED' })
      }
      return ''
    },
    fetchImpl: async () => { healthChecks += 1; return new Response('{}', { status: 200 }) },
    healthAttempts: 1,
  })
  const saved = await mockClient().client.getContainerConfig()
  const result = await client.prepareDatabaseForUpdate(saved, `${config.imageRepository}:1.1.0`)
  assert.equal(result.status, 'recovered')
  assert.deepEqual(calls.at(-1), ['container', 'start', config.containerName])
  assert.equal(healthChecks, 1)
})

test('recovery_required leaves the original container stopped for manual recovery', async () => {
  const calls = []
  const client = createDockerClient(config, {
    runDocker: async (args) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'start' && args.includes('--attach')) {
        return JSON.stringify({ status: 'recovery_required', backupCreated: true, migrationsApplied: [], error: 'DATABASE_RECOVERY_FAILED' })
      }
      return ''
    },
    fetchImpl: async () => { throw new Error('health must not be checked') },
    healthAttempts: 1,
  })
  const saved = await mockClient().client.getContainerConfig()
  const result = await client.prepareDatabaseForUpdate(saved, `${config.imageRepository}:1.1.0`)
  assert.equal(result.status, 'recovery_required')
  assert.equal(calls.filter((args) => args[0] === 'container' && args[1] === 'start' && !args.includes('--attach')).length, 0)
})

test('prepared replacement health failure restores the old image and verifies recovery health', async () => {
  const calls = []
  let healthChecks = 0
  const client = createDockerClient(config, {
    runDocker: async (args) => { calls.push(args); return '' },
    fetchImpl: async () => {
      healthChecks += 1
      if (healthChecks === 1) throw new Error('new container unavailable')
      return new Response('{}', { status: 200 })
    },
    healthAttempts: 1,
  })
  const saved = await mockClient().client.getContainerConfig()
  await assert.rejects(client.replacePreparedContainer(saved, `${config.imageRepository}:1.1.0`), /CONTAINER_HEALTH_CHECK_FAILED/)
  const creates = calls.filter((args) => args[0] === 'container' && args[1] === 'create')
  assert.equal(creates.length, 2)
  assert.ok(creates[0].includes(`${config.imageRepository}:1.1.0`))
  assert.ok(creates[1].includes(`${config.imageRepository}:1.0.0`))
  assert.equal(healthChecks, 2)
})
