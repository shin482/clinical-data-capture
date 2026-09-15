import fs from 'node:fs'
import path from 'node:path'
import type { VariableDefinition } from './db'

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
}
