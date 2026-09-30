const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { backupDatabase, verifyDatabase } = require('./db-backup')

async function restoreDatabase(dbPath, backupPath, options = {}) {
  const resolvedDatabase = path.resolve(dbPath)
  const resolvedBackup = path.resolve(backupPath)
  const suffix = options.suffix || Date.now()
  const restoredPath = `${resolvedDatabase}.restored-${suffix}`
  const failedPath = `${resolvedDatabase}.migration-failed-${suffix}`
  const recoveryFailedPath = `${resolvedDatabase}.recovery-failed-${suffix}`
  const expected = verifyDatabase(resolvedBackup)
  const backup = new Database(resolvedBackup, { readonly: true, fileMustExist: true })
  try {
    await backup.backup(restoredPath)
  } finally {
    backup.close()
  }
  const restored = verifyDatabase(restoredPath)
  if (JSON.stringify(restored.rowCounts) !== JSON.stringify(expected.rowCounts)) {
    throw new Error('Restored database row counts do not match the backup')
  }

  fs.renameSync(resolvedDatabase, failedPath)
  for (const sidecar of ['-wal', '-shm']) {
    if (fs.existsSync(`${resolvedDatabase}${sidecar}`)) {
      fs.renameSync(`${resolvedDatabase}${sidecar}`, `${failedPath}${sidecar}`)
    }
  }
  try {
    fs.renameSync(restoredPath, resolvedDatabase)
    const verified = verifyDatabase(resolvedDatabase)
    if (JSON.stringify(verified.rowCounts) !== JSON.stringify(expected.rowCounts)) {
      throw new Error('Recovered database row counts do not match the backup')
    }
    return { restored: true, failedDatabasePath: failedPath }
  } catch (error) {
    if (fs.existsSync(resolvedDatabase)) fs.renameSync(resolvedDatabase, recoveryFailedPath)
    if (fs.existsSync(failedPath)) {
      fs.renameSync(failedPath, resolvedDatabase)
      for (const sidecar of ['-wal', '-shm']) {
        if (fs.existsSync(`${failedPath}${sidecar}`)) {
          fs.renameSync(`${failedPath}${sidecar}`, `${resolvedDatabase}${sidecar}`)
        }
      }
    }
    throw error
  }
}

async function prepareDatabaseForUpdate(dbPath, backupDirectory, options = {}) {
  if (typeof options.runMigrations !== 'function') {
    throw new Error('A migration runner is required')
  }
  const backup = await (options.backupDatabase || backupDatabase)(dbPath, backupDirectory)
  try {
    const migration = await options.runMigrations(dbPath)
    verifyDatabase(dbPath)
    return {
      status: 'ready',
      backupCreated: true,
      backupPath: backup.backupPath,
      migrationsApplied: migration?.migrationsApplied || [],
    }
  } catch {
    try {
      await (options.restoreDatabase || restoreDatabase)(dbPath, backup.backupPath)
      return {
        status: 'recovered',
        backupCreated: true,
        backupPath: backup.backupPath,
        error: 'DATABASE_MIGRATION_FAILED',
        migrationsApplied: [],
      }
    } catch {
      return {
        status: 'recovery_required',
        backupCreated: true,
        backupPath: backup.backupPath,
        error: 'DATABASE_RECOVERY_FAILED',
        migrationsApplied: [],
      }
    }
  }
}

module.exports = { prepareDatabaseForUpdate, restoreDatabase }
