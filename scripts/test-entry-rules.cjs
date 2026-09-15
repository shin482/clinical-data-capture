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
  const { db, rowToVariable } = require('../lib/db/index.ts')
  const { isFieldActive, derivedRules } = require('../lib/entry-rules.ts')
  const rules = require('../lib/study-variables.json')
  for (const rule of rules.filter(r => r.parents || r.groupParent)) {
    const parent = rule.parents || rule.groupParent
    assert.equal(isFieldActive(rule, () => ''), false)
    assert.equal(isFieldActive(rule, () => '1'), true)
    assert.equal(isFieldActive(rule, () => '0'), ['*', '!=99'].includes(rule.activeValues))
    assert.equal(isFieldActive(rule, () => '99'), rule.activeValues === '*')
  }
  assert.equal(rules.filter(r => r.groupParent === 'lab').length, 14)
  const { GET, POST } = require('../app/api/subjects/[subjectId]/route.ts')
  const { NextRequest } = require('next/server')
  const createSubjectApi = require('../app/api/subjects/route.ts').POST
  const createRequest = () => new NextRequest('http://localhost/api/subjects', { method: 'POST', body: JSON.stringify({ subjectId: 'UNIQUE_TEST' }) })
  assert.equal((await createSubjectApi(createRequest())).status, 201)
  assert.equal((await createSubjectApi(createRequest())).status, 409)
  assert.equal(db().prepare("SELECT count(*) n FROM subjects WHERE subject_id='UNIQUE_TEST'").get().n, 1)
  assert.equal(db().prepare("SELECT count(*) n FROM queries WHERE subject_id='UNIQUE_TEST' AND variable_key='vdt' AND status='OPEN'").get().n, 3)
  assert.equal(db().prepare("SELECT value FROM clinical_values WHERE variable_key='id' AND subject_id=(SELECT id FROM subjects WHERE subject_id='UNIQUE_TEST')").get().value, 'UNIQUE_TEST')
  const context = { params: Promise.resolve({ subjectId: 'DERIVED_TEST' }) }
  const save = (variableKey, value) => POST(new NextRequest('http://localhost/api/subjects/DERIVED_TEST', { method: 'POST', body: JSON.stringify({ timepoint: 'T1', variableKey, value }) }), context)
  const valueOf = async key => (await (await GET(new NextRequest('http://localhost'), context)).json()).values.find(v => v.variableKey === key)?.value
  const exportApi = require('../app/api/export/route.ts').GET
  const XLSX = require('xlsx')
  const exportedRows = async () => { const response = await exportApi(new NextRequest('http://localhost/api/export')); return XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(await response.arrayBuffer())).Sheets.data, { header: 1 }) }
  const expected = ['SUBJECT_ID', ...rules.flatMap(r => ['T1','T2','T3'].filter(v => r['timepoint'+v]).map(v => r.variableKey+'_'+v.toLowerCase()))]
  assert.deepEqual((await exportedRows())[0], expected, 'Empty export includes all schema headers')
  for (const key of derivedRules.find(rule => rule.target === 'snb_score').sources) await save(key, '1')
  assert.equal(await valueOf('snb_score'), '6')
  assert.equal(db().prepare("SELECT value FROM clinical_values WHERE variable_key='snb_score'").get().value, '6')
  await save('snb_site', '0'); assert.equal(await valueOf('snb_score'), '5')
  await save('snb_site', ''); assert.equal(await valueOf('snb_score'), '')
  await save('snb_site', '99'); assert.equal(await valueOf('snb_score'), '')
  assert.equal((await save('snb_score', '4')).status, 400)
  await save('hei', '170'); await save('wei', '68')
  assert.equal(await valueOf('bmi'), '23.5')
  assert.equal(db().prepare("SELECT value FROM clinical_values WHERE variable_key='bmi'").get().value, '23.5')
  assert.equal((await save('bmi', '20')).status, 400)
  await save('snb_site', '1')
  await save('dth', '1'); await save('dthdt', '2026-01-01'); await save('dth', '0')
  assert.equal(await valueOf('dthdt'), '2026-01-01', 'Inactive child retained')
  await save('dthdt', '')
  assert.equal(db().prepare("SELECT count(*) n FROM queries WHERE variable_key='dthdt' AND status='OPEN'").get().n, 0)
  const rows = await exportedRows()
  assert.deepEqual(rows[0], expected)
  assert.equal(rows[1][expected.indexOf('snb_score_t1')], '6')
  assert.equal(rows[1][expected.indexOf('crp_t1')], 'NA', 'Blank child is NA while its parent is inactive')
  await save('lab', '1')
  let transformed = await exportedRows()
  let subjectRow = transformed.find((row) => row[0] === 'DERIVED_TEST')
  assert.equal(subjectRow[expected.indexOf('crp_t1')], '99', 'Active blank child is 99')
  await save('crp', '12.5')
  transformed = await exportedRows()
  subjectRow = transformed.find((row) => row[0] === 'DERIVED_TEST')
  assert.equal(subjectRow[expected.indexOf('crp_t1')], '12.5', 'Active entered value is preserved')
  await save('lab', '0')
  transformed = await exportedRows()
  subjectRow = transformed.find((row) => row[0] === 'DERIVED_TEST')
  assert.equal(subjectRow[expected.indexOf('crp_t1')], 'NA', 'Inactive child is NA even if an old value remains stored')
  db().prepare("UPDATE variable_definitions SET enabled=0 WHERE variable_key='crp'").run()
  transformed = await exportedRows()
  subjectRow = transformed.find((row) => row[0] === 'DERIVED_TEST')
  assert.equal(subjectRow[expected.indexOf('crp_t1')], 'NA')
  assert.equal(subjectRow[expected.indexOf('sex_t1')], '99')
  console.log('PASS: shared UI/export activation, inactive child=NA, active blank=99, entered value preserved, disabled definition=NA, BMI/SINBAD recomputation/read-only')
  db().close()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
