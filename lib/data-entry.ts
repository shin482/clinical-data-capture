import type { VariableDefinition } from '@/lib/db'
import { type Visit } from '@/lib/crf-metadata'
import { getVisitVariables } from '@/lib/visit-rules'

export const completionVisits: Visit[] = ['T1', 'T2', 'T3']
export type EntryValue = { variableKey: string; value: string | number | boolean | null | undefined; missingReason?: string | null }
export type VisitCompletion = Record<Visit, boolean>
export type VisitProgress = { completed: number; total: number; percentage: number; complete: boolean }

export const hasEntryValue = (value: EntryValue['value']) => value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '')

// Blank-allowed, disabled, out-of-visit and inactive conditional fields do not
// block completion. Only actual values count; legacy missing reasons remain stored.
export function getSubjectVisitProgress(subjectId: string, visit: Visit, rules: VariableDefinition[], entries: EntryValue[]): VisitProgress {
  const values = new Map(entries.map((entry) => [entry.variableKey, entry]))
  const valueOf = (key: string) => rules.find((rule) => rule.variableKey === key)?.dataType === 'id'
    ? subjectId : values.get(key)?.value
  const matches = (parents: string, activeValues: string) => {
    if (!parents.trim()) return true
    const allowed = activeValues.split(/[|,;]/).map((value) => value.trim()).filter(Boolean)
    return parents.split(/[|,;]/).map((key) => key.trim()).filter(Boolean).every((key) => {
      const raw = valueOf(key)
      const value = hasEntryValue(raw) ? String(raw).trim() : ''
      return hasEntryValue(raw) && (!allowed.length || allowed.includes('*') || allowed.includes(value))
    })
  }
  const applicable = getVisitVariables(rules, visit)
  // No configured schema is not evidence of completion. A configured visit
  // with no required fields, however, has no outstanding entries.
  const required = applicable.filter((rule) => !rule.allowBlank && matches(rule.parents, rule.activeValues) && matches(rule.groupParent, rule.groupActiveValue))
  const completed = required.filter((rule) => hasEntryValue(rule.dataType === 'id' ? subjectId : values.get(rule.variableKey)?.value)).length
  const total = required.length
  const complete = rules.length > 0 && completed === total
  return { completed, total, percentage: total ? Math.round(completed / total * 100) : complete ? 100 : 0, complete }
}

export function isVisitComplete(subjectId: string, visit: Visit, rules: VariableDefinition[], entries: EntryValue[]) {
  return getSubjectVisitProgress(subjectId, visit, rules, entries).complete
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
