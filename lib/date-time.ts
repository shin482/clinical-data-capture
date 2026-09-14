export const getCurrentTimestamp = () => new Date().toISOString()

export function parseTimestamp(value: string) {
  // SQLite CURRENT_TIMESTAMP is UTC even though its text has no timezone suffix.
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value
  return new Date(normalized)
}

export function formatDateTime(value: string | null | undefined, timeZone?: string) {
  if (!value) return '—'
  const date = parseTimestamp(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) }).format(date)
}

export function timestampMillis(value: string) {
  const time = parseTimestamp(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function localDateBoundary(date: string, nextDay = false) {
  const boundary = new Date(`${date}T00:00:00`)
  if (nextDay) boundary.setDate(boundary.getDate() + 1)
  return boundary.toISOString()
}
