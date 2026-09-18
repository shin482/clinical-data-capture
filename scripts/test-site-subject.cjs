const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edc-site-subject-test-'))
process.env.EDC_DATA_DIR = directory
process.env.EDC_SITE = 'IJH'
const resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args)
}
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  }).outputText, filename)
}

async function main() {
  const { NextRequest } = require('next/server')
  const { db, createSubject } = require('../lib/db/index.ts')
  const auth = require('../app/api/admin/auth/route.ts').POST
  for (const [site, password] of [['IJH', '202509021'], ['EWH', '202601040'], ['SCH', '202509006']]) {
    process.env.EDC_SITE = site
    assert.equal((await auth(new Request('http://localhost/api/admin/auth', { method: 'POST', body: JSON.stringify({ password }) }))).status, 200)
    assert.equal((await auth(new Request('http://localhost/api/admin/auth', { method: 'POST', body: JSON.stringify({ password: 'incorrect' }) }))).status, 401)
  }
  process.env.EDC_SITE = 'IJH'

  const subject = createSubject('IJH001')
  const visitsBefore = db().prepare('SELECT id FROM visits WHERE subject_id=? ORDER BY id').all(subject.id).map((row) => row.id)
  db().prepare("INSERT INTO queries(subject_id,timepoint,variable_key,query_type,message) VALUES('IJH001','T1','id','TEST','test')").run()
  db().prepare("INSERT INTO audit_logs(subject_id,action) VALUES('IJH001','VALUE_CHANGE')").run()
  db().prepare("INSERT INTO export_history(user_name,subject_id,file_name) VALUES('IJH','IJH001','before.xlsx')").run()
  const patch = require('../app/api/subjects/[subjectId]/route.ts').PATCH
  const renamed = await patch(new NextRequest('http://localhost/api/subjects/IJH001', { method: 'PATCH', body: JSON.stringify({ subjectId: 'IJH002' }) }), { params: Promise.resolve({ subjectId: 'IJH001' }) })
  assert.equal(renamed.status, 200)
  assert.deepEqual(db().prepare('SELECT id FROM visits WHERE subject_id=? ORDER BY id').all(subject.id).map((row) => row.id), visitsBefore)
  assert.equal(db().prepare("SELECT value FROM clinical_values WHERE subject_id=? AND variable_key='id'").get(subject.id).value, 'IJH002')
  assert.equal(db().prepare("SELECT subject_id FROM queries WHERE query_type='TEST'").get().subject_id, 'IJH002')
  assert.equal(db().prepare("SELECT subject_id FROM export_history WHERE file_name='before.xlsx'").get().subject_id, 'IJH002')
  assert.equal(db().prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE subject_id='IJH001'").get().count, 0)
  createSubject('IJH003')
  const duplicate = await patch(new NextRequest('http://localhost/api/subjects/IJH002', { method: 'PATCH', body: JSON.stringify({ subjectId: 'IJH003' }) }), { params: Promise.resolve({ subjectId: 'IJH002' }) })
  assert.equal(duplicate.status, 409)

  const exported = await require('../app/api/export/route.ts').GET(new NextRequest('http://localhost/api/export'))
  assert.match(exported.headers.get('content-disposition'), /filename="IJH_\d{8}\.xlsx"/)
  const history = db().prepare('SELECT * FROM export_history ORDER BY id DESC LIMIT 1').get()
  assert.equal(history.user_name, 'IJH')
  assert.match(history.file_name, /^IJH_\d{8}\.xlsx$/)
  assert.equal(db().prepare("SELECT modified_by FROM audit_logs WHERE action='EXPORT' ORDER BY id DESC LIMIT 1").get().modified_by, 'IJH')
  db().close()
  console.log('PASS: site passwords, relational subject rename, duplicate rejection, site export identity and filename')
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => console.log(`Test database: ${directory}`))
