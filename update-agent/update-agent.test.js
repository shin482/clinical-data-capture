const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const { createUpdateAgent } = require('./app')
const { LOOPBACK_HOST, loadConfig } = require('./config')
const {
  compareSemanticVersions,
  createGhcrVersionProvider,
  latestSemanticVersion,
} = require('./ghcr-client')

const environment = {
  EDC_CONTAINER_NAME: 'edc-ijh',
  EDC_IMAGE_REPOSITORY: 'ghcr.io/shin482/clinical-data-capture-web-app',
  EDC_DATA_VOLUME: 'ijh-edc-data',
  EDC_PORT: '3000',
  UPDATE_AGENT_PORT: '3210',
  GHCR_USERNAME: 'test-user',
  GHCR_TOKEN: 'test-secret-that-must-not-leak',
  UPDATE_AGENT_AUTH_TOKEN: 'test-agent-auth-token-at-least-32-characters',
}

const config = loadConfig(environment)
let latestVersion = '1.2.0'
let updateCheckError = null
let containerVersion = '1.1.0'
let containerError = null
const dockerClient = {
  getCurrentVersion: async () => {
    if (containerError) throw containerError
    return containerVersion
  },
  getContainerImage: async () => {
    if (containerError) throw containerError
    return `${config.imageRepository}:${containerVersion}`
  },
}
const server = createUpdateAgent(config, {
  getLatestVersion: async () => {
    if (updateCheckError) throw updateCheckError
    return latestVersion
  },
  dockerClient,
})
let baseUrl
const authorization = { Authorization: `Bearer ${environment.UPDATE_AGENT_AUTH_TOKEN}` }

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  baseUrl = `http://${LOOPBACK_HOST}:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('GET /health reports an available agent', async () => {
  const response = await fetch(`${baseUrl}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
})

test('GET /status reports configured EDC installation details', async () => {
  const response = await fetch(`${baseUrl}/status`, { headers: authorization })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    installedVersion: '1.1.0',
    containerName: 'edc-ijh',
    image: 'ghcr.io/shin482/clinical-data-capture-web-app:1.1.0',
    volume: 'ijh-edc-data',
    port: 3000,
  })
})

test('GET /update/check reports a newer semantic version', async () => {
  latestVersion = '1.2.0'
  const response = await fetch(`${baseUrl}/update/check`, { headers: authorization })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    currentVersion: '1.1.0',
    latestVersion: '1.2.0',
    updateAvailable: true,
  })
})

test('GET /update/check reports no update for the installed version', async () => {
  latestVersion = '1.1.0'
  const response = await fetch(`${baseUrl}/update/check`, { headers: authorization })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    currentVersion: '1.1.0',
    latestVersion: '1.1.0',
    updateAvailable: false,
  })
})

test('GET /update/check uses the running container version instead of package.json', async () => {
  containerVersion = '1.1.0'
  latestVersion = '1.1.1'
  const response = await fetch(`${baseUrl}/update/check`, { headers: authorization })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    currentVersion: '1.1.0',
    latestVersion: '1.1.1',
    updateAvailable: true,
  })
})

test('GET /update/check safely fails when container inspection fails', async () => {
  containerError = new Error('mock Docker inspection failure')
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const response = await fetch(`${baseUrl}/update/check`, { headers: authorization })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Failed to check latest EDC version' })
  } finally {
    console.error = originalConsoleError
    containerError = null
  }
})

test('semantic versions are compared numerically and non-release tags are ignored', () => {
  assert.equal(compareSemanticVersions('1.10.0', '1.9.0'), 1)
  assert.equal(latestSemanticVersion(['latest', 'dev', '1.9.0', '1.10.0', '2.0.0-rc']), '1.10.0')
})

test('the GHCR provider uses the fixed registry endpoints and bearer flow', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization })
    if (requests.length === 1) {
      return new Response(JSON.stringify({ token: 'temporary-registry-token' }), { status: 200 })
    }
    return new Response(JSON.stringify({ tags: ['latest', '1.9.0', '1.10.0', 'beta'] }), { status: 200 })
  }

  const provider = createGhcrVersionProvider(config, { fetchImpl })
  assert.equal(await provider(), '1.10.0')
  assert.match(requests[0].url, /^https:\/\/ghcr\.io\/token\?/)
  assert.match(requests[1].url, /^https:\/\/ghcr\.io\/v2\/shin482\/clinical-data-capture-web-app\/tags\/list\?n=1000$/)
  assert.match(requests[0].authorization, /^Basic /)
  assert.equal(requests[1].authorization, 'Bearer temporary-registry-token')
})

test('GHCR failures return an error without exposing credentials', async () => {
  updateCheckError = new Error(`registry rejected ${environment.GHCR_TOKEN}`)
  const originalConsoleError = console.error
  const logs = []
  console.error = (...values) => logs.push(values.join(' '))

  try {
    const response = await fetch(`${baseUrl}/update/check`, { headers: authorization })
    const body = await response.json()
    assert.equal(response.status, 503)
    assert.deepEqual(body, { error: 'Failed to check latest EDC version' })
    assert.equal(Object.hasOwn(body, 'updateAvailable'), false)
  } finally {
    console.error = originalConsoleError
    updateCheckError = null
  }

  assert.equal(logs.some((message) => message.includes(environment.GHCR_TOKEN)), false)
})

test('protected endpoints reject a missing bearer token', async () => {
  for (const path of ['/status', '/update/check']) {
    const response = await fetch(`${baseUrl}${path}`)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
  }
})

test('protected endpoints reject an incorrect bearer token without details', async () => {
  for (const path of ['/status', '/update/check']) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    assert.equal(response.status, 401)
    const body = await response.json()
    assert.deepEqual(body, { error: 'unauthorized' })
    assert.equal(JSON.stringify(body).includes(environment.UPDATE_AGENT_AUTH_TOKEN), false)
  }
})

test('the API does not expose arbitrary command endpoints', async () => {
  const response = await fetch(`${baseUrl}/command`, { method: 'POST' })
  assert.equal(response.status, 405)
  assert.deepEqual(await response.json(), { error: 'method_not_allowed' })
})

test('configuration requires hospital-specific values', () => {
  assert.throws(() => loadConfig({}), /EDC_CONTAINER_NAME is required/)
})

test('configuration requires a strong shared Agent token', () => {
  assert.throws(
    () => loadConfig({ ...environment, UPDATE_AGENT_AUTH_TOKEN: 'too-short' }),
    /UPDATE_AGENT_AUTH_TOKEN must be at least 32 characters/,
  )
})
