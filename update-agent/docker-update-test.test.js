const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  MARKER_CONTENT,
  assertSafeTestSettings,
  runDockerUpdateTest,
} = require('./docker-update-test')

const repository = 'ghcr.io/test-owner/clinical-data-capture-web-app'

function createSimulation() {
  const calls = []
  const state = { container: false, image: '', marker: '', status: '' }

  function inspectResult() {
    return JSON.stringify([{
      Name: '/edc-update-test',
      State: { Status: state.status },
      Config: {
        Image: state.image,
        Env: ['EDC_DATA_DIR=/app/data', 'EDC_SITE=EDC Docker Update Test'],
        WorkingDir: '/app',
        Cmd: ['node', 'scripts/docker-entrypoint.js'],
        Entrypoint: null,
      },
      HostConfig: {
        PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3010' }] },
        RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      },
      Mounts: [{
        Type: 'volume', Name: 'edc-update-test-data', Source: '/test-only',
        Destination: '/app/data', RW: true,
      }],
      NetworkSettings: { Networks: { bridge: {} } },
    }])
  }

  const runDocker = async (args, options) => {
    calls.push({ args, options })
    const command = args.slice(0, 2).join(' ')
    if (command === 'container ls' || command === 'volume ls') return ''
    if (command === 'image pull' || command === 'volume create') return 'ok'
    if (command === 'container create') {
      state.container = true
      state.image = args.at(-1)
      state.status = 'created'
      return 'test-container-id'
    }
    if (command === 'container start') { state.status = 'running'; return 'edc-update-test' }
    if (command === 'container inspect') return inspectResult()
    if (command === 'container stop') { state.status = 'exited'; return 'edc-update-test' }
    if (command === 'container rm') { state.container = false; return 'edc-update-test' }
    if (command === 'container exec') {
      if (args.at(-1).includes('writeFileSync')) { state.marker = MARKER_CONTENT; return '' }
      return state.marker
    }
    throw new Error(`Unexpected simulated command: ${args.join(' ')}`)
  }

  return { calls, runDocker, state }
}

test('simulated update replaces only the test container and preserves its marker Volume', async () => {
  const simulation = createSimulation()
  const logs = []
  const result = await runDockerUpdateTest({
    imageRepository: repository,
    getLatestVersion: async () => '1.1.0',
    runDocker: simulation.runDocker,
    fetchImpl: async (url) => new Response(
      url.endsWith('/api/config')
        ? JSON.stringify({ version: simulation.state.image.endsWith(':1.0.0') ? 'v1.0.0' : 'v1.1.0' })
        : '{}',
      { status: 200 },
    ),
    healthOptions: { attempts: 1, intervalMs: 0 },
    log: (message) => logs.push(message),
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.oldImage, `${repository}:1.0.0`)
  assert.equal(result.newImage, `${repository}:1.1.0`)
  assert.equal(result.markerBefore, MARKER_CONTENT)
  assert.equal(result.markerAfter, MARKER_CONTENT)
  assert.equal(result.oldHttpStatus, 200)
  assert.equal(result.newHttpStatus, 200)
  assert.equal(result.oldVersion, 'v1.0.0')
  assert.equal(result.newVersion, 'v1.1.0')
  assert.equal(simulation.state.image, `${repository}:1.1.0`)
  assert.equal(simulation.state.marker, MARKER_CONTENT)
  assert.equal(simulation.state.status, 'running')

  const commands = simulation.calls.map(({ args }) => args.join(' '))
  assert.equal(commands.filter((command) => command === 'container stop edc-update-test').length, 1)
  assert.equal(commands.filter((command) => command === 'container rm edc-update-test').length, 1)
  assert.equal(commands.some((command) => command.includes('edc-ijh')), false)
  assert.equal(commands.some((command) => command.includes('ijh-edc-data')), false)
  assert.equal(commands.some((command) => /volume (rm|prune)/.test(command)), false)
  assert.equal(logs.some((line) => line.includes('private')), false)
})

test('production resource names are rejected before Docker access', () => {
  assert.throws(() => assertSafeTestSettings({
    containerName: 'edc-ijh', volumeName: 'edc-update-test-data', hostPort: 3010,
  }), /Production container/)
  assert.throws(() => assertSafeTestSettings({
    containerName: 'edc-update-test', volumeName: 'ijh-edc-data', hostPort: 3010,
  }), /Production volume/)
})

test('an existing test resource aborts before any mutating command', async () => {
  const calls = []
  await assert.rejects(runDockerUpdateTest({
    imageRepository: repository,
    getLatestVersion: async () => '1.1.0',
    runDocker: async (args) => { calls.push(args); return 'edc-update-test\n' },
  }), /already exists/)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(0, 2), ['container', 'ls'])
})

test('no newer image exits before pull or resource creation', async () => {
  const calls = []
  const result = await runDockerUpdateTest({
    imageRepository: repository,
    getLatestVersion: async () => '1.0.0',
    runDocker: async (args) => { calls.push(args); return '' },
  })
  assert.equal(result.status, 'skipped')
  assert.deepEqual(calls.map((args) => args.slice(0, 2).join(' ')), ['container ls', 'volume ls'])
})
