export type Visit = 'T1' | 'T2' | 'T3'
export const sampleVisitNames: Record<Visit, string> = { T1: 'Baseline', T2: 'Follow-up 1', T3: 'Follow-up 2' }
export const missingReasons = [
  { code: 'NOT_ASSESSED', label: 'Not assessed' },
  { code: 'NOT_APPLICABLE', label: 'Not applicable' },
  { code: 'UNKNOWN', label: 'Unknown' },
  { code: 'NOT_DONE', label: 'Not done' },
] as const
export type MissingReason = typeof missingReasons[number]['code']
export const mockEmrReferences: Record<string, string> = {
  occl: '검사일: 2026-09-16', cc_pad: 'ABI: 0.72',
}
export type FieldMetadata = {
  variableKey: string; label: string; dataType: string; categoryOptions: string;
  allowUnknown99: boolean; minValue: number | null; maxValue: number | null;
  inputGuide: string; unitOrFormat: string;
}
export function categoryChoices(rule: FieldMetadata) {
  const choices = rule.categoryOptions.split('|').filter(Boolean).map((option) => {
    const [code, ...label] = option.split('=')
    return { code: code.trim(), label: label.join('=').trim() || code.trim() }
  })
  if (rule.allowUnknown99 && !choices.some((option) => option.code === '99')) choices.push({ code: '99', label: 'Unknown' })
  return choices
}
export function inputGuide(rule: FieldMetadata) {
  if (rule.inputGuide.trim()) return rule.inputGuide
  if (rule.dataType === 'categorical') return categoryChoices(rule).map(({ code, label }) => `${code}=${label}`).join(', ')
  if (rule.dataType === 'datetime') return 'YYYY-MM-DD'
  if (rule.minValue != null || rule.maxValue != null) return `${rule.minValue ?? '제한 없음'} ~ ${rule.maxValue ?? '제한 없음'}${rule.unitOrFormat ? ` ${rule.unitOrFormat}` : ''}`
  if (rule.dataType === 'id') return '대상자 식별번호'
  return rule.unitOrFormat || (rule.dataType === 'integer' ? '정수 입력' : rule.dataType === 'real' ? '숫자 입력' : '텍스트 입력')
}
