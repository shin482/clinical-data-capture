import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

export class SecretConfigurationError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'SecretConfigurationError'
  }
}

export function readConfiguredSecret(
  environment: NodeJS.ProcessEnv,
  name: string,
  options: { allowedRoot?: string; minimumLength?: number } = {},
) {
  const inline = environment[name]?.trim()
  const configuredFile = environment[`${name}_FILE`]?.trim()
  if (inline && configuredFile) throw new SecretConfigurationError('SECRET_SOURCE_AMBIGUOUS')
  if (!configuredFile) {
    if (!inline) return null
    if (inline.length < (options.minimumLength || 1)) throw new SecretConfigurationError('SECRET_FORMAT_INVALID')
    return inline
  }

  try {
    if (!path.isAbsolute(configuredFile)) throw new SecretConfigurationError('SECRET_PATH_INVALID')
    if (lstatSync(configuredFile).isSymbolicLink()) throw new SecretConfigurationError('SECRET_FILE_INVALID')
    const allowedRoot = realpathSync(/* turbopackIgnore: true */ options.allowedRoot || '/run/secrets')
    const candidate = realpathSync(/* turbopackIgnore: true */ configuredFile)
    const relative = path.relative(allowedRoot, candidate)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new SecretConfigurationError('SECRET_PATH_INVALID')
    }
    const stat = lstatSync(candidate)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4096) {
      throw new SecretConfigurationError('SECRET_FILE_INVALID')
    }
    const value = readFileSync(candidate, 'utf8').trim()
    if (!value || value.includes('\0') || /[\r\n]/.test(value)
      || value.length < (options.minimumLength || 1)) {
      throw new SecretConfigurationError('SECRET_FORMAT_INVALID')
    }
    return value
  } catch (error) {
    if (error instanceof SecretConfigurationError) throw error
    throw new SecretConfigurationError('SECRET_FILE_UNAVAILABLE')
  }
}
