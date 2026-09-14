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
