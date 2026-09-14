import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

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

const databaseDirectory = process.env.EDC_DATA_DIR || path.join(process.cwd(), 'data')
fs.mkdirSync(databaseDirectory, { recursive: true })
const database = new Database(path.join(databaseDirectory, 'edc.sqlite'), { timeout: 10000 })
database.pragma('busy_timeout = 10000')
database.pragma('journal_mode = WAL')

database.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'DATA_ENTRY', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL REFERENCES subjects(id), timepoint TEXT NOT NULL, visit_date TEXT, UNIQUE(subject_id, timepoint));
  CREATE TABLE IF NOT EXISTS variable_definitions (id INTEGER PRIMARY KEY AUTOINCREMENT, variable_key TEXT UNIQUE NOT NULL, label TEXT NOT NULL, section TEXT NOT NULL, data_type TEXT NOT NULL, unit_or_format TEXT DEFAULT '', category_options TEXT DEFAULT '', min_value REAL, max_value REAL, na_rule_raw TEXT DEFAULT '', parents TEXT DEFAULT '', active_values TEXT DEFAULT '', allow_blank INTEGER NOT NULL DEFAULT 0, allow_unknown_99 INTEGER NOT NULL DEFAULT 0, group_name TEXT DEFAULT '', group_type TEXT DEFAULT '', group_parent TEXT DEFAULT '', group_active_value TEXT DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, timepoint_t1 INTEGER NOT NULL DEFAULT 1, timepoint_t2 INTEGER NOT NULL DEFAULT 1, timepoint_t3 INTEGER NOT NULL DEFAULT 1, emr_location TEXT DEFAULT '', input_guide TEXT DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS clinical_values (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL REFERENCES subjects(id), visit_id INTEGER NOT NULL REFERENCES visits(id), variable_key TEXT NOT NULL REFERENCES variable_definitions(variable_key), value TEXT, modified_by TEXT, modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(visit_id, variable_key));
  CREATE TABLE IF NOT EXISTS queries (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT NOT NULL, visit_id INTEGER, timepoint TEXT NOT NULL, variable_key TEXT NOT NULL, query_type TEXT NOT NULL, message TEXT NOT NULL, current_value TEXT, status TEXT NOT NULL DEFAULT 'OPEN', detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, UNIQUE(subject_id, timepoint, variable_key, query_type));
  CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT, timepoint TEXT, variable_key TEXT, previous_value TEXT, new_value TEXT, modified_by TEXT, modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, action TEXT NOT NULL DEFAULT 'VALUE_CHANGE');
  CREATE TABLE IF NOT EXISTS hospital_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

// Additive migration keeps existing values and old API clients compatible.
const valueColumns = database.prepare('PRAGMA table_info(clinical_values)').all() as { name: string }[]
if (!valueColumns.some((column) => column.name === 'missing_reason')) database.exec('ALTER TABLE clinical_values ADD COLUMN missing_reason TEXT')

export function db() { return database }

export function ensureSubject(subjectId: string) {
  const normalized = subjectId.trim()
  if (!normalized) throw new Error('Subject ID is required')
  const subject = database.prepare('INSERT INTO subjects (subject_id) VALUES (?) ON CONFLICT(subject_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING id, subject_id').get(normalized) as { id: number; subject_id: string }
  const insertVisit = database.prepare('INSERT INTO visits (subject_id, timepoint) VALUES (?, ?) ON CONFLICT(subject_id, timepoint) DO NOTHING')
  database.transaction(() => ['T1', 'T2', 'T3'].forEach((timepoint) => insertVisit.run(subject.id, timepoint)))()
  return subject
}

export function rowToVariable(row: Record<string, unknown>): VariableDefinition {
  return { variableKey: String(row.variable_key), label: String(row.label), section: String(row.section), dataType: String(row.data_type), unitOrFormat: String(row.unit_or_format || ''), categoryOptions: String(row.category_options || ''), minValue: row.min_value == null ? null : Number(row.min_value), maxValue: row.max_value == null ? null : Number(row.max_value), naRuleRaw: String(row.na_rule_raw || ''), parents: String(row.parents || ''), activeValues: String(row.active_values || ''), allowBlank: Boolean(row.allow_blank), allowUnknown99: Boolean(row.allow_unknown_99), groupName: String(row.group_name || ''), groupType: String(row.group_type || ''), groupParent: String(row.group_parent || ''), groupActiveValue: String(row.group_active_value || ''), enabled: Boolean(row.enabled), timepointT1: Boolean(row.timepoint_t1), timepointT2: Boolean(row.timepoint_t2), timepointT3: Boolean(row.timepoint_t3), emrLocation: String(row.emr_location || ''), inputGuide: String(row.input_guide || ''), displayOrder: Number(row.display_order) }
}
