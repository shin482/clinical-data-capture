import definitions from './study-variables.json'
import emrLocations from './emr-locations.json'
import type { VariableDefinition } from './db'
import { appConfig } from './app-config'
import { getSiteCode } from './site-config'

// Name, exact label (including newlines), order and visits come exclusively from
// DFU-DC_e-CRF_PartB_IJH.xlsx / part B 변수목록 수정_최종본.
// Types/ranges/required flags are retained from existing EDC rules because the
// authoritative sheet does not define them. Removed parent references are cleared.
const configuredSite = getSiteCode(process.env.EDC_SITE || appConfig.site)
export const studyVariables: VariableDefinition[] = definitions.map((definition) => ({
  ...definition,
  emrLocation: (emrLocations as Record<string, Partial<Record<typeof configuredSite, string>>>)[definition.variableKey]?.[configuredSite] || '',
}))
export const studyVariableKeys = new Set(studyVariables.map((variable) => variable.variableKey))
export const legacyVariableAliases: Record<string, string> = { pvd: 'pad', amp_lt: 'amp', ampdt_lt: 'amp_dt' }
export const canonicalVariableKey = (key: string) => legacyVariableAliases[key] || key
export const studySchemaVersion = `part-b-final-71-v5-${configuredSite.toLowerCase()}`
