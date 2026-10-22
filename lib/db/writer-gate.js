const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')

const context = new AsyncLocalStorage()
const OWNER_FIELDS = Object.freeze(['jobId', 'requestId', 'hospital', 'installationId'])

class WriterGateClosedError extends Error {
  constructor() {
    super('Database writes are temporarily paused for update safety checks.')
    this.name = 'WriterGateClosedError'
    this.code = 'WRITER_GATE_CLOSED'
    this.status = 503
  }
}

function validOwner(value) {
  return value && typeof value === 'object'
    && OWNER_FIELDS.every((field) => typeof value[field] === 'string' && value[field].length > 0)
}

function sameOwner(left, right) {
  return validOwner(left) && validOwner(right) && OWNER_FIELDS.every((field) => left[field] === right[field])
}

function createWriterGate(options = {}) {
  const barrierControlEnabled = options.barrierControlEnabled === true
  const maintenanceControlEnabled = options.maintenanceControlEnabled === true
  const generationFactory = options.generationFactory || crypto.randomUUID
  const clock = options.clock || (() => new Date())
  let activeWriters = 0
  let owner = null
  let generation = null
  let acquiredAt = null
  let activeMaintenance = 0
  const maintenanceAuthorities = new WeakSet()

  function status() {
    return Object.freeze({
      closed: owner !== null,
      activeWriters,
      activeMaintenance,
      drained: owner !== null && activeWriters === 0,
      owner: owner ? Object.freeze({ ...owner }) : null,
      generation,
      acquiredAt,
      barrierControlEnabled,
      externalWritersVerified: false,
      decision: owner && activeWriters === 0 ? 'WRITER_BARRIER_INCOMPLETE' : 'NOT_DRAINED',
      operatingMutationAuthorized: false,
    })
  }

  function beginWrite() {
    const nested = context.getStore()
    if (nested?.gate === api && nested.active === true) {
      return Object.freeze({ nested: true, finish() {} })
    }
    if (owner || activeMaintenance > 0) throw new WriterGateClosedError()
    activeWriters += 1
    let active = true
    return Object.freeze({
      nested: false,
      finish() {
        if (!active) return
        active = false
        activeWriters -= 1
        if (activeWriters < 0) throw new Error('WRITER_GATE_COUNTER_CORRUPT')
      },
    })
  }

  function runWrite(operation) {
    if (typeof operation !== 'function') throw new TypeError('WRITER_OPERATION_REQUIRED')
    const nested = context.getStore()
    if (nested?.gate === api && nested.active === true) return operation()
    const lease = beginWrite()
    return context.run({ gate: api, active: true }, () => {
      try {
        const value = operation()
        if (value && typeof value.then === 'function') return value.finally(() => lease.finish())
        lease.finish()
        return value
      } catch (error) {
        lease.finish()
        throw error
      }
    })
  }

  function runTransaction(database, operation) {
    if (!database || typeof database.transaction !== 'function') throw new TypeError('SQLITE_DATABASE_REQUIRED')
    return runWrite(() => database.transaction(operation)())
  }

  function issueMaintenanceAuthority(binding = {}) {
    if (!maintenanceControlEnabled || binding.scope !== 'startup_database_maintenance'
      || binding.operatingTrusted !== false) return null
    const authority = Object.freeze(Object.create(null))
    maintenanceAuthorities.add(authority)
    return authority
  }

  function runMaintenance(authority, operation) {
    if (!maintenanceAuthorities.has(authority)) throw Object.assign(new Error('MAINTENANCE_AUTHORITY_REQUIRED'), { code: 'MAINTENANCE_AUTHORITY_REQUIRED' })
    if (typeof operation !== 'function') throw new TypeError('MAINTENANCE_OPERATION_REQUIRED')
    if (owner || activeWriters !== 0 || activeMaintenance !== 0) {
      throw Object.assign(new Error('MAINTENANCE_CONCURRENCY_BLOCKED'), { code: 'MAINTENANCE_CONCURRENCY_BLOCKED' })
    }
    activeMaintenance = 1
    try {
      const value = operation()
      if (value && typeof value.then === 'function') return value.finally(() => { activeMaintenance = 0 })
      activeMaintenance = 0
      return value
    } catch (error) {
      activeMaintenance = 0
      throw error
    }
  }

  function acquireBarrier(expectedOwner) {
    if (!barrierControlEnabled) return Object.freeze({ ok: false, code: 'WRITER_BARRIER_CONTROL_DISABLED', ...status() })
    if (!validOwner(expectedOwner)) return Object.freeze({ ok: false, code: 'WRITER_BARRIER_OWNER_INVALID', ...status() })
    if (owner) return Object.freeze({ ok: false, code: 'WRITER_BARRIER_ALREADY_HELD', ...status() })
    if (activeMaintenance !== 0) return Object.freeze({ ok: false, code: 'WRITER_BARRIER_MAINTENANCE_ACTIVE', ...status() })
    owner = Object.freeze({ ...expectedOwner })
    generation = generationFactory()
    const time = clock()
    acquiredAt = time instanceof Date && !Number.isNaN(time.valueOf()) ? time.toISOString() : null
    return Object.freeze({ ok: true, code: activeWriters === 0 ? 'PROCESS_WRITERS_DRAINED' : 'PROCESS_WRITERS_DRAINING', ...status() })
  }

  function releaseBarrier(expectedOwner, expectedGeneration) {
    if (!barrierControlEnabled) return Object.freeze({ ok: false, code: 'WRITER_BARRIER_CONTROL_DISABLED', ...status() })
    if (!sameOwner(owner, expectedOwner)) return Object.freeze({ ok: false, code: 'WRITER_BARRIER_OWNER_MISMATCH', ...status() })
    if (generation !== expectedGeneration) return Object.freeze({ ok: false, code: 'WRITER_BARRIER_GENERATION_MISMATCH', ...status() })
    owner = null
    generation = null
    acquiredAt = null
    return Object.freeze({ ok: true, code: 'WRITER_BARRIER_RELEASED', ...status() })
  }

  const api = Object.freeze({ acquireBarrier, beginWrite, issueMaintenanceAuthority, releaseBarrier,
    runMaintenance, runTransaction, runWrite, status,
    operatingMutationAuthorized: false })
  return api
}

const applicationWriterGate = createWriterGate({ barrierControlEnabled: false, maintenanceControlEnabled: true })
const startupMaintenanceAuthority = applicationWriterGate.issueMaintenanceAuthority({
  scope: 'startup_database_maintenance', operatingTrusted: false,
})

function runApplicationStartupMaintenance(operation) {
  return applicationWriterGate.runMaintenance(startupMaintenanceAuthority, operation)
}

module.exports = { WriterGateClosedError, applicationWriterGate, createWriterGate,
  runApplicationStartupMaintenance, sameOwner, validOwner }
