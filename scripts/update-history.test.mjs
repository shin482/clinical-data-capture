import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { buildUpdateDiagnostic } from '../lib/update-diagnostic.server.mts'
import { parseUpdateHistoryItem, parseUpdateHistoryPage } from '../lib/update-history.ts'
import { readCoordinatorHistory, readCoordinatorHistoryJob } from '../lib/update-coordinator-api.server.mts'

const base = {
  jobId: 'job-20261022-0000000001', installationId: 'installation-ijh-0001', hospital: 'IJH',
  requestedAt: '2026-10-22T01:00:00.000Z', previousVersion: '2.0.0', targetVersion: '2.0.1',
  state: 'RUNNING', finishedAt: null, errorCode: null, manualReviewRequired: false,
  finalVerificationVerified: false,
  stages: [{ code: 'IDENTITY_CHECK', status: 'SUCCEEDED', at: '2026-10-22T01:00:01.000Z', errorCode: null }],
}
const deps = { historyEnabled: true, expectedHospital: 'IJH', expectedInstallationId: 'installation-ijh-0001' }

test('history is unavailable by default without contacting the Agent', async () => {
  let called = false
  const response = await readCoordinatorHistory(1, 5, { ...deps, historyEnabled: false,
    requestCoordinator: async () => { called = true; throw new Error('must not run') } })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'HISTORY_UNAVAILABLE' })
  assert.equal(called, false)
})

test('history validates scope, sorts newest first, and preserves only recorded stages', async () => {
  const older = { ...base }
  const newer = { ...base, jobId: 'job-20261022-0000000002', requestedAt: '2026-10-22T02:00:00.000Z', stages: [] }
  const response = await readCoordinatorHistory(1, 5, { ...deps, requestCoordinator: async () => ({ status: 200,
    body: { page: 1, pageSize: 5, total: 2, items: [older, newer] } }) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.items.map((item) => item.jobId), [newer.jobId, older.jobId])
  assert.deepEqual(body.items[0].stages, [])
})

test('cross-hospital and cross-installation history is blocked', async () => {
  for (const item of [{ ...base, hospital: 'EWH' }, { ...base, installationId: 'installation-other-1' }]) {
    const response = await readCoordinatorHistory(1, 5, { ...deps, requestCoordinator: async () => ({ status: 200,
      body: { page: 1, pageSize: 5, total: 1, items: [item] } }) })
    assert.equal(response.status, 403)
  }
})

test('missing, malformed, and unknown journal projections fail closed', async () => {
  assert.equal(parseUpdateHistoryPage(null), null)
  assert.equal(parseUpdateHistoryItem({ ...base, requestedAt: 'not-a-date' }), null)
  assert.equal(parseUpdateHistoryItem({ ...base, state: 'SUCCESS' }), null)
  const response = await readCoordinatorHistory(1, 5, { ...deps,
    requestCoordinator: async () => ({ status: 200, body: { page: 1, pageSize: 5, total: 1, items: [{ broken: true }] } }) })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'HISTORY_CORRUPT' })
})

test('COMPLETED without final verification evidence is displayed as UNKNOWN', () => {
  const item = parseUpdateHistoryItem({ ...base, state: 'COMPLETED', finishedAt: '2026-10-22T02:00:00.000Z' })
  assert.equal(item?.state, 'UNKNOWN')
  assert.equal(item?.errorCode, 'COMPLETION_EVIDENCE_MISSING')
  assert.equal(item?.manualReviewRequired, true)
  assert.equal(parseUpdateHistoryItem({ ...base, state: 'COMPLETED', finishedAt: '2026-10-22T02:00:00.000Z', finalVerificationVerified: true })?.state, 'COMPLETED')
})

test('job detail handles not found and scope mismatch without exposing another installation', async () => {
  const missing = await readCoordinatorHistoryJob(base.jobId, { ...deps,
    requestCoordinator: async () => ({ status: 404, body: { error: 'JOB_NOT_FOUND' } }) })
  assert.equal(missing.status, 404)
  const mismatch = await readCoordinatorHistoryJob(base.jobId, { ...deps,
    requestCoordinator: async () => ({ status: 200, body: { ...base, hospital: 'SCH' } }) })
  assert.equal(mismatch.status, 403)
})

test('diagnostic export constructs an allowlist object and excludes sensitive source fields', () => {
  const source = { ...base, subjectId: 'SUBJECT-SECRET', emrReference: 'EMR-SECRET',
    databasePath: 'C:\\sensitive\\patient.sqlite', backupPath: 'C:\\sensitive\\backup.sqlite',
    token: 'TOKEN-SECRET', password: 'PASSWORD-SECRET', stack: 'STACK-SECRET', environment: { SECRET: 'VALUE' } }
  const report = buildUpdateDiagnostic(source, '2026-10-22T03:00:00.000Z')
  assert.ok(report)
  const output = JSON.stringify(report)
  for (const forbidden of ['SUBJECT-SECRET', 'EMR-SECRET', 'patient.sqlite', 'backup.sqlite', 'TOKEN-SECRET', 'PASSWORD-SECRET', 'STACK-SECRET', 'environment']) {
    assert.equal(output.includes(forbidden), false, forbidden)
  }
  assert.deepEqual(Object.keys(report).sort(), ['diagnosticSchemaVersion', 'errorCode', 'finishedAt', 'generatedAt', 'hospital',
    'jobReference', 'manualReviewRequired', 'previousVersion', 'requestedAt', 'stages', 'state', 'targetVersion'].sort())
  assert.notEqual(report.jobReference, base.jobId)
})

test('history and diagnostic routes require admin authentication and remain read-only', () => {
  for (const file of ['app/api/update/history/route.ts', 'app/api/update/jobs/[jobId]/diagnostic/route.ts']) {
    const source = fs.readFileSync(file, 'utf8')
    assert.match(source, /isAdminRequest\(request\)/)
    assert.doesNotMatch(source, /updateEdc|pullImage|restoreDatabase|runDatabaseUpdatePreparation|releaseLock/)
  }
  const root = fs.readFileSync('update-agent/coordinator-production-root.js', 'utf8')
  assert.match(root, /HISTORY_UNAVAILABLE/)
  assert.match(root, /operatingMutationAuthorized: false/)
})

test('History UI distinguishes empty, unavailable and failed states and exports only on explicit click', () => {
  const source = fs.readFileSync('components/clinical/help-modal.tsx', 'utf8')
  assert.match(source, /kind: 'unavailable'/)
  assert.match(source, /확인된 업데이트 기록이 없습니다/)
  assert.match(source, /운영 Journal 조회 기능이 아직 연결되지 않았습니다/)
  assert.match(source, /진단 JSON 내보내기/)
  assert.match(source, /onClick=\{\(\) => void downloadDiagnostic/)
})
