const Database = require("better-sqlite3");

const source = new Database("./data/edc.sqlite", { readonly: true });
const target = new Database("./data/edc-hospital-template.sqlite");

source.backup("./data/edc-hospital-template.sqlite").then(() => {
  source.close();
  target.close();
  console.log("병원용 DB 복제가 완료되었습니다.");
}).catch((error) => {
  source.close();
  target.close();
  console.error(error);
  process.exit(1);
});
