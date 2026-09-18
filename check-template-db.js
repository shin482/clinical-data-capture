const Database = require("better-sqlite3");

const db = new Database("./data/edc-hospital-template.sqlite", { readonly: true });

const tables = [
  "subjects",
  "visits",
  "clinical_values",
  "queries",
  "audit_logs",
  "export_history",
  "variable_definitions",
  "schema_migrations",
  "schema_migration_archive"
];

for (const table of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
  console.log(`${table}: ${row.count}`);
}

db.close();
