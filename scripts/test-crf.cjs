// Isolated integration checks: never open the workspace's clinical database.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Module = require('node:module')
const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edc-crf-test-'))
process.env.EDC_DATA_DIR = directory
const resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args)
}
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename)
}

async function main() {
  const { db } = require('../lib/db/index.ts')
  require('../lib/db/seed.ts')
  const { GET, POST } = require('../app/api/subjects/[subjectId]/route.ts')
  const { NextRequest } = require('next/server')
  const context = { params: Promise.resolve({ subjectId: 'CRF_TEST' }) }
  const save = (data) => POST(new NextRequest('http://localhost/api/subjects/CRF_TEST', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timepoint: 'T2', variableKey: 'occl', ...data }),
  }), context)
  const open = () => db().prepare("SELECT * FROM queries WHERE status='OPEN'").all()
  assert.equal((await save({ value: '8' })).status, 200)
  assert.equal(open()[0].query_type, 'CATEGORY')
  assert.equal((await save({ value: '99' })).status, 200)
  assert.equal(open().length, 0, 'Existing Unknown 99 remains valid')
  await save({ value: null, missingReason: 'NOT_DONE' })
  const detail = await (await GET(new NextRequest('http://localhost'), context)).json()
  assert.equal(detail.values[0].value, null)
  assert.equal(detail.values[0].missingReason, 'NOT_DONE')
  assert.equal(open().length, 0)
  const exported = await require('../app/api/export/route.ts').GET(new NextRequest('http://localhost/api/export?subject=CRF_TEST'))
  const xlsx = require('xlsx')
  const workbook = xlsx.read(Buffer.from(await exported.arrayBuffer()))
  assert.equal(xlsx.utils.sheet_to_json(workbook.Sheets.Data)[0].occl_t2_missing_reason, 'NOT_DONE')
  const helpers = require('../lib/clinical-utils.ts')
  assert.deepEqual(helpers.sortSubjectsNumerically(['10', '2', '1', '3'].map((id) => ({ subject_id: 'Subject ' + id }))).map((s) => s.subject_id), ['Subject 1', 'Subject 2', 'Subject 3', 'Subject 10'])
  assert.equal(helpers.getSubjectQueryStatus([{ status: 'OPEN' }, { status: 'RESOLVED' }]), 'OPEN')
  assert.equal(helpers.getSubjectQueryStatus([]), 'RESOLVED')
  assert.equal(helpers.getSubjectQueryStatus([{ status: 'RESOLVED' }]), 'RESOLVED')
  const auth = require('../app/api/admin/auth/route.ts').POST
  for (const [password, expected] of [['incorrect', 401], ['123456', 200]]) {
    assert.equal((await auth(new Request('http://localhost/api/admin/auth', { method: 'POST', body: JSON.stringify({ password }) }))).status, expected)
  }
  assert.equal((await (await require('../app/api/admin/status/route.ts').GET()).json()).isAdmin, false)
  const exportApi = require('../app/api/export/route.ts').GET
  const scoped = await exportApi(new NextRequest('http://localhost/api/export?subject=CRF_TEST&visit=T1'))
  const scopedBook = xlsx.read(Buffer.from(await scoped.arrayBuffer()))
  assert.equal(xlsx.utils.sheet_to_json(scopedBook.Sheets.Data)[0].occl_t2_missing_reason, undefined)
  const history = await (await exportApi(new NextRequest('http://localhost/api/export?history=1'))).json()
  assert.equal(history[0].visit, 'T1')
  assert.equal(history[0].subject_id, 'CRF_TEST')
  assert.equal(history[0].status, 'Completed')
  assert.ok(history[0].id > history[1].id)
  const beforeInvalid = history.length
  assert.equal((await exportApi(new NextRequest('http://localhost/api/export?visit=T9'))).status, 400)
  assert.equal((await (await exportApi(new NextRequest('http://localhost/api/export?history=1'))).json()).length, beforeInvalid)
  const auditApi = require('../app/api/audit/route.ts').GET
  const auditRows = await auditApi(new NextRequest('http://localhost/api/audit?subjectId=CRF_TEST&visit=T1&action=EXPORT&user=Minji&from=2000-01-01&to=2100-01-01')).json()
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0].action, 'EXPORT')
  console.log('PASS: natural sorting, derived status, password validation, unauthenticated status, scoped export, persistent newest-first history, invalid export exclusion, combined audit filters')
  assert.equal((await save({ value: '1', missingReason: 'NOT_DONE' })).status, 400)
  assert.equal((await save({ value: null, missingReason: 'INVALID' })).status, 400)
  assert.equal((await save({ timepoint: 'T4', value: '1' })).status, 400)
  await save({ value: '' })
  assert.equal(open()[0].query_type, 'MISSING', 'Clearing a reason restores required validation')
  await save({ value: '1' })
  assert.equal(open().length, 0)
  await save({ variableKey: 'occl_no', value: '11' })
  assert.equal(open()[0].query_type, 'RANGE')
  await save({ variableKey: 'occl_no', value: '5' })
  assert.equal(open().length, 0)
  await save({ variableKey: 'vdt', value: '2026-09-17' })
  assert.equal(db().prepare("SELECT visit_date FROM visits WHERE timepoint='T2'").get().visit_date, '2026-09-17')
  const audits = db().prepare('SELECT * FROM audit_logs').all()
  assert.ok(audits.some((row) => row.new_value.includes('NOT_DONE')))
  const { categoryChoices, inputGuide } = require('../lib/crf-metadata.ts')
  const rule = { variableKey: 'occl', dataType: 'categorical', categoryOptions: '0=없음|1=있음', allowUnknown99: true, inputGuide: '' }
  assert.deepEqual(categoryChoices(rule).map((choice) => choice.code), ['0', '1', '99'])
  assert.match(inputGuide(rule), /1=있음/)
  db().close()
  console.log('PASS: category / 99, missing round-trip, conflict rejection, query resolution, range, visit date, audit, export, metadata')
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  // Keep the isolated directory for inspection; no recursive cleanup of user paths.
  console.log(`Test database: ${directory}`)
})
