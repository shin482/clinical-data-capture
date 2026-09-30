const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')
const ts = require('typescript')
const Database = require('better-sqlite3')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } },
).outputText, filename)

const { runMigrations } = require('../lib/db/migration-runner.ts')
const { RESEARCH_TABLES, backupDatabase, verifyDatabase } = require('./db-backup')
const { prepareDatabaseForUpdate } = require('./db-safety')
const { runDatabaseUpdatePreparation } = require('./db-update-helper')

const temporaryDirectories = []

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop()
    if (directory.startsWith(os.tmpdir())) fs.rmSync(directory, { recursive: true, force: true })
  }
})

function makeTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edc-db-safety-'))
  temporaryDirectories.push(directory)
  const dbPath = path.join(directory, 'edc.sqlite')
  const database = new Database(dbPath)
  database.exec(`
    CREATE TABLE subjects (id INTEGER PRIMARY KEY, subject_id TEXT NOT NULL);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL, timepoint TEXT NOT NULL);
    CREATE TABLE variable_definitions (id INTEGER PRIMARY KEY, variable_key TEXT NOT NULL);
    CREATE TABLE clinical_values (id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL, visit_id INTEGER NOT NULL, variable_key TEXT NOT NULL, value TEXT);
    CREATE TABLE queries (id INTEGER PRIMARY KEY, subject_id TEXT NOT NULL, variable_key TEXT NOT NULL);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, action TEXT NOT NULL);
    CREATE TABLE export_history (id INTEGER PRIMARY KEY, file_name TEXT NOT NULL);
    CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE schema_migration_archive (id INTEGER PRIMARY KEY, version TEXT NOT NULL, table_name TEXT NOT NULL, original_row TEXT NOT NULL);
    INSERT INTO subjects VALUES (1, 'TEST-001');
    INSERT INTO visits VALUES (1, 1, 'T1');
    INSERT INTO variable_definitions VALUES (1, 'test_var');
    INSERT INTO clinical_values VALUES (1, 1, 1, 'test_var', 'preserved');
    INSERT INTO queries VALUES (1, 'TEST-001', 'test_var');
    INSERT INTO audit_logs VALUES (1, 'VALUE_CHANGE');
    INSERT INTO export_history VALUES (1, 'test.xlsx');
    INSERT INTO schema_migrations(version) VALUES ('test-baseline');
    INSERT INTO schema_migration_archive VALUES (1, 'test-baseline', 'variable_definitions', '{}');
  `)
  database.pragma('journal_mode = WAL')
  database.close()
  return { directory, dbPath, backupDirectory: path.join(directory, 'backups') }
}

test('online backup is valid and preserves research table row counts', async () => {
  const { dbPath, backupDirectory } = makeTestDatabase()
  const before = verifyDatabase(dbPath)
  const result = await backupDatabase(dbPath, backupDirectory, {
    now: () => new Date('2026-09-23T13:00:00.000Z'),
  })
  assert.equal(path.basename(result.backupPath), 'edc.sqlite.backup-20260923-130000.000')
  assert.ok(fs.statSync(result.backupPath).size > 0)
  assert.equal(verifyDatabase(result.backupPath).integrity, 'ok')
  assert.deepEqual(result.sourceCounts, before.rowCounts)
  assert.deepEqual(result.backupCounts, before.rowCounts)
  assert.deepEqual(Object.keys(result.backupCounts), [...RESEARCH_TABLES])
})

test('migration runner applies only a pending migration and preserves research data', () => {
  const { dbPath } = makeTestDatabase()
  const migration = (database) => {
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get('test-additive-1')) return
    database.exec('CREATE TABLE test_additive_marker (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    database.prepare('INSERT INTO test_additive_marker(value) VALUES(?)').run('applied')
    database.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run('test-additive-1')
  }
  assert.deepEqual(runMigrations(dbPath, [migration]), { migrationsApplied: ['test-additive-1'] })
  assert.deepEqual(runMigrations(dbPath, [migration]), { migrationsApplied: [] })
  const database = new Database(dbPath, { readonly: true })
  try {
    assert.equal(database.prepare('SELECT value FROM clinical_values').get().value, 'preserved')
    assert.equal(database.prepare('SELECT count(*) AS count FROM schema_migrations WHERE version=?').get('test-additive-1').count, 1)
  } finally { database.close() }
})

test('migration failure restores the online backup and verifies integrity', async () => {
  const { dbPath, backupDirectory } = makeTestDatabase()
  const result = await prepareDatabaseForUpdate(dbPath, backupDirectory, {
    runMigrations: async (file) => {
      const database = new Database(file)
      database.prepare("UPDATE clinical_values SET value='damaged'").run()
      database.close()
      throw new Error('intentional test migration failure')
    },
  })
  assert.equal(result.status, 'recovered')
  assert.equal(result.error, 'DATABASE_MIGRATION_FAILED')
  assert.ok(fs.existsSync(result.backupPath))
  assert.equal(verifyDatabase(dbPath).integrity, 'ok')
  const database = new Database(dbPath, { readonly: true })
  try { assert.equal(database.prepare('SELECT value FROM clinical_values').get().value, 'preserved') }
  finally { database.close() }
})

test('recovery failure stops with recovery_required and does not retry', async () => {
  const { dbPath, backupDirectory } = makeTestDatabase()
  let recoveryAttempts = 0
  const result = await prepareDatabaseForUpdate(dbPath, backupDirectory, {
    runMigrations: async () => { throw new Error('intentional migration failure') },
    restoreDatabase: async () => { recoveryAttempts += 1; throw new Error('intentional recovery failure') },
  })
  assert.equal(result.status, 'recovery_required')
  assert.equal(result.error, 'DATABASE_RECOVERY_FAILED')
  assert.equal(recoveryAttempts, 1)
})

test('DB safety code has no template, Docker, or production resource dependency', () => {
  const sources = ['db-backup.js', 'db-safety.js']
    .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8'))
    .join('\n')
  const migrationSource = fs.readFileSync(path.join(__dirname, '../lib/db/migration-runner.ts'), 'utf8')
  assert.doesNotMatch(`${sources}\n${migrationSource}`, /edc-hospital-template\.sqlite/)
  assert.doesNotMatch(sources, /docker\s+volume\s+(rm|prune)|edc-ijh|ijh-edc-data/)
  assert.doesNotMatch(sources, /child_process|execFile|spawn\s*\(/)
})

test('fixed-purpose helper returns a sanitized result without filesystem paths', async () => {
  const { dbPath, backupDirectory } = makeTestDatabase()
  const result = await runDatabaseUpdatePreparation({
    dbPath,
    backupDirectory,
    runMigrations: async () => ({ migrationsApplied: [] }),
  })
  assert.deepEqual(result, { status: 'ready', backupCreated: true, migrationsApplied: [] })
  assert.equal(JSON.stringify(result).includes(dbPath), false)
  assert.equal(fs.readdirSync(backupDirectory).length, 1)
})
