import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  bundleFilenameForVersion,
  bundleSlugForVersion
} from '../scripts/version-bundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const readme = await readFile(path.join(root, 'README.md'), 'utf8')
const auxiliaryTemplates = await Promise.all([
  readFile(path.join(root, 'Explain.md'), 'utf8'),
  readFile(path.join(root, 'Glossar.md'), 'utf8')
])
const filename = bundleFilenameForVersion(manifest.version)

test('release bundle slug is deterministic and rejects ambiguous versions', () => {
  assert.equal(bundleSlugForVersion('0.0.19'), 'v0x0x19')
  assert.equal(bundleFilenameForVersion('12.3.45'), 'index.v12x3x45.js')
  assert.throws(() => bundleSlugForVersion('0.0.19-beta.1'), /exact numeric semver/)
  assert.throws(() => bundleSlugForVersion('v0.0.19'), /exact numeric semver/)
})

test('README version and query-free script path match the package release', () => {
  const readmeVersion = readme.match(/^version:\s*(\S+)$/m)?.[1]
  const scriptPath = readme.match(/^script:\s*(\S+)$/m)?.[1]

  assert.equal(readmeVersion, manifest.version)
  assert.equal(scriptPath, `./dist/${filename}`)
  assert.ok(!scriptPath.includes('?'))
  assert.match(filename, /^index\.[a-z0-9]+\.js$/i)
})

test('auxiliary MathPath templates use the same query-free release bundle', () => {
  for (const source of auxiliaryTemplates) {
    assert.equal(source.match(/^script:\s*(\S+)$/m)?.[1], `./dist/${filename}`)
    assert.doesNotMatch(source, /^script:.*\?/m)
  }
})

test('versioned release bundle is byte-identical to dist/index.js', async () => {
  const [canonical, versioned] = await Promise.all([
    readFile(path.join(root, 'dist', 'index.js')),
    readFile(path.join(root, 'dist', filename))
  ])

  assert.deepEqual(versioned, canonical)
})
