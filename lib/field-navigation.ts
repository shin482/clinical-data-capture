import type { KeyboardEvent } from 'react'

// Only controls marked by the CRF renderer participate. DOM order is the
// existing native Tab order; tabindex and Tab handlers are never changed.
export function handleFieldEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.defaultPrevented) return
  const current = event.currentTarget
  if (current.disabled || current.readOnly) return
  const scope = current.closest('[data-crf-navigation]')
  if (!scope) return
  event.preventDefault()
  const fields = Array.from(scope.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-crf-entry]')).filter((field) =>
    !field.disabled && !field.hasAttribute('readonly') && field.tabIndex >= 0 &&
    !field.closest('[hidden], [inert], [aria-hidden="true"]') && field.getClientRects().length > 0 &&
    getComputedStyle(field).visibility !== 'hidden')
  const index = fields.indexOf(current)
  if (index >= 0) fields[index + 1]?.focus()
}
