import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import {
  isSameOriginMutation, readCoordinatorResource, submitCoordinatorUpdate,
} from '../lib/update-coordinator-api.server.mts'

const requestId = 'request-20261021-00000001'
const jobId = 'job-20261021-0000000001'
function request(body, origin = 'http://localhost') {
  return new Request('http://localhost/api/update/coordinator', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  })
}

test('coordinator API is fail-closed by default and never contacts Agent', async () => {
  let calls = 0
  const response = await submitCoordinatorUpdate(request({ version: '2.0.2', requestId }), {
    requestCoordinator: async () => { calls += 1; throw new Error('must not run') },
  })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'OPERATING_MUTATION_DISABLED' })
  assert.equal(calls, 0)
})

test('202 requires durable acceptance, matching request, and operating authorization', async () => {
  const body = { version: '2.0.2', requestId }
  for (const agentBody of [
    { jobId, requestId, durableAccepted: false, operatingMutationAuthorized: true },
    { jobId, requestId, durableAccepted: true, operatingMutationAuthorized: false },
    { jobId, requestId: 'request-20261021-conflict', durableAccepted: true, operatingMutationAuthorized: true },
  ]) {
    const response = await submitCoordinatorUpdate(request(body), {
      enabled: true, requestCoordinator: async () => ({ status: 202, body: agentBody }),
    })
    assert.equal(response.status, 503)
  }
  const accepted = await submitCoordinatorUpdate(request(body), {
    enabled: true,
    requestCoordinator: async () => ({ status: 202, body: { jobId, requestId, durableAccepted: true, operatingMutationAuthorized: true } }),
  })
  assert.equal(accepted.status, 202)
  assert.deepEqual(await accepted.json(), { status: 'accepted', jobId, requestId })
})

test('invalid and duplicate-field-shaped requests fail before Agent contact', async () => {
  for (const body of [{ version: 'latest', requestId }, { version: '2.0.2' }, { version: '2.0.2', requestId, hospital: 'EWH' }]) {
    const response = await submitCoordinatorUpdate(request(body), { enabled: true,
      requestCoordinator: async () => { throw new Error('must not run') } })
    assert.equal(response.status, 400)
  }
})

test('same-origin mutation check is fail-closed', () => {
  assert.equal(isSameOriginMutation(request({}, 'http://localhost')), true)
  assert.equal(isSameOriginMutation(request({}, 'https://evil.example')), false)
  const noOrigin = new Request('http://localhost/api/update/coordinator', { method: 'POST' })
  assert.equal(isSameOriginMutation(noOrigin), false)
})

test('job lookup blocks cross-hospital records', async () => {
  const response = await readCoordinatorResource('jobs', jobId, { enabled: true, expectedHospital: 'IJH',
    requestCoordinator: async () => ({ status: 200, body: { jobId, requestId, hospital: 'EWH', state: 'RUNNING' } }) })
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'IDENTITY_SCOPE_MISMATCH' })
})

test('routes statically require administrator authentication', () => {
  for (const file of ['app/api/update/route.ts', 'app/api/update/coordinator/route.ts', 'app/api/update/jobs/[jobId]/route.ts', 'app/api/update/jobs/[jobId]/recovery/route.ts', 'app/api/update/requests/[requestId]/route.ts']) {
    const source = fs.readFileSync(file, 'utf8')
    assert.match(source, /isAdminRequest\(request\)/)
  }
})

test('legacy browser mutation endpoint is explicitly closed', () => {
  const source = fs.readFileSync('app/api/update/route.ts', 'utf8')
  assert.match(source, /LEGACY_UPDATE_DISABLED/)
  assert.doesNotMatch(source, /handleUpdateRequest/)
})

test('UI reconnect contract never maps transport failure to success', () => {
  const source = fs.readFileSync('components/clinical/help-modal.tsx', 'utf8')
  assert.match(source, /NEXT_PUBLIC_UPDATE_COORDINATOR_ENABLED/)
  assert.match(source, /sessionStorage\.setItem\(coordinatorSessionKey/)
  assert.match(source, /pollCoordinatorJob/)
  assert.match(source, /status\.state === 'COMPLETED'/)
  assert.doesNotMatch(source, /catch\s*\{[^}]*kind:\s*'success'/s)
  assert.doesNotMatch(source, /fetch\('\/api\/update',\s*\{/)
})
