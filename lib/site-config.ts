export const siteCodes = ['IJH', 'EWH', 'SCH'] as const
export type SiteCode = typeof siteCodes[number]

export function getSiteCode(site: string | null | undefined): SiteCode {
  const candidate = String(site || '').trim().toUpperCase().split(/\s|\u00b7/)[0]
  return siteCodes.includes(candidate as SiteCode) ? candidate as SiteCode : 'IJH'
}
