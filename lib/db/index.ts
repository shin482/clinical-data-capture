import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { getCurrentTimestamp } from '../date-time'
import { migrateStudySchema } from './study-migration'
import { migrateSmokingRule } from './rule-migration'
import { smokingRuleMigrationVersion } from './rule-migration'
import { studySchemaVersion } from '../study-schema'
import { applicationWriterGate, runApplicationStartupMaintenance } from './writer-gate'

export type VariableDefinition = {
  variableKey: string
  label: string
  section: string
  dataType: string
  unitOrFormat: string
  categoryOptions: string
  minValue: number | null
  maxValue: number | null
  naRuleRaw: string
  parents: string
  activeValues: string
  allowBlank: boolean
  allowUnknown99: boolean
  groupName: string
  groupType: string
  groupParent: string
  groupActiveValue: string
  enabled: boolean
  timepointT1: boolean
  timepointT2: boolean
  timepointT3: boolean
  emrLocation: string
  inputGuide: string
  displayOrder: number
}

let database: Database.Database | null = null

const requiredTables = ['export_history', 'users', 'subjects', 'visits', 'variable_definitions',
  'clinical_values', 'queries', 'audit_logs', 'hospital_settings', 'schema_migrations']

export function databaseMaintenanceRequired(connection: Database.Database) {
  const tables = new Set((connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
    .map((row) => row.name))
  if (!requiredTables.every((table) => tables.has(table))) return true
  const valueColumns = new Set((connection.prepare('PRAGMA table_info(clinical_values)').all() as { name: string }[])
    .map((row) => row.name))
  const queryColumns = new Set((connection.prepare('PRAGMA table_info(queries)').all() as { name: string }[])
    .map((row) => row.name))
  const variableColumns = new Set((connection.prepare('PRAGMA table_info(variable_definitions)').all() as { name: string }[])
    .map((row) => row.name))
  if (!valueColumns.has('missing_reason') || !queryColumns.has('updated_at') || !variableColumns.has('study_active')) return true
  const versions = new Set((connection.prepare('SELECT version FROM schema_migrations').all() as { version: string }[])
    .map((row) => row.version))
  return !versions.has(studySchemaVersion) || !versions.has(smokingRuleMigrationVersion)
}

function initializeDatabase(): Database.Database {
  const databaseDirectory = process.env.EDC_DATA_DIR || path.join(process.cwd(), 'data')
  fs.mkdirSync(databaseDirectory, { recursive: true })
  const connection = new Database(path.join(databaseDirectory, 'edc.sqlite'), { timeout: 10000 })
  connection.pragma('busy_timeout = 10000')
  if (!databaseMaintenanceRequired(connection)) return connection

  try { return runApplicationStartupMaintenance(() => {
  connection.pragma('journal_mode = WAL')

  connection.exec(`
  CREATE TABLE IF NOT EXISTS export_history (id INTEGER PRIMARY KEY AUTOINCREMENT, exported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, user_name TEXT NOT NULL, subject_id TEXT, visit TEXT, file_name TEXT NOT NULL, export_type TEXT NOT NULL DEFAULT 'XLSX', status TEXT NOT NULL DEFAULT 'Completed');
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'DATA_ENTRY', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL REFERENCES subjects(id), timepoint TEXT NOT NULL, visit_date TEXT, UNIQUE(subject_id, timepoint));
  CREATE TABLE IF NOT EXISTS variable_definitions (id INTEGER PRIMARY KEY AUTOINCREMENT, variable_key TEXT UNIQUE NOT NULL, label TEXT NOT NULL, section TEXT NOT NULL, data_type TEXT NOT NULL, unit_or_format TEXT DEFAULT '', category_options TEXT DEFAULT '', min_value REAL, max_value REAL, na_rule_raw TEXT DEFAULT '', parents TEXT DEFAULT '', active_values TEXT DEFAULT '', allow_blank INTEGER NOT NULL DEFAULT 0, allow_unknown_99 INTEGER NOT NULL DEFAULT 0, group_name TEXT DEFAULT '', group_type TEXT DEFAULT '', group_parent TEXT DEFAULT '', group_active_value TEXT DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, timepoint_t1 INTEGER NOT NULL DEFAULT 1, timepoint_t2 INTEGER NOT NULL DEFAULT 1, timepoint_t3 INTEGER NOT NULL DEFAULT 1, emr_location TEXT DEFAULT '', input_guide TEXT DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS clinical_values (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL REFERENCES subjects(id), visit_id INTEGER NOT NULL REFERENCES visits(id), variable_key TEXT NOT NULL REFERENCES variable_definitions(variable_key), value TEXT, missing_reason TEXT, modified_by TEXT, modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(visit_id, variable_key));
  CREATE TABLE IF NOT EXISTS queries (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT NOT NULL, visit_id INTEGER, timepoint TEXT NOT NULL, variable_key TEXT NOT NULL, query_type TEXT NOT NULL, message TEXT NOT NULL, current_value TEXT, status TEXT NOT NULL DEFAULT 'OPEN', detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, UNIQUE(subject_id, timepoint, variable_key, query_type));
  CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT, timepoint TEXT, variable_key TEXT, previous_value TEXT, new_value TEXT, modified_by TEXT, modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, action TEXT NOT NULL DEFAULT 'VALUE_CHANGE');
  CREATE TABLE IF NOT EXISTS hospital_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)

  // Additive migration keeps existing values and old API clients compatible.
  const valueColumns = connection.prepare('PRAGMA table_info(clinical_values)').all() as { name: string }[]
  if (!valueColumns.some((column) => column.name === 'missing_reason')) connection.exec('ALTER TABLE clinical_values ADD COLUMN missing_reason TEXT')

  migrateStudySchema(connection)
  migrateSmokingRule(connection)
  // Existing subjects receive the same generated, immutable ID value as newly
  // registered subjects without replacing any previously stored value.
  connection.exec(`
  INSERT INTO clinical_values(subject_id,visit_id,variable_key,value,modified_by,modified_at)
  SELECT s.id,v.id,'id',s.subject_id,'system',CURRENT_TIMESTAMP
  FROM subjects s JOIN visits v ON v.subject_id=s.id AND v.timepoint='T1'
  WHERE EXISTS (SELECT 1 FROM variable_definitions d WHERE d.variable_key='id' AND d.study_active=1)
  ON CONFLICT(visit_id,variable_key) DO NOTHING;
  `)
  const queryColumns = connection.prepare('PRAGMA table_info(queries)').all() as { name: string }[]
  if (!queryColumns.some((column) => column.name === 'updated_at')) connection.exec('ALTER TABLE queries ADD COLUMN updated_at TEXT')
  connection.exec(`
  INSERT INTO clinical_values(subject_id,visit_id,variable_key,value,modified_by,modified_at)
  SELECT s.id,v.id,'dfu','1','system',CURRENT_TIMESTAMP
  FROM subjects s JOIN visits v ON v.subject_id=s.id AND v.timepoint='T1'
  WHERE EXISTS (SELECT 1 FROM variable_definitions d WHERE d.variable_key='dfu' AND d.study_active=1)
  ON CONFLICT(visit_id,variable_key) DO UPDATE SET value='1',missing_reason=NULL,modified_by='system',modified_at=CURRENT_TIMESTAMP
  WHERE clinical_values.value<>'1' OR clinical_values.value IS NULL OR clinical_values.missing_reason IS NOT NULL;
  `)
  return connection
  }) } catch (error) {
    connection.close()
    throw error
  }
}

export function db(): Database.Database {
  database ??= initializeDatabase()
  return database!
}

export function runDatabaseWrite<T>(operation: () => T): T {
  return applicationWriterGate.runWrite(operation) as T
}

export function runDatabaseTransaction<T>(operation: () => T): T {
  return applicationWriterGate.runTransaction(db(), operation) as T
}

export function databaseWriterGateStatus() {
  return applicationWriterGate.status()
}

export function ensureSubject(subjectId: string) {
  const database = db()
  return runDatabaseWrite(() => {
  const normalized = subjectId.trim()
  if (!normalized) throw new Error('Subject ID is required')
  const subject = database.prepare('INSERT INTO subjects (subject_id,created_at,updated_at) VALUES (?,?,?) ON CONFLICT(subject_id) DO UPDATE SET subject_id=excluded.subject_id RETURNING id, subject_id').get(normalized, getCurrentTimestamp(), getCurrentTimestamp()) as { id: number; subject_id: string }
  const insertVisit = database.prepare('INSERT INTO visits (subject_id, timepoint) VALUES (?, ?) ON CONFLICT(subject_id, timepoint) DO NOTHING')
  database.transaction(() => {
    ;['T1', 'T2', 'T3'].forEach((timepoint) => insertVisit.run(subject.id, timepoint))
    const t1 = database.prepare("SELECT id FROM visits WHERE subject_id=? AND timepoint='T1'").get(subject.id) as { id: number }
    database.prepare("INSERT INTO clinical_values(subject_id,visit_id,variable_key,value,modified_by,modified_at) VALUES(?,?, 'id',?,'system',?) ON CONFLICT(visit_id,variable_key) DO NOTHING").run(subject.id, t1.id, normalized, getCurrentTimestamp())
    database.prepare("INSERT INTO clinical_values(subject_id,visit_id,variable_key,value,modified_by,modified_at) VALUES(?,?, 'dfu','1','system',?) ON CONFLICT(visit_id,variable_key) DO UPDATE SET value='1',missing_reason=NULL WHERE clinical_values.value<>'1' OR clinical_values.value IS NULL OR clinical_values.missing_reason IS NOT NULL").run(subject.id, t1.id, getCurrentTimestamp())
  })()
  return subject
  })
}

export function createSubject(subjectId: string) {
  const database = db()
  return runDatabaseWrite(() => {
  const normalized = subjectId.trim()
  if (!normalized) throw new Error('Subject ID is required')
  try {
    return database.transaction(() => {
      const timestamp = getCurrentTimestamp()
      const subject = database.prepare('INSERT INTO subjects(subject_id,created_at,updated_at) VALUES(?,?,?) RETURNING id,subject_id').get(normalized, timestamp, timestamp) as { id: number; subject_id: string }
      const insertVisit = database.prepare('INSERT INTO visits(subject_id,timepoint) VALUES(?,?) RETURNING id')
      const visits = ['T1', 'T2', 'T3'].map((timepoint) => ({ timepoint, ...(insertVisit.get(subject.id, timepoint) as { id: number }) }))
      database.prepare("INSERT INTO clinical_values(subject_id,visit_id,variable_key,value,modified_by,modified_at) VALUES(?,?, 'id',?,'system',?)").run(subject.id, visits[0].id, normalized, timestamp)
      database.prepare("INSERT INTO clinical_values(subject_id,visit_id,variable_key,value,modified_by,modified_at) VALUES(?,?, 'dfu','1','system',?)").run(subject.id, visits[0].id, timestamp)
      return subject
    })()
  }
  catch (error) {
    if (String(error).includes('UNIQUE constraint failed: subjects.subject_id')) throw new Error('이미 등록된 Subject 번호입니다.')
    throw error
  }
  })
}

export function rowToVariable(row: Record<string, unknown>): VariableDefinition {
  return { variableKey: String(row.variable_key), label: String(row.label), section: String(row.section), dataType: String(row.data_type), unitOrFormat: String(row.unit_or_format || ''), categoryOptions: String(row.category_options || ''), minValue: row.min_value == null ? null : Number(row.min_value), maxValue: row.max_value == null ? null : Number(row.max_value), naRuleRaw: String(row.na_rule_raw || ''), parents: String(row.parents || ''), activeValues: String(row.active_values || ''), allowBlank: Boolean(row.allow_blank), allowUnknown99: Boolean(row.allow_unknown_99), groupName: String(row.group_name || ''), groupType: String(row.group_type || ''), groupParent: String(row.group_parent || ''), groupActiveValue: String(row.group_active_value || ''), enabled: Boolean(row.enabled), timepointT1: Boolean(row.timepoint_t1), timepointT2: Boolean(row.timepoint_t2), timepointT3: Boolean(row.timepoint_t3), emrLocation: String(row.emr_location || ''), inputGuide: String(row.input_guide || ''), displayOrder: Number(row.display_order) }
}
