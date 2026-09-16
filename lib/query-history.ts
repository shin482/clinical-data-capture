const hiddenQueryHistoryForms = new Set([
  '기본정보 / 생활습관',
  '과거력 / 진단',
  '치료 / 약물 / 영상',
  '신체계측 / Vital',
])

export function queryHistoryForm(section: string | null | undefined) {
  const normalized = String(section || '').trim()
  return hiddenQueryHistoryForms.has(normalized) ? '' : normalized || 'Other'
}

export const removedQueryHistoryForms = [...hiddenQueryHistoryForms]
