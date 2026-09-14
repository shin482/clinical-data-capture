const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
export function sortSubjectsNumerically<T extends { subject_id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => natural.compare(a.subject_id, b.subject_id))
}
export function getOpenQueryCount(queries: { status: string }[]) {
  return queries.filter((query) => query.status === 'OPEN').length
}
export function getSubjectQueryStatus(queries: { status: string }[]) {
  return getOpenQueryCount(queries) > 0 ? 'OPEN' : 'RESOLVED'
}
export function emrReference(rule: { variableKey: string; emrLocation: string }) {
  return rule.emrLocation || `EMR-${rule.variableKey}`
}
