const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const Module = require('node:module')
const ts = require('typescript')
const Database = require('better-sqlite3')
const XLSX = require('xlsx')
const { readSource, compare } = require('./validate-variables.cjs')
const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edc-schema-test-'))
process.env.EDC_DATA_DIR = directory
process.env.EDC_STUDY_VARIABLES_PATH = path.join(directory, 'study-variables.json')
fs.copyFileSync(path.join(root, 'lib', 'study-variables.json'), process.env.EDC_STUDY_VARIABLES_PATH)
const resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args) }
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename)

async function main() {
  const source = readSource()
  const schema = require('../lib/study-variables.json')
  const legacy = new Database(path.join(directory, 'edc.sqlite'))
  legacy.exec(fs.readFileSync(path.join(root, 'lib/db/index.ts'), 'utf8').match(/database.exec\(`([\s\S]*?)`\)/)[1])
  legacy.exec('ALTER TABLE clinical_values ADD COLUMN missing_reason TEXT')
  const insert = legacy.prepare('INSERT INTO variable_definitions(variable_key,label,section,data_type) VALUES(?,?,?,?)')
  for (const row of schema) insert.run(row.variableKey === 'pad' ? 'pvd' : row.variableKey === 'amp_dt' ? 'ampdt_lt' : row.variableKey, 'Old label', row.section, row.dataType)
  insert.run('dfu_wnd', 'Legacy ulcer flag', 'Legacy', 'categorical')
  legacy.exec("INSERT INTO subjects(id,subject_id) VALUES(1,'Subject 2'); INSERT INTO visits(id,subject_id,timepoint) VALUES(1,1,'T1'),(2,1,'T2'),(3,1,'T3')")
  for (const [key, value, visit] of [['pvd', '1', 1], ['ampdt_lt', '2026-01-15', 2], ['dfu_wnd', '1', 1], ['sex', '0', 2]]) {
    legacy.prepare('INSERT INTO clinical_values(subject_id,visit_id,variable_key,value) VALUES(1,?,?,?)').run(visit, key, value)
    legacy.prepare("INSERT INTO queries(subject_id,visit_id,timepoint,variable_key,query_type,message,status) VALUES('Subject 2',?,?,?,'REVIEW','Confirm source','OPEN')").run(visit, `T${visit}`, key)
    legacy.prepare("INSERT INTO audit_logs(subject_id,timepoint,variable_key,new_value,modified_by) VALUES('Subject 2',?,?,?,'tester')").run(`T${visit}`, key, value)
  }
  legacy.close()

  const { db } = require('../lib/db/index.ts')
  const { migrateStudySchema } = require('../lib/db/study-migration.ts')
  const { NextRequest } = require('next/server')
  const variablesApi = require('../app/api/variables/route.ts')
  const variables = await variablesApi.GET().json()
  assert.equal(variables.length, 71)
  assert.deepEqual(compare(source, variables), { missing: [], unexpected: [], mismatches: [] })
  assert.equal(db().prepare('SELECT count(*) AS n FROM clinical_values').get().n, 5)
  assert.equal(db().prepare("SELECT value FROM clinical_values WHERE variable_key='id'").get().value, 'Subject 2')
  assert.equal(db().prepare("SELECT value FROM clinical_values WHERE variable_key='pad'").get().value, '1')
  assert.equal(db().prepare("SELECT value FROM clinical_values WHERE variable_key='amp_dt'").get().value, '2026-01-15')
  assert.equal(db().prepare("SELECT study_active FROM variable_definitions WHERE variable_key='dfu_wnd'").get().study_active, 0)
  assert.equal(db().prepare("SELECT status FROM queries WHERE variable_key='dfu_wnd'").get().status, 'ARCHIVED')
  assert.equal(db().prepare("SELECT status FROM queries WHERE variable_key='sex'").get().status, 'ARCHIVED')
  assert.ok(db().prepare("SELECT * FROM schema_migration_archive WHERE table_name='clinical_values'").all().length === 4)
  const archivedCount = db().prepare('SELECT count(*) AS n FROM schema_migration_archive').get().n
  migrateStudySchema(db())
  assert.equal(db().prepare('SELECT count(*) AS n FROM schema_migration_archive').get().n, archivedCount, 'Migration is idempotent')

  const queries = await require('../app/api/queries/route.ts').GET().json()
  for (const key of ['pad', 'amp_dt']) {
    const query = queries.find((row) => row.variable_key === key)
    const definition = variables.find((row) => row.variableKey === key)
    assert.equal(query.variable_name, definition.label)
    assert.equal(query.form_name, definition.section)
    assert.ok(query.timepoint && query.subject_id)
  }
  const audit = require('../app/api/audit/route.ts').GET
  const renamedAudit = await audit(new NextRequest('http://localhost/api/audit?variable=amp_dt')).json()
  assert.equal(renamedAudit[0].variable_key, 'ampdt_lt', 'Old audit text remains immutable and searchable by new key')
  assert.equal((await audit(new NextRequest('http://localhost/api/audit?variable=dfu_wnd')).json()).length, 1)

  const detail = require('../app/api/subjects/[subjectId]/route.ts')
  const context = { params: Promise.resolve({ subjectId: 'Subject 2' }) }
  for (const row of source.filter((row) => row.timepointT1 && !row.timepointT2 && !row.timepointT3)) {
    for (const visit of ['T2', 'T3']) {
      const response = await detail.POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ variableKey: row.variableKey, timepoint: visit, value: '0' }) }), context)
      assert.equal(response.status, 400, `${row.variableKey} rejects ${visit}`)
    }
  }
  const { getVisitVariables } = require('../lib/visit-rules.ts')
  assert.equal(getVisitVariables(variables, 'T1').length, 71)
  assert.equal(getVisitVariables(variables, 'T2').length, source.filter((row) => row.timepointT2).length)
  assert.equal(getVisitVariables(variables, 'T3').length, source.filter((row) => row.timepointT3).length)
  const { getSubjectVisitProgress } = require('../lib/data-entry.ts')
  assert.deepEqual(getSubjectVisitProgress('S', 'T2', variables, []), getSubjectVisitProgress('S', 'T2', variables, [{ variableKey: 'sex', value: '0' }]))
  const neutral = variables.map((row) => row.variableKey === 'dfu_ex_amt' ? { ...row, timepointT1: false, timepointT2: false, timepointT3: false } : row)
  assert.equal(neutral.length, 71)
  assert.ok(!getVisitVariables(neutral, 'T1').some((row) => row.variableKey === 'dfu_ex_amt'))

  const response = await require('../app/api/export/route.ts').GET(new NextRequest('http://localhost/api/export?subject=Subject%202'))
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()))
  assert.deepEqual(workbook.SheetNames, ['data', 'Variable Dictionary'])
  const dictionary = XLSX.utils.sheet_to_json(workbook.Sheets['Variable Dictionary'])
  assert.equal(dictionary.length, 71)
  assert.deepEqual(compare(source, dictionary.map((row) => ({ variableKey: row.variable_key, label: row.label, timepointT1: !!row.timepoint_t1, timepointT2: !!row.timepoint_t2, timepointT3: !!row.timepoint_t3 }))), { missing: [], unexpected: [], mismatches: [] })
  const data = XLSX.utils.sheet_to_json(workbook.Sheets.data)[0]
  assert.equal(data.pad_t1, '1')
  assert.equal(data.amp_dt_t2, 'NA', 'Stored child value exports as NA while its parent condition is inactive')
  assert.equal(data.dfu_wnd_t1, undefined)
  assert.equal(data.sex_t2, undefined)
  const patch = require('../app/api/variables/[variableKey]/route.ts').PATCH
  const ruleContext = { params: Promise.resolve({ variableKey: 'sex' }) }
  assert.equal((await patch(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ inputGuide: 'Check chart' }) }), ruleContext)).status, 200)
  assert.equal(require(process.env.EDC_STUDY_VARIABLES_PATH).find((row) => row.variableKey === 'sex').inputGuide, 'Check chart')
  assert.equal((await patch(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ label: 'Wrong label' }) }), ruleContext)).status, 409)
  assert.equal((await patch(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ timepointT2: true }) }), ruleContext)).status, 409)
  assert.equal((await variablesApi.POST()).status, 409)
  db().close()
  console.log('PASS: source/schema/API/dictionary=71; metadata exact; migration preserves values, archives obsolete definitions and retains audit; all 16 T1-only restrictions; query navigation references; Rule Master validation edits; 2-sheet export; idempotency')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
