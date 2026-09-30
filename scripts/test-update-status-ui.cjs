const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename)

const { displayVersion, parseUpdateStatus } = require('../lib/update-status.ts')

assert.deepEqual(parseUpdateStatus({
  currentVersion: '1.0.0',
  latestVersion: '1.0.0',
  updateAvailable: false,
}), { currentVersion: '1.0.0', latestVersion: '1.0.0', updateAvailable: false })

assert.deepEqual(parseUpdateStatus({
  currentVersion: '1.0.0',
  latestVersion: '1.1.0',
  updateAvailable: true,
}), { currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true })

assert.equal(parseUpdateStatus({ error: 'Update Agent unavailable' }), null)
assert.equal(displayVersion('1.1.0'), 'v1.1.0')
assert.equal(displayVersion('v1.0.0'), 'v1.0.0')

const component = fs.readFileSync('components/clinical/help-modal.tsx', 'utf8')
assert.match(component, /fetch\('\/api\/update\/status'/)
assert.match(component, /fetch\('\/api\/update'/)
assert.doesNotMatch(component, /127\.0\.0\.1:3210/)
assert.doesNotMatch(component, /UPDATE_AGENT_AUTH_TOKEN|GHCR_TOKEN/)
assert.match(component, /method:\s*['"]POST['"]/)
assert.match(component, /최신 버전을 사용하고 있습니다\./)
assert.match(component, /새로운 버전이 있습니다:/)
assert.match(component, /업데이트 정보를 확인할 수 없습니다\./)
assert.match(component, /updateRequestInFlight\.current/)
assert.match(component, /disabled=\{updateState\.kind === 'checking' \|\| updateState\.kind === 'updating'\}/)
assert.match(component, /업데이트를 시작했습니다\./)
assert.match(component, /페이지를 새로고침하거나 다시 접속해 주세요\./)

console.log('PASS: update status/action states, EDC-only API calls, duplicate-click guard, no browser secrets')
