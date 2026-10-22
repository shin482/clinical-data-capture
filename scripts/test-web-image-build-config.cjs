'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-edc-web-test-image.yml'), 'utf8')
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')
const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8')

test('test image workflow is manual, amd64-only, and never publishes', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /platforms: linux\/amd64/)
  assert.match(workflow, /push: false/)
  assert.doesNotMatch(workflow, /docker\/login-action|packages:\s*write|docker\s+push/)
})

test('test identity is immutable and records source revision and build digest', () => {
  assert.match(workflow, /secret-file-test-\$\{short_sha\}-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/)
  assert.match(workflow, /SOURCE_REVISION=\$\{\{ github\.sha \}\}/)
  assert.match(workflow, /buildx_digest=\$\{\{ steps\.build\.outputs\.digest \}\}/)
  assert.match(dockerfile, /org\.opencontainers\.image\.revision=\$SOURCE_REVISION/)
})

test('OCI artifact requests SBOM and provenance and contains secret reader source', () => {
  assert.match(workflow, /outputs: type=oci/)
  assert.match(workflow, /provenance: mode=max/)
  assert.match(workflow, /sbom: true/)
  assert.doesNotMatch(dockerignore, /^lib\/$/m)
  assert.match(dockerignore, /^update-agent\/$/m)
})

test('local and operating artifacts are excluded from Docker build context', () => {
  for (const entry of ['artifacts/', 'edc-integrated-installer/', '.git/']) assert.ok(dockerignore.includes(entry))
})
