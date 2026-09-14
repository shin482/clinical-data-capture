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
export function readPageAccess(storage: Pick<Storage, 'getItem'>): PageAccess {
  return {
    'Rule Master': storage.getItem(pageSessionKeys['Rule Master']) === 'true',
    'Audit Trail': storage.getItem(pageSessionKeys['Audit Trail']) === 'true',
  }
}
