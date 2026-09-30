const GHCR_ORIGIN = 'https://ghcr.io'
const GHCR_TOKEN_ENDPOINT = `${GHCR_ORIGIN}/token`
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function parseSemanticVersion(value) {
  const match = SEMANTIC_VERSION.exec(value)
  return match ? match.slice(1).map(BigInt) : null
}

function compareSemanticVersions(left, right) {
  const leftParts = parseSemanticVersion(left)
  const rightParts = parseSemanticVersion(right)
  if (!leftParts || !rightParts) throw new Error('Invalid semantic version')

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1
    if (leftParts[index] < rightParts[index]) return -1
  }
  return 0
}

function latestSemanticVersion(tags) {
  const versions = tags.filter((tag) => typeof tag === 'string' && parseSemanticVersion(tag))
  if (versions.length === 0) throw new Error('GHCR returned no semantic version tags')
  return versions.reduce((latest, candidate) => (
    compareSemanticVersions(candidate, latest) > 0 ? candidate : latest
  ))
}

async function readJson(response, failureMessage) {
  if (!response.ok) throw new Error(failureMessage)
  try {
    return await response.json()
  } catch {
    throw new Error(failureMessage)
  }
}

function createGhcrVersionProvider(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const repository = config.imageRepository.slice('ghcr.io/'.length)
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/')

  return async function getLatestVersion() {
    const credentials = Buffer.from(`${config.ghcrUsername}:${config.ghcrToken}`).toString('base64')
    const tokenUrl = new URL(GHCR_TOKEN_ENDPOINT)
    tokenUrl.searchParams.set('service', 'ghcr.io')
    tokenUrl.searchParams.set('scope', `repository:${repository}:pull`)

    let tokenResponse
    try {
      tokenResponse = await fetchImpl(tokenUrl, {
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      throw new Error('GHCR authentication request failed')
    }

    const tokenBody = await readJson(tokenResponse, 'GHCR authentication failed')
    const registryToken = tokenBody.token || tokenBody.access_token
    if (typeof registryToken !== 'string' || !registryToken) {
      throw new Error('GHCR authentication failed')
    }

    let tagsResponse
    try {
      tagsResponse = await fetchImpl(
        `${GHCR_ORIGIN}/v2/${encodedRepository}/tags/list?n=1000`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${registryToken}`,
          },
          signal: AbortSignal.timeout(10000),
        },
      )
    } catch {
      throw new Error('GHCR tags request failed')
    }

    const tagsBody = await readJson(tagsResponse, 'GHCR tags request failed')
    if (!Array.isArray(tagsBody.tags)) throw new Error('GHCR tags response was invalid')
    return latestSemanticVersion(tagsBody.tags)
  }
}

module.exports = {
  compareSemanticVersions,
  createGhcrVersionProvider,
  latestSemanticVersion,
  parseSemanticVersion,
}
