const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const RESEARCH_TABLES = Object.freeze([
  'subjects',
  'visits',
  'clinical_values',
  'queries',
  'audit_logs',
  'export_history',
  'variable_definitions',
  'schema_migrations',
])

class DatabaseSafetyError extends Error {
  constructor(code) {
    super(code)
    this.name = 'DatabaseSafetyError'
    this.code = code
  }
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '')
}

function openExistingDatabase(dbPath, options = {}) {
  if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
    throw new DatabaseSafetyError('DATABASE_NOT_FOUND')
  }
  return new Database(dbPath, { readonly: options.readonly !== false, fileMustExist: true })
}

function assertIntegrity(database) {
  const rows = database.pragma('integrity_check')
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].integrity_check !== 'ok') {
    throw new DatabaseSafetyError('DATABASE_INTEGRITY_CHECK_FAILED')
  }
}

function readRowCounts(database, tables = RESEARCH_TABLES) {
  const existing = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
  const counts = {}
  for (const table of tables) {
    if (!existing.has(table)) throw new DatabaseSafetyError('DATABASE_SCHEMA_INCOMPLETE')
    counts[table] = database.prepare(`SELECT count(*) AS count FROM "${table}"`).get().count
  }
  return counts
}

function assertSameCounts(sourceCounts, backupCounts) {
  for (const table of RESEARCH_TABLES) {
    if (sourceCounts[table] !== backupCounts[table]) {
      throw new DatabaseSafetyError('DATABASE_BACKUP_ROW_COUNT_MISMATCH')
    }
  }
}

async function backupDatabase(dbPath, backupDirectory, options = {}) {
  const sourcePath = path.resolve(dbPath)
  const destinationDirectory = path.resolve(backupDirectory)
  fs.mkdirSync(destinationDirectory, { recursive: true })
  const backupPath = path.join(destinationDirectory, `edc.sqlite.backup-${timestamp(options.now?.())}`)
  if (fs.existsSync(backupPath)) throw new DatabaseSafetyError('DATABASE_BACKUP_ALREADY_EXISTS')

  const source = openExistingDatabase(sourcePath)
  try {
    assertIntegrity(source)
    const sourceCounts = readRowCounts(source)
    await source.backup(backupPath)
    if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size <= 0) {
      throw new DatabaseSafetyError('DATABASE_BACKUP_NOT_CREATED')
    }
    const backup = openExistingDatabase(backupPath, { readonly: false })
    try {
      backup.pragma('wal_checkpoint(TRUNCATE)')
      backup.pragma('journal_mode = DELETE')
      assertIntegrity(backup)
      const backupCounts = readRowCounts(backup)
      assertSameCounts(sourceCounts, backupCounts)
      return { backupPath, sourceCounts, backupCounts }
    } finally {
      backup.close()
    }
  } finally {
    source.close()
  }
}

function verifyDatabase(dbPath) {
  const database = openExistingDatabase(path.resolve(dbPath))
  try {
    assertIntegrity(database)
    return { integrity: 'ok', rowCounts: readRowCounts(database) }
  } finally {
    database.close()
  }
}

module.exports = {
  DatabaseSafetyError,
  RESEARCH_TABLES,
  backupDatabase,
  verifyDatabase,
}
