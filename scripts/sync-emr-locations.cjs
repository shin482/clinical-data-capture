const fs = require('node:fs')
const path = require('node:path')
const XLSX = require('xlsx')

const root = path.resolve(__dirname, '..')
const workbook = XLSX.readFile(path.join(root, 'DFU-DC_e-CRF_PartB_IJH.xlsx'))
const sheetName = 'part B 변수목록 수정_최종본'
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
if (!rows.length) throw new Error(`${sheetName} 시트를 찾을 수 없습니다.`)
const siteColumns = {
  IJH: '인제대 EMR 위치',
  EWH: '이대목동 EMR 위치',
  SCH: '순천향 EMR 위치',
}
const columnIndexes = Object.fromEntries(Object.entries(siteColumns).map(([site, header]) => [site, rows[0].indexOf(header)]))
if (columnIndexes.IJH < 0) throw new Error(`${sheetName}에서 ${siteColumns.IJH} 열을 찾을 수 없습니다.`)
const sourceAliases = { amp_lt: 'amp' }
const sourceRows = rows.slice(1).filter((row) => String(row[0]).trim())
const jsonPath = path.join(root, 'lib', 'study-variables.json')
const definitions = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
const keys = new Set(sourceRows.map((row) => sourceAliases[String(row[0]).trim()] || String(row[0]).trim()))
const missing = definitions.filter((definition) => !keys.has(definition.variableKey)).map((definition) => definition.variableKey)
const unexpected = [...keys].filter((key) => !definitions.some((definition) => definition.variableKey === key))
if (missing.length || unexpected.length) throw new Error(`변수 매칭 실패: missing=${missing.join(',')} unexpected=${unexpected.join(',')}`)
const locationsByVariable = Object.fromEntries(sourceRows.map((row) => {
  const sourceKey = String(row[0]).trim()
  const variableKey = sourceAliases[sourceKey] || sourceKey
  const locations = Object.fromEntries(Object.entries(columnIndexes)
    .filter(([, index]) => index >= 0)
    .map(([site, index]) => [site, String(row[index]).replace(/\r\n/g, '\n').trim()]))
  return [variableKey, locations]
}))
for (const definition of definitions) definition.emrLocation = locationsByVariable[definition.variableKey].IJH || ''
fs.writeFileSync(jsonPath, `${JSON.stringify(definitions, null, 2)}\n`, 'utf8')
fs.writeFileSync(path.join(root, 'lib', 'emr-locations.json'), `${JSON.stringify(locationsByVariable, null, 2)}\n`, 'utf8')
const availableSites = Object.entries(columnIndexes).filter(([, index]) => index >= 0).map(([site]) => site)
console.log(`Synced ${definitions.length} variables for ${availableSites.join(', ')} (${Object.entries(columnIndexes).filter(([, index]) => index < 0).map(([site]) => site).join(', ') || 'no'} missing site columns)`)
