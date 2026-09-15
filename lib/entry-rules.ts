type Value = string | number | boolean | null | undefined
type ConditionalRule = { parents: string; activeValues: string; groupParent?: string; groupActiveValue?: string }
export const hasValue = (value: Value) => value != null && String(value).trim() !== ''
export function isFieldActive(rule: ConditionalRule, valueOf: (key: string) => Value) {
  const matches = (parents: string, active: string) => {
    const allowed = active.split(/[|,;]/).map((v) => v.trim()).filter(Boolean)
    return parents.split(/[|,;]/).map((v) => v.trim()).filter(Boolean).every((key) => {
      const value = valueOf(key)
      return hasValue(value) && (allowed.includes('*') || (allowed.length ? allowed : ['1']).includes(String(value).trim()))
    })
  }
  return matches(rule.parents, rule.activeValues) && matches(rule.groupParent || '', rule.groupActiveValue || '')
}

// Explicit derived-rule registry uses the authoritative dictionary keys.
export const derivedRules = [{ target: 'snb_score', sources: ['snb_site', 'snb_isc', 'snb_neuro', 'snb_bac', 'snb_area', 'snb_depth'], allowed: ['0', '1'] }]
export const isDerivedField = (key: string) => derivedRules.some((rule) => rule.target === key)
export function derivedValues(valueOf: (key: string) => Value): Record<string, string> {
  return Object.fromEntries(derivedRules.map((rule) => {
    const values = rule.sources.map((key) => String(valueOf(key) ?? '').trim())
    return [rule.target, values.every((value) => rule.allowed.includes(value)) ? String(values.reduce((sum, value) => sum + Number(value), 0)) : '']
  }))
}
