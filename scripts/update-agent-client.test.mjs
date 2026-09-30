import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getUpdateAgentStatus,
  getUpdateCheck,
  requestUpdate,
  UpdateAgentAuthenticationError,
  UpdateAlreadyInProgressError,
  UpdateAgentUnavailableError,
} from '../lib/update-agent-client.server.mts'

const authToken = 'shared-agent-auth-token-at-least-32-characters'
const environment = {
  UPDATE_AGENT_URL: 'http://127.0.0.1:3210',
  UPDATE_AGENT_AUTH_TOKEN: authToken,
}

test('EDC update client sends bearer auth and returns only update fields', async () => {
  let request
  const result = await getUpdateCheck({
    environment,
    fetchImpl: async (url, options) => {
      request = { url: String(url), authorization: options?.headers?.Authorization }
      return new Response(JSON.stringify({
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateAvailable: true,
        GHCR_TOKEN: 'must-not-pass-through',
        UPDATE_AGENT_AUTH_TOKEN: 'must-not-pass-through',
      }), { status: 200 })
    },
  })

  assert.deepEqual(request, {
    url: 'http://127.0.0.1:3210/update/check',
    authorization: `Bearer ${authToken}`,
  })
  assert.deepEqual(result, {
    currentVersion: '1.0.0',
    latestVersion: '1.1.0',
    updateAvailable: true,
  })
  assert.equal(JSON.stringify(result).includes('must-not-pass-through'), false)
})

test('EDC update client can read the protected Agent status', async () => {
  const result = await getUpdateAgentStatus({
    environment,
    fetchImpl: async () => new Response(JSON.stringify({
      installedVersion: '1.0.0',
      containerName: 'edc-ijh',
      image: 'ghcr.io/shin482/clinical-data-capture-web-app:1.0.0',
      volume: 'ijh-edc-data',
      port: 3000,
    }), { status: 200 }),
  })
  assert.equal(result.containerName, 'edc-ijh')
})

test('EDC update client permits only loopback and Docker Desktop host Agent URLs', async () => {
  let requestedUrl = ''
  await getUpdateCheck({
    environment: { ...environment, UPDATE_AGENT_URL: 'http://host.docker.internal:3210' },
    fetchImpl: async (url) => {
      requestedUrl = String(url)
      return Response.json({ currentVersion: '1.0.0', latestVersion: '1.0.0', updateAvailable: false })
    },
  })
  assert.equal(requestedUrl, 'http://host.docker.internal:3210/update/check')
  await assert.rejects(
    getUpdateCheck({ environment: { ...environment, UPDATE_AGENT_URL: 'https://example.com' } }),
    UpdateAgentUnavailableError,
  )
  await assert.rejects(
    getUpdateCheck({ environment: { ...environment, UPDATE_AGENT_URL: 'http://host.docker.internal.example.com:3210' } }),
    UpdateAgentUnavailableError,
  )
})

test('EDC update client normalizes Agent errors without leaking secrets', async () => {
  await assert.rejects(
    getUpdateCheck({
      environment,
      fetchImpl: async () => new Response(authToken, { status: 401 }),
    }),
    (error) => error instanceof UpdateAgentUnavailableError
      && !error.message.includes(authToken),
  )
})

test('EDC update client sends only a strict version to POST /update', async () => {
  let request
  const result = await requestUpdate('1.1.0', {
    environment,
    fetchImpl: async (url, options) => {
      request = {
        url: String(url),
        method: options?.method,
        authorization: options?.headers?.Authorization,
        contentType: options?.headers?.['Content-Type'],
        body: options?.body,
      }
      return Response.json({ status: 'updated', previousVersion: '1.0.0', version: '1.1.0' })
    },
  })
  assert.deepEqual(request, {
    url: 'http://127.0.0.1:3210/update',
    method: 'POST',
    authorization: `Bearer ${authToken}`,
    contentType: 'application/json',
    body: JSON.stringify({ version: '1.1.0' }),
  })
  assert.deepEqual(result, { status: 'updated', previousVersion: '1.0.0', version: '1.1.0' })
})

test('EDC update client maps Agent authentication and lock responses safely', async () => {
  await assert.rejects(requestUpdate('1.1.0', {
    environment,
    fetchImpl: async () => new Response(authToken, { status: 401 }),
  }), UpdateAgentAuthenticationError)
  await assert.rejects(requestUpdate('1.1.0', {
    environment,
    fetchImpl: async () => Response.json({ error: 'UPDATE_IN_PROGRESS' }, { status: 409 }),
  }), UpdateAlreadyInProgressError)
})

test('EDC update client maps unavailable responses without response details', async () => {
  await assert.rejects(requestUpdate('1.1.0', {
    environment,
    fetchImpl: async () => new Response(authToken, { status: 503 }),
  }), (error) => error instanceof UpdateAgentUnavailableError && !error.message.includes(authToken))
})
