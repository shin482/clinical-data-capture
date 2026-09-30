import Database from 'better-sqlite3'
import { migrateSmokingRule } from './rule-migration'
import { migrateStudySchema } from './study-migration'

type Migration = (database: Database.Database) => void

function appliedVersions(database: Database.Database) {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  return new Set((database.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((row) => row.version))
}

export function runMigrations(
  dbPath: string,
  migrations: Migration[] = [migrateStudySchema, migrateSmokingRule],
) {
  const database = new Database(dbPath, { fileMustExist: true, timeout: 10000 })
  try {
    database.pragma('busy_timeout = 10000')
    const before = appliedVersions(database)
    for (const migrate of migrations) database.transaction(() => migrate(database))()
    const after = appliedVersions(database)
    return { migrationsApplied: [...after].filter((version) => !before.has(version)) }
  } finally {
    database.close()
  }
}
