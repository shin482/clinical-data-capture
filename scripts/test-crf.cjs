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
  assert.equal(xlsx.utils.sheet_to_json(workbook.Sheets.data)[0].occl_t2_missing_reason, 'NOT_DONE')
  assert.deepEqual(workbook.SheetNames, ['data', 'Variable Dictionary'])
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
  assert.equal(xlsx.utils.sheet_to_json(scopedBook.Sheets.data)[0].occl_t2_missing_reason, undefined)
  assert.deepEqual(scopedBook.SheetNames, ['data', 'Variable Dictionary'])
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
  const { isVisitComplete, getDataEntrySummary } = require('../lib/data-entry.ts')
  const { rowToVariable, ensureSubject } = require('../lib/db/index.ts')
  const baseRule = rowToVariable({ variable_key: 'required', label: 'Required', section: 'Test', data_type: 'character', enabled: 1, timepoint_t1: 1, timepoint_t2: 1, timepoint_t3: 1 })
  const value = (variableKey, value, missingReason) => ({ variableKey, value, missingReason })
  for (const blank of ['', '  ', null, undefined]) assert.equal(isVisitComplete('A', 'T1', [baseRule], [value('required', blank)]), false)
  assert.equal(isVisitComplete('A', 'T1', [baseRule], [value('required', '0')]), true)
  assert.equal(isVisitComplete('A', 'T1', [baseRule], [value('required', null, 'NOT_DONE')]), true)
  assert.equal(isVisitComplete('A', 'T1', [baseRule], [value('required', null, 'INVALID')]), false)
  assert.equal(isVisitComplete('A', 'T1', [{ ...baseRule, allowBlank: true }], []), true)
  assert.equal(isVisitComplete('A', 'T1', [baseRule, { ...baseRule, variableKey: 'disabled', enabled: false }], [value('required', '0')]), true)
  assert.equal(isVisitComplete('A', 'T1', [baseRule, { ...baseRule, variableKey: 't2only', timepointT1: false }], [value('required', '0')]), true)
  const child = { ...baseRule, variableKey: 'child', parents: 'required', activeValues: '1' }
  assert.equal(isVisitComplete('A', 'T1', [baseRule, child], [value('required', '0')]), true)
  assert.equal(isVisitComplete('A', 'T1', [baseRule, child], [value('required', '1')]), false)
  assert.equal(isVisitComplete('A', 'T1', [baseRule, child], [value('required', '1'), value('child', 'entered')]), true)
  const groupChild = { ...child, parents: '', groupParent: 'required', groupActiveValue: '1' }
  assert.equal(isVisitComplete('A', 'T1', [baseRule, groupChild], [value('required', '0')]), true)
  assert.equal(isVisitComplete('A', 'T1', [baseRule, groupChild], [value('required', '1')]), false)
  assert.equal(isVisitComplete('A', 'T1', [{ ...baseRule, dataType: 'id' }], []), true)
  const emptySummary = getDataEntrySummary([])
  assert.equal(emptySummary.complete + emptySummary.incomplete, 0)
  assert.ok(emptySummary.visits.every((v) => v.percentage === 0))

  // Exercise the real subjects endpoint against saved rows, independently of queries.
  const completeSubject = ensureSubject('COMPLETE_TEST')
  ensureSubject('EMPTY_TEST')
  const definitions = db().prepare('SELECT * FROM variable_definitions WHERE enabled=1 AND allow_blank=0').all()
  const insertValue = db().prepare('INSERT INTO clinical_values(subject_id,visit_id,variable_key,value) VALUES(?,?,?,?)')
  db().transaction(() => {
    for (const visit of db().prepare('SELECT * FROM visits WHERE subject_id=?').all(completeSubject.id)) {
      for (const rule of definitions) {
        if (rule.data_type !== 'id') insertValue.run(completeSubject.id, visit.id, rule.variable_key, '0')
      }
    }
  })()
  const subjectsApi = require('../app/api/subjects/route.ts').GET
  let subjectsData = await subjectsApi().json()
  assert.deepEqual(subjectsData.find((s) => s.subject_id === 'COMPLETE_TEST').visit_completion, { T1: true, T2: true, T3: true })
  assert.deepEqual(subjectsData.find((s) => s.subject_id === 'EMPTY_TEST').visit_completion, { T1: false, T2: false, T3: false })
  let summary = getDataEntrySummary(subjectsData)
  assert.equal(summary.complete, 1)
  assert.equal(summary.complete + summary.incomplete, summary.total)
  assert.deepEqual(summary.visits.map((v) => v.completed), [1, 1, 1])
  db().prepare("UPDATE clinical_values SET value='' WHERE subject_id=? AND variable_key='occl' AND visit_id=(SELECT id FROM visits WHERE subject_id=? AND timepoint='T2')").run(completeSubject.id, completeSubject.id)
  subjectsData = await subjectsApi().json()
  summary = getDataEntrySummary(subjectsData)
  assert.equal(summary.complete, 0)
  assert.equal(summary.incomplete, summary.total)
  assert.deepEqual(summary.visits.map((v) => v.completed), [1, 0, 1])
  assert.equal(summary.visits[0].percentage, Math.round(100 / summary.total))

  const { readPageAccess, pageSessionKeys } = require('../lib/page-access.ts')
  const session = new Map([['edc-admin', 'true']])
  const storage = { getItem: (key) => session.get(key) || null }
  assert.deepEqual(readPageAccess(storage), { 'Rule Master': false, 'Audit Trail': false })
  session.set(pageSessionKeys['Rule Master'], 'true')
  assert.deepEqual(readPageAccess(storage), { 'Rule Master': true, 'Audit Trail': false })
  session.clear(); session.set(pageSessionKeys['Audit Trail'], 'true')
  assert.deepEqual(readPageAccess(storage), { 'Rule Master': false, 'Audit Trail': true })
  session.clear()
  assert.deepEqual(readPageAccess(storage), { 'Rule Master': false, 'Audit Trail': false })
  console.log('PASS: exact XLSX sheet order, required/optional/conditional/visit-specific completion, missing reasons, persisted dashboard counts and progress, independent page sessions')
  db().close()
  console.log('PASS: category / 99, missing round-trip, conflict rejection, query resolution, range, visit date, audit, export, metadata')
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  // Keep the isolated directory for inspection; no recursive cleanup of user paths.
  console.log(`Test database: ${directory}`)
})
