const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createUpdateAgent } = require('./app')

const token = 'update-api-test-token-at-least-32-characters'
const config = {
  host: '127.0.0.1',
  authToken: token,
  installedVersion: '1.0.0',
  containerName: 'edc-ijh',
  imageRepository: 'ghcr.io/shin482/clinical-data-capture-web-app',
  dataVolume: 'ijh-edc-data',
  edcPort: 3000,
}

function createMockDocker(overrides = {}) {
  let version = overrides.version || '1.0.0'
  const calls = []
  const containerConfig = {
    name: 'edc-ijh',
    image: `${config.imageRepository}:${version}`,
    environment: { ADMIN_PASSWORD: 'mock-secret-value', EDC_DATA_DIR: '/app/data' },
    ports: { '3000/tcp': [{ HostIp: '', HostPort: '3000' }] },
    mounts: [{ type: 'volume', name: 'ijh-edc-data', source: '/mock', destination: '/app/data', readOnly: false }],
    restartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
    networks: ['bridge'],
    workingDirectory: '/app',
    command: ['node', 'scripts/docker-entrypoint.js'],
    entrypoint: [],
  }
  return {
    calls,
    async getCurrentVersion() { calls.push('getCurrentVersion'); return version },
    async getContainerConfig() { calls.push('getContainerConfig'); return containerConfig },
    async inspectVolume() { calls.push('inspectVolume'); return { Name: 'ijh-edc-data' } },
    async remoteImageExists(value) { calls.push(`remoteImageExists:${value}`); return overrides.remoteExists !== false },
    async pullImage(value) {
      calls.push(`pullImage:${value}`)
      if (overrides.pullError) throw new Error(`pull failed ${token}`)
      return `${config.imageRepository}:${value}`
    },
    async prepareDatabaseForUpdate(_saved, image) {
      calls.push(`prepareDatabaseForUpdate:${image}`)
      if (overrides.databaseResult) return overrides.databaseResult
      return { status: 'ready', backupCreated: true, migrationsApplied: [] }
    },
    async replacePreparedContainer(_saved, image) {
      calls.push(`replacePreparedContainer:${image}`)
      if (overrides.replaceRecoveryRequired) {
        const error = new Error('mock recovery failure')
        error.recoveryRequired = true
        throw error
      }
      if (overrides.replaceError) throw new Error(`replace failed ${token}`)
      version = image.slice(image.lastIndexOf(':') + 1)
    },
  }
}

async function withServer(dockerClient, callback) {
  const server = createUpdateAgent(config, {
    dockerClient,
    getLatestVersion: async () => '1.1.0',
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await callback(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function post(url, body, suppliedToken = token) {
  const headers = { 'Content-Type': 'application/json' }
  if (suppliedToken !== null) headers.Authorization = `Bearer ${suppliedToken}`
  return fetch(`${url}/update`, { method: 'POST', headers, body: JSON.stringify(body) })
}

test('POST /update requires the configured bearer token', async () => {
  await withServer(createMockDocker(), async (url) => {
    for (const supplied of [null, 'incorrect-token']) {
      const response = await post(url, { version: '1.1.0' }, supplied)
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: 'Unauthorized' })
    }
  })
})

test('POST /update validates strict semantic versions before Docker access', async () => {
  const docker = createMockDocker()
  await withServer(docker, async (url) => {
    for (const version of ['latest', 'dev', 'beta', 'rc', '1.1.0-beta', '1.1.0;docker rm edc-ijh']) {
      const response = await post(url, { version })
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), { error: 'INVALID_VERSION' })
    }
  })
  assert.deepEqual(docker.calls, [])
})

test('POST /update rejects caller-controlled Docker targets', async () => {
  const docker = createMockDocker()
  await withServer(docker, async (url) => {
    for (const extra of [
      { repository: 'ghcr.io/attacker/image' },
      { containerName: 'other' },
      { volume: 'other-data' },
      { port: 9999 },
    ]) {
      const response = await post(url, { version: '1.1.0', ...extra })
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), { error: 'INVALID_REQUEST' })
    }
  })
  assert.deepEqual(docker.calls, [])
})

