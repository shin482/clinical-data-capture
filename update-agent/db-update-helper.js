const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { prepareDatabaseForUpdate } = require('./db-safety')

const DATABASE_PATH = '/app/data/edc.sqlite'
const BACKUP_DIRECTORY = '/app/data/db-backups'

function loadMigrationRunner() {
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
    },
  ).outputText, filename)
  return require('../lib/db/migration-runner.ts').runMigrations
}

async function runDatabaseUpdatePreparation(options = {}) {
  const dbPath = options.dbPath || DATABASE_PATH
  const backupDirectory = options.backupDirectory || BACKUP_DIRECTORY
  const runMigrations = options.runMigrations || loadMigrationRunner()
  const result = await prepareDatabaseForUpdate(dbPath, backupDirectory, { runMigrations })
  return {
    status: result.status,
    backupCreated: result.backupCreated,
    migrationsApplied: result.migrationsApplied,
    ...(result.error ? { error: result.error } : {}),
  }
}

if (require.main === module) {
  runDatabaseUpdatePreparation()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stdout.write(`${JSON.stringify({
        status: 'recovery_required',
        backupCreated: false,
        migrationsApplied: [],
        error: 'DATABASE_PREPARATION_FAILED',
      })}\n`)
    })
}

module.exports = {
  BACKUP_DIRECTORY,
  DATABASE_PATH,
  runDatabaseUpdatePreparation,
}
