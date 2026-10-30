#!/usr/bin/env node

import { copyFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..')

export function bundleSlugForVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim())
  if (!match) {
    throw new Error(`Package version must be an exact numeric semver: ${version}`)
  }
  return `v${match[1]}x${match[2]}x${match[3]}`
}

export function bundleFilenameForVersion(version) {
  return `index.${bundleSlugForVersion(version)}.js`
}

export async function createVersionedBundle(root = repositoryRoot) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const filename = bundleFilenameForVersion(manifest.version)
  const canonicalPath = path.join(root, 'dist', 'index.js')
  const versionedPath = path.join(root, 'dist', filename)

  await copyFile(canonicalPath, versionedPath)
  return { filename, canonicalPath, versionedPath }
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(scriptPath)

if (invokedDirectly) {
  const { filename } = await createVersionedBundle()
  process.stdout.write(`Created dist/${filename} from dist/index.js\n`)
}
