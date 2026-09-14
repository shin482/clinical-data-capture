import type { Visit } from './crf-metadata'

export type VisitRule = { timepointT1: boolean; timepointT2: boolean; timepointT3: boolean }
export function isCollectedAtVisit(rule: VisitRule, visit: Visit) {
  return { T1: rule.timepointT1, T2: rule.timepointT2, T3: rule.timepointT3 }[visit]
}
export function getVisitVariables<T extends VisitRule & { enabled: boolean }>(rules: T[], visit: Visit) {
  return rules.filter((rule) => rule.enabled && isCollectedAtVisit(rule, visit))
}
