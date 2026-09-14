export function normalizeRecentSearches(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === 'string' && !!value.trim()).map((value) => value.trim()))].slice(0, 10) : []
}

export function updateRecentSearches(values: string[], value: string, remove = false): string[] {
  return normalizeRecentSearches(remove ? values.filter((item) => item !== value) : [value, ...values.filter((item) => item !== value)])
}

export function readRecentSearches(key: string): string[] {
  try { return normalizeRecentSearches(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return [] }
}

export function writeRecentSearches(key: string, values: string[]) {
  try { localStorage.setItem(key, JSON.stringify(values)) } catch { /* Keep session state usable when storage is unavailable. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('edc-recent-searches', { detail: { key, values } }))
}
