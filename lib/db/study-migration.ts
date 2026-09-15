import type Database from 'better-sqlite3'
import { legacyVariableAliases, studySchemaVersion, studyVariables } from '../study-schema'

export function migrateStudySchema(database: Database.Database) {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(studySchemaVersion)) return
  database.transaction(() => {
    const columns = database.prepare('PRAGMA table_info(variable_definitions)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'study_active')) database.exec('ALTER TABLE variable_definitions ADD COLUMN study_active INTEGER NOT NULL DEFAULT 0')
    database.exec('CREATE TABLE IF NOT EXISTS schema_migration_archive (id INTEGER PRIMARY KEY, version TEXT NOT NULL, table_name TEXT NOT NULL, original_row TEXT NOT NULL, archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
    const archive = database.prepare('INSERT INTO schema_migration_archive(version,table_name,original_row) VALUES(?,?,?)')
    for (const table of ['variable_definitions', 'clinical_values', 'queries']) {
      for (const row of database.prepare(`SELECT * FROM ${table}`).all()) archive.run(studySchemaVersion, table, JSON.stringify(row))
    }
    // Existing clinical data and immutable audit text are retained. Canonical
    // definitions are inserted first so foreign key references remain valid.
    const insert = database.prepare(`INSERT INTO variable_definitions(variable_key,label,section,data_type,unit_or_format,category_options,min_value,max_value,na_rule_raw,parents,active_values,allow_blank,allow_unknown_99,group_name,group_type,group_parent,group_active_value,enabled,timepoint_t1,timepoint_t2,timepoint_t3,emr_location,input_guide,display_order,study_active)
      VALUES (@variableKey,@label,@section,@dataType,@unitOrFormat,@categoryOptions,@minValue,@maxValue,@naRuleRaw,@parents,@activeValues,@allowBlank,@allowUnknown99,@groupName,@groupType,@groupParent,@groupActiveValue,1,@timepointT1,@timepointT2,@timepointT3,@emrLocation,@inputGuide,@displayOrder,1)
      ON CONFLICT(variable_key) DO UPDATE SET label=excluded.label,timepoint_t1=excluded.timepoint_t1,timepoint_t2=excluded.timepoint_t2,timepoint_t3=excluded.timepoint_t3,emr_location=excluded.emr_location,display_order=excluded.display_order,study_active=1,enabled=1`)
    for (const definition of studyVariables) {
      const oldKey = Object.keys(legacyVariableAliases).find((key) => legacyVariableAliases[key] === definition.variableKey)
      const old = oldKey ? database.prepare('SELECT * FROM variable_definitions WHERE variable_key=?').get(oldKey) as Record<string, unknown> | undefined : undefined
      const params = Object.fromEntries(Object.entries(definition).map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value]))
      if (old) {
        const preserved: Record<string, string> = { section: 'section', dataType: 'data_type', unitOrFormat: 'unit_or_format', categoryOptions: 'category_options', minValue: 'min_value', maxValue: 'max_value', allowBlank: 'allow_blank', allowUnknown99: 'allow_unknown_99', emrLocation: 'emr_location', inputGuide: 'input_guide' }
        for (const [target, source] of Object.entries(preserved)) params[target] = old[source] as string | number | null
      }
      insert.run(params)
    }
    for (const [oldKey, newKey] of Object.entries(legacyVariableAliases)) {
      const conflicts = database.prepare('SELECT 1 FROM clinical_values a JOIN clinical_values b ON a.visit_id=b.visit_id WHERE a.variable_key=? AND b.variable_key=?').get(oldKey, newKey)
      const queryConflicts = database.prepare('SELECT 1 FROM queries a JOIN queries b ON a.subject_id=b.subject_id AND a.timepoint=b.timepoint AND a.query_type=b.query_type WHERE a.variable_key=? AND b.variable_key=?').get(oldKey, newKey)
      if (conflicts || queryConflicts) throw new Error(`Schema migration conflict: ${oldKey} and ${newKey}; existing rows were not overwritten`)
      database.prepare('UPDATE clinical_values SET variable_key=? WHERE variable_key=?').run(newKey, oldKey)
      database.prepare('UPDATE queries SET variable_key=? WHERE variable_key=?').run(newKey, oldKey)
    }
    const keys = studyVariables.map((variable) => variable.variableKey)
    database.prepare(`UPDATE variable_definitions SET study_active=0,enabled=0 WHERE variable_key NOT IN (${keys.map(() => '?').join(',')})`).run(...keys)
    // No required field may depend on a removed variable such as dfu_wnd.
    for (const row of database.prepare('SELECT variable_key,parents,active_values,group_parent FROM variable_definitions WHERE study_active=1').all() as { variable_key: string; parents: string; active_values: string; group_parent: string }[]) {
      const parents = row.parents.split(',').map((key) => legacyVariableAliases[key] || key).filter((key) => keys.includes(key))
      const groupParent = legacyVariableAliases[row.group_parent] || row.group_parent
      database.prepare('UPDATE variable_definitions SET parents=?,active_values=?,group_parent=? WHERE variable_key=?').run(parents.join(','), parents.length ? row.active_values : '', keys.includes(groupParent) ? groupParent : '', row.variable_key)
    }
    database.exec(`UPDATE queries SET status='ARCHIVED',resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP) WHERE status='OPEN' AND EXISTS (SELECT 1 FROM variable_definitions v WHERE v.variable_key=queries.variable_key AND (v.study_active=0 OR (queries.timepoint='T1' AND v.timepoint_t1=0) OR (queries.timepoint='T2' AND v.timepoint_t2=0) OR (queries.timepoint='T3' AND v.timepoint_t3=0)))`)
    database.prepare("INSERT INTO audit_logs(new_value,modified_by,action) VALUES(?,'schema-migration','SCHEMA_MIGRATION')").run(studySchemaVersion)
    database.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(studySchemaVersion)
  })()
}
