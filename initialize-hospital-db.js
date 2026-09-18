const Database = require("better-sqlite3");

const db = new Database("./data/edc-hospital-template.sqlite");

const tablesToClear = [
  "clinical_values",
  "queries",
  "audit_logs",
  "export_history",
  "visits",
  "subjects"
];

const clear = db.transaction(() => {
  for (const table of tablesToClear) {
    db.prepare(`DELETE FROM "${table}"`).run();
  }
});

clear();

console.log("병원용 DB의 개발 데이터 초기화가 완료되었습니다.");

db.close();
