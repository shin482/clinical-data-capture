import definitions from './study-variables.json'
import type { VariableDefinition } from './db'

// Name, exact label (including newlines), order and visits come exclusively from
// DFU-DC_e-CRF_PartB_IJH.xlsx / part B 변수목록 수정_최종본.
// Types/ranges/required flags are retained from existing EDC rules because the
// authoritative sheet does not define them. Removed parent references are cleared.
export const studyVariables: VariableDefinition[] = definitions
export const studyVariableKeys = new Set(studyVariables.map((variable) => variable.variableKey))
export const legacyVariableAliases: Record<string, string> = { pvd: 'pad', ampdt_lt: 'amp_dt' }
export const canonicalVariableKey = (key: string) => legacyVariableAliases[key] || key
export const studySchemaVersion = 'part-b-final-71-v3'
