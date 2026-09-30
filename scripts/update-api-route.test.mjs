import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleUpdateRequest } from '../lib/update-api.server.mts'
import {
  UpdateAgentAuthenticationError,
  UpdateAgentUnavailableError,
  UpdateAlreadyInProgressError,
} from '../lib/update-agent-client.server.mts'

function request(body) {
  return new Request('http://localhost/api/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const available = async () => ({
  currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true,
})
const updated = async (version) => ({ status: 'updated', previousVersion: '1.0.0', version })

test('/api/update accepts the checked latest version and returns update_started', async () => {
  let calledWith
  const response = await handleUpdateRequest(request({ version: '1.1.0' }), {
    getUpdateCheck: available,
    requestUpdate: async (version) => { calledWith = version; return updated(version) },
  })
  assert.equal(response.status, 202)
  assert.deepEqual(await response.json(), { status: 'update_started', version: '1.1.0' })
  assert.equal(calledWith, '1.1.0')
})

test('/api/update rejects invalid, latest, injection, and caller-controlled targets', async () => {
  for (const body of [
    { version: 'latest' },
    { version: '1.1.0-beta' },
    { version: '1.1.0; docker rm edc-ijh' },
    { version: '1.1.0', container: 'other' },
    { version: '1.1.0', repository: 'ghcr.io/other/image' },
  ]) {
    const response = await handleUpdateRequest(request(body), {
      getUpdateCheck: () => { throw new Error('must not be called') },
      requestUpdate: () => { throw new Error('must not be called') },
    })
    assert.equal(response.status, 400)
  }
})

test('/api/update rechecks the latest version server-side', async () => {
  const mismatch = await handleUpdateRequest(request({ version: '1.2.0' }), {
    getUpdateCheck: available, requestUpdate: updated,
  })
  assert.equal(mismatch.status, 409)
  assert.deepEqual(await mismatch.json(), { error: 'VERSION_MISMATCH' })
  const current = await handleUpdateRequest(request({ version: '1.1.0' }), {
    getUpdateCheck: async () => ({ currentVersion: '1.1.0', latestVersion: '1.1.0', updateAvailable: false }),
    requestUpdate: updated,
  })
  assert.equal(current.status, 409)
  assert.deepEqual(await current.json(), { error: 'VERSION_NOT_NEWER' })
})

test('/api/update safely maps Agent authentication, lock, and unavailable failures', async () => {
  const cases = [
    [new UpdateAgentAuthenticationError(), 502, 'AGENT_AUTHENTICATION_FAILED'],
    [new UpdateAlreadyInProgressError(), 409, 'UPDATE_IN_PROGRESS'],
    [new UpdateAgentUnavailableError(), 503, 'AGENT_UNAVAILABLE'],
  ]
  for (const [error, status, code] of cases) {
    const response = await handleUpdateRequest(request({ version: '1.1.0' }), {
      getUpdateCheck: available,
      requestUpdate: async () => { throw error },
    })
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: code })
  }
})
