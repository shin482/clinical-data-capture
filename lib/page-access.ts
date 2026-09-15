import { ADMIN_AUTH_TTL_MS } from './admin-auth-config'

export const pageSessionKeys = {
  'Rule Master': 'edc_rule_master_authenticated',
  'Audit Trail': 'edc_audit_trail_authenticated',
} as const
export type ProtectedPage = keyof typeof pageSessionKeys
export type PageAccess = Record<ProtectedPage, boolean>
export const emptyPageAccess: PageAccess = { 'Rule Master': false, 'Audit Trail': false }
export function isProtectedPage(page: string): page is ProtectedPage {
  return Object.prototype.hasOwnProperty.call(pageSessionKeys, page)
}
export function readPageAccess(storage: Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'removeItem'>>, now = Date.now()): PageAccess {
  const valid = (page: ProtectedPage) => {
    const key = pageSessionKeys[page]
    try {
      const value = JSON.parse(storage.getItem(key) || 'null')
      const at = value?.authenticatedAt
      if (typeof at === 'number' && Number.isFinite(at) && at <= now && now - at < ADMIN_AUTH_TTL_MS) return true
      storage.removeItem?.(key)
    } catch { storage.removeItem?.(key) }
    return false
  }
  return {
    'Rule Master': valid('Rule Master'),
    'Audit Trail': valid('Audit Trail'),
  }
}
