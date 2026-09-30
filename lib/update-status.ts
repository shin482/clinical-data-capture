export type UpdateStatus = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
}

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseUpdateStatus(value: unknown): UpdateStatus | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.currentVersion !== 'string'
    || !versionPattern.test(candidate.currentVersion)
    || typeof candidate.latestVersion !== 'string'
    || !versionPattern.test(candidate.latestVersion)
    || typeof candidate.updateAvailable !== 'boolean') return null

  return {
    currentVersion: candidate.currentVersion,
    latestVersion: candidate.latestVersion,
    updateAvailable: candidate.updateAvailable,
  }
}

export function displayVersion(version: string) {
  return version.startsWith('v') ? version : `v${version}`
}
