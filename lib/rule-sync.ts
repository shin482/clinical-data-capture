import fs from 'node:fs'
import path from 'node:path'
import type { VariableDefinition } from './db'
import { appConfig } from './app-config'
import { getSiteCode } from './site-config'

const defaultSchemaPath = path.join(process.cwd(), 'lib', 'study-variables.json')

export function updateStudyVariableJson(variableKey: string, updated: VariableDefinition) {
  const schemaPath = process.env.EDC_STUDY_VARIABLES_PATH || defaultSchemaPath
  const definitions = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ schemaPath, 'utf8')) as VariableDefinition[]
  const index = definitions.findIndex((definition) => definition.variableKey === variableKey)
  if (index < 0) throw new Error('Variable is not in study-variables.json')
  definitions[index] = updated
  const temporaryPath = `${schemaPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(definitions, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, schemaPath)

  const emrPath = process.env.EDC_EMR_LOCATIONS_PATH || path.join(path.dirname(schemaPath), 'emr-locations.json')
  if (fs.existsSync(/* turbopackIgnore: true */ emrPath)) {
    const locations = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ emrPath, 'utf8')) as Record<string, Record<string, string>>
    const site = getSiteCode(process.env.EDC_SITE || appConfig.site)
    locations[variableKey] = { ...(locations[variableKey] || {}), [site]: updated.emrLocation }
    const temporaryEmrPath = `${emrPath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryEmrPath, `${JSON.stringify(locations, null, 2)}\n`, 'utf8')
    fs.renameSync(temporaryEmrPath, emrPath)
  }
}
