const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
export type QueryStatus = 'OPEN' | 'RESOLVED'
// Historical storage states are retained for audit purposes; the UI has two states.
export function normalizeQueryStatus(status: string): QueryStatus {
  return status.trim().toUpperCase() === 'OPEN' ? 'OPEN' : 'RESOLVED'
}
export function sortSubjectsNumerically<T extends { subject_id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => natural.compare(a.subject_id, b.subject_id))
}
export function getOpenQueryCount(queries: { status: string }[]) {
  return queries.filter((query) => normalizeQueryStatus(query.status) === 'OPEN').length
}
export function getSubjectQueryStatus(queries: { status: string }[]) {
  return getOpenQueryCount(queries) > 0 ? 'OPEN' : 'RESOLVED'
}
export function emrReference(rule: { variableKey: string; emrLocation: string }) {
  return rule.emrLocation || `EMR-${rule.variableKey}`
}

export function emrReferences(rule: { emrLocation: string }) {
  const canonicalNames: Record<string, string> = {
    '검사 결과': '검사결과',
    '외래 초진 기록': '외래 초진기록',
    '외래 재진 기록': '외래 재진기록',
    '입원 초진 기록': '입원 초진기록',
    '수술 기록': '수술기록',
  }
  return rule.emrLocation
    .split(/\r\n?|\n/)
    .map((reference) => reference.trim())
    .filter(Boolean)
    .map((reference) => canonicalNames[reference] || reference)
}
