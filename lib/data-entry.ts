import type { VariableDefinition } from '@/lib/db'
import { missingReasons, type Visit } from '@/lib/crf-metadata'

export const completionVisits: Visit[] = ['T1', 'T2', 'T3']
export type EntryValue = { variableKey: string; value: string | null; missingReason?: string | null }
export type VisitCompletion = Record<Visit, boolean>

const hasValue = (value: string | null | undefined) => Boolean(value?.trim())

// Blank-allowed, disabled, out-of-visit and inactive conditional fields do not
// block completion. Explicit missing reasons are accepted by the save API.
export function isVisitComplete(subjectId: string, visit: Visit, rules: VariableDefinition[], entries: EntryValue[]) {
  const values = new Map(entries.map((entry) => [entry.variableKey, entry]))
  const valueOf = (key: string) => rules.find((rule) => rule.variableKey === key)?.dataType === 'id'
    ? subjectId : values.get(key)?.value
  const matches = (parents: string, activeValues: string) => {
    if (!parents.trim()) return true
    const allowed = activeValues.split(/[|,;]/).map((value) => value.trim()).filter(Boolean)
    return parents.split(/[|,;]/).map((key) => key.trim()).filter(Boolean).every((key) => {
      const value = valueOf(key)?.trim()
      return hasValue(value) && (!allowed.length || allowed.includes('*') || allowed.includes(value!))
    })
  }
  const applicable = rules.filter((rule) => rule.enabled && (
    visit === 'T1' ? rule.timepointT1 : visit === 'T2' ? rule.timepointT2 : rule.timepointT3
  ))
  // No configured schema is not evidence of completion. A configured visit
  // with no required fields, however, has no outstanding entries.
  if (!rules.length) return false
  return applicable.filter((rule) => !rule.allowBlank && matches(rule.parents, rule.activeValues) && matches(rule.groupParent, rule.groupActiveValue))
    .every((rule) => hasValue(rule.dataType === 'id' ? subjectId : values.get(rule.variableKey)?.value)
      || missingReasons.some((reason) => reason.code === values.get(rule.variableKey)?.missingReason))
}

export function isSubjectDataEntryComplete(completion: VisitCompletion) {
  return completionVisits.every((visit) => completion[visit])
}

export function getDataEntrySummary(subjects: { visit_completion: VisitCompletion }[]) {
  const total = subjects.length
  const complete = subjects.filter((subject) => isSubjectDataEntryComplete(subject.visit_completion)).length
  return {
    total, complete, incomplete: total - complete,
    visits: completionVisits.map((visit) => {
      const completed = subjects.filter((subject) => subject.visit_completion[visit]).length
      return { visit, completed, total, percentage: total ? Math.round(completed / total * 100) : 0 }
    }),
  }
}
