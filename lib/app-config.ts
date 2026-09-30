import packageJson from '../package.json'

// Shared display metadata for the sidebar and Help.
export const appConfig = {
  version: `v${packageJson.version}`,
  site: 'IJH · 인제대 일산 백병원',
} as const
