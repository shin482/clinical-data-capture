const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')
const root = path.resolve(__dirname, '..')
const sheetName = 'part B 변수목록 수정_최종본'

function readSource() {
  const workbook = XLSX.readFile(path.join(root, 'DFU-DC_e-CRF_PartB_IJH.xlsx'))
  assert.ok(workbook.SheetNames.includes(sheetName), 'Authoritative sheet not found')
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
  assert.deepEqual(rows[0].slice(0, 5), ['변수명', '한글 항목명', '수집시점 해당여부(T1)', '수집시점 해당여부(T2)', '수집시점 해당여부(T3)'])
  const variables = rows.slice(1).filter((row) => String(row[0]).trim()).map((row) => {
    for (const cell of row.slice(2, 5)) assert.ok(cell === 'O' || cell === '', `Unexpected visit marker for ${row[0]}`)
    return { variableKey: row[0], label: row[1], timepointT1: row[2] === 'O', timepointT2: row[3] === 'O', timepointT3: row[4] === 'O' }
  })
  assert.equal(variables.length, 71)
  assert.equal(new Set(variables.map((row) => row.variableKey)).size, 71)
  return variables
}

function compare(source, target) {
  const normalized = (value) => typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value
  return {
    missing: source.filter((row) => !target.some((other) => other.variableKey === row.variableKey)).map((row) => row.variableKey),
    unexpected: target.filter((row) => !source.some((other) => other.variableKey === row.variableKey)).map((row) => row.variableKey),
    mismatches: source.filter((row) => target.some((other) => other.variableKey === row.variableKey && ['label', 'timepointT1', 'timepointT2', 'timepointT3'].some((key) => normalized(row[key]) !== normalized(other[key])))).map((row) => row.variableKey),
  }
}

function validate() {
  const source = readSource()
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'lib/study-variables.json'), 'utf8'))
  const diff = compare(source, schema)
  assert.deepEqual(diff, { missing: [], unexpected: [], mismatches: [] })
  assert.equal(schema.length, 71)
  assert.ok(schema.some((row) => row.variableKey === 'dfu_ex_amt'))
  console.log(JSON.stringify({ sheet: sheetName, sourceCount: source.length, canonicalCount: schema.length, ...diff, t1Only: source.filter((row) => row.timepointT1 && !row.timepointT2 && !row.timepointT3).map((row) => row.variableKey), unassigned: source.filter((row) => !row.timepointT1 && !row.timepointT2 && !row.timepointT3).map((row) => row.variableKey) }, null, 2))
}
module.exports = { readSource, compare, validate }
if (require.main === module) validate()
