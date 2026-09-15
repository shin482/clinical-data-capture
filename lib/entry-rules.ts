type Value = string | number | boolean | null | undefined
type ConditionalRule = { parents: string; activeValues: string; groupParent?: string; groupActiveValue?: string }
type ExportRule = ConditionalRule & { enabled: boolean }
export const hasValue = (value: Value) => value != null && String(value).trim() !== ''
export function isFieldActive(rule: ConditionalRule, valueOf: (key: string) => Value) {
  const matches = (parents: string, active: string) => {
    const allowed = active.split(/[|,;]/).map((v) => v.trim()).filter(Boolean)
    return parents.split(/[|,;]/).map((v) => v.trim()).filter(Boolean).every((key) => {
      const value = valueOf(key)
      const normalized = String(value ?? '').trim()
      const exclusions = allowed.filter((token) => token.startsWith('!='))
      const inclusions = allowed.filter((token) => !token.startsWith('!='))
      return hasValue(value) && exclusions.every((token) => normalized !== token.slice(2).trim()) &&
        (inclusions.includes('*') || (!inclusions.length && exclusions.length > 0) || (inclusions.length ? inclusions : ['1']).includes(normalized))
    })
  }
  return matches(rule.parents, rule.activeValues) && matches(rule.groupParent || '', rule.groupActiveValue || '')
}

export function exportFieldValue(rule: ExportRule, valueOf: (key: string) => Value, value: Value) {
  if (!rule.enabled || !isFieldActive(rule, valueOf)) return 'NA'
  const normalized = String(value ?? '').trim()
  return normalized || '99'
}

// Explicit derived-rule registry uses the authoritative dictionary keys.
export const derivedRules = [
  { target: 'bmi', sources: ['hei', 'wei'] },
  { target: 'snb_score', sources: ['snb_site', 'snb_isc', 'snb_neuro', 'snb_bac', 'snb_area', 'snb_depth'] },
]
export const isDerivedField = (key: string) => derivedRules.some((rule) => rule.target === key)
export function derivedValues(valueOf: (key: string) => Value): Record<string, string> {
  const height = Number(valueOf('hei'))
  const weight = Number(valueOf('wei'))
  const bmi = Number.isFinite(height) && height > 0 && Number.isFinite(weight) && weight > 0
    ? (weight / ((height / 100) ** 2)).toFixed(1)
    : ''
  const sinbad = derivedRules[1].sources.map((key) => String(valueOf(key) ?? '').trim())
  return {
    bmi,
    snb_score: sinbad.every((value) => value === '0' || value === '1')
      ? String(sinbad.reduce((sum, value) => sum + Number(value), 0))
      : '',
  }
}
