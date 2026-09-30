const { spawnSync } = require('node:child_process')
const { version } = require('../package.json')

const imageName = 'clinical-data-capture-web-app'
const mode = process.argv[2] || 'local'

function requireGhcrOwner() {
  const owner = process.env.GHCR_OWNER?.trim().toLowerCase()

  if (!owner) {
    console.error('GHCR_OWNER is required. Example (PowerShell): $env:GHCR_OWNER="your-github-username"')
    process.exit(1)
  }

  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner)) {
    console.error('GHCR_OWNER must be a valid GitHub user or organization name.')
    process.exit(1)
  }

  return owner
}

function runDocker(args) {
  const result = spawnSync(
    process.platform === 'win32' ? 'docker.exe' : 'docker',
    args,
    { stdio: 'inherit' },
  )

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

if (mode === 'local') {
  const imageTag = `${imageName}:${version}`
  console.log(`Building ${imageTag}`)
  runDocker([
    'build',
    '--build-arg', `APP_VERSION=${version}`,
    '-t', imageTag,
    '.',
  ])
}

if (mode === 'ghcr' || mode === 'push-ghcr') {
  const owner = requireGhcrOwner()
  const imageTag = `ghcr.io/${owner}/${imageName}:${version}`

  if (mode === 'push-ghcr') {
    console.log(`Pushing ${imageTag}`)
    runDocker(['push', imageTag])
  }

  const sourceUrl = process.env.GHCR_SOURCE_URL?.trim()
    || `https://github.com/${owner}/${imageName}`

  console.log(`Building ${imageTag}`)
  runDocker([
    'build',
    '--build-arg', `APP_VERSION=${version}`,
    '--build-arg', `SOURCE_REPOSITORY=${sourceUrl}`,
    '-t', imageTag,
    '.',
  ])
}

console.error(`Unknown Docker build mode: ${mode}`)
process.exit(1)