test('POST /update reports equal and older versions without mutation', async () => {
  for (const requestedVersion of ['1.1.0', '1.0.0']) {
    const docker = createMockDocker({ version: '1.1.0' })
    await withServer(docker, async (url) => {
      const response = await post(url, { version: requestedVersion })
      assert.equal(response.status, 409)
      assert.deepEqual(await response.json(), {
        status: 'not_updated',
        reason: 'VERSION_NOT_NEWER',
        currentVersion: '1.1.0',
        requestedVersion,
      })
    })
    assert.deepEqual(docker.calls, ['getCurrentVersion'])
  }
})

test('POST /update performs a repository-bound mocked update', async () => {
  const docker = createMockDocker()
  await withServer(docker, async (url) => {
    const response = await post(url, { version: '1.1.0' })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      status: 'updated', previousVersion: '1.0.0', version: '1.1.0',
    })
  })
  assert.deepEqual(docker.calls, [
    'getCurrentVersion', 'getContainerConfig', 'inspectVolume',
    'remoteImageExists:1.1.0', 'pullImage:1.1.0',
    `prepareDatabaseForUpdate:${config.imageRepository}:1.1.0`,
    `replacePreparedContainer:${config.imageRepository}:1.1.0`, 'getCurrentVersion',
  ])
})

test('registry, pull, and recreate failures return sanitized errors', async () => {
  for (const overrides of [{ remoteExists: false }, { pullError: true }, { replaceError: true }]) {
    const logs = []
    const originalError = console.error
    console.error = (...values) => logs.push(values.join(' '))
    try {
      await withServer(createMockDocker(overrides), async (url) => {
        const response = await post(url, { version: '1.1.0' })
        assert.equal(response.status, 500)
        const body = await response.json()
        assert.deepEqual(body, { error: 'UPDATE_FAILED' })
        assert.equal(JSON.stringify(body).includes(token), false)
      })
    } finally {
      console.error = originalError
    }
    assert.equal(logs.some((line) => line.includes(token)), false)
  }
})

test('database migration failure stops before container replacement', async () => {
  for (const databaseResult of [
    { status: 'recovered', error: 'DATABASE_MIGRATION_FAILED' },
    { status: 'recovery_required', error: 'DATABASE_RECOVERY_FAILED' },
  ]) {
    const docker = createMockDocker({ databaseResult })
    const logs = []
    const originalError = console.error
    console.error = (...values) => logs.push(values.join(' '))
    try {
      await withServer(docker, async (url) => {
        const response = await post(url, { version: '1.1.0' })
        assert.equal(response.status, 500)
        assert.deepEqual(await response.json(), {
          error: databaseResult.status === 'recovery_required'
            ? 'RECOVERY_REQUIRED' : 'DATABASE_MIGRATION_FAILED',
        })
      })
    } finally { console.error = originalError }
    assert.equal(docker.calls.some((call) => call.startsWith('replacePreparedContainer:')), false)
  }
})

test('container rollback failure returns RECOVERY_REQUIRED without details', async () => {
  const docker = createMockDocker({ replaceRecoveryRequired: true })
  const originalError = console.error
  console.error = () => {}
  try {
    await withServer(docker, async (url) => {
      const response = await post(url, { version: '1.1.0' })
      assert.equal(response.status, 500)
      assert.deepEqual(await response.json(), { error: 'RECOVERY_REQUIRED' })
    })
  } finally { console.error = originalError }
})

test('a concurrent POST /update receives UPDATE_IN_PROGRESS and the lock is released', async () => {
  let release
  let entered
  const enteredPromise = new Promise((resolve) => { entered = resolve })
  const releasePromise = new Promise((resolve) => { release = resolve })
  let calls = 0
  const updateEdc = async () => {
    calls += 1
    if (calls === 1) { entered(); await releasePromise }
    return { status: 'updated', previousVersion: '1.0.0', version: '1.1.0' }
  }
  const server = createUpdateAgent(config, { dockerClient: createMockDocker(), updateEdc })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    const first = post(url, { version: '1.1.0' })
    await enteredPromise
    const second = await post(url, { version: '1.1.0' })
    assert.equal(second.status, 409)
    assert.deepEqual(await second.json(), { error: 'UPDATE_IN_PROGRESS' })
    release()
    assert.equal((await first).status, 200)
    assert.equal((await post(url, { version: '1.1.0' })).status, 200)
  } finally {
    release()
    await new Promise((resolve) => server.close(resolve))
  }
})
