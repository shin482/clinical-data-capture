import type Database from 'better-sqlite3'
import { studyVariables } from '../study-schema'

export function migrateSmokingRule(database: Database.Database) {
  const version = 'smoking-exclude-99-v1'
  if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return
  database.transaction(() => {
    for (const rule of studyVariables.filter((rule) => rule.parents === 'smk')) {
      const previous = database.prepare('SELECT parents,active_values FROM variable_definitions WHERE variable_key=?').get(rule.variableKey)
      database.prepare('UPDATE variable_definitions SET parents=?,active_values=? WHERE variable_key=?').run(rule.parents, rule.activeValues, rule.variableKey)
      database.prepare("INSERT INTO audit_logs(variable_key,previous_value,new_value,modified_by,action) VALUES(?,?,?,'rule-migration','RULE_CHANGE')").run(rule.variableKey, JSON.stringify(previous), JSON.stringify({ parents: rule.parents, active_values: rule.activeValues }))
    }
    database.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(version)
  })()
}
