import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { JSDOM } from 'jsdom'

test('parses legacy and alias glossary tables without splitting escaped pipes', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/course/'
  })
  const names = ['window', 'document', 'location']
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))

  try {
    for (const name of names) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: name === 'window' ? dom.window : dom.window[name]
      })
    }

    // store.ts reads window/document at module evaluation time.
    const { parseGlossaryMarkdown } = await import('../src/store.ts')
    const legacy = parseGlossaryMarkdown(String.raw`| Begriff | Erklärung |
|---|---|
| Rest | Es gilt $0\le r<\|b\|$. |`)

    assert.equal(legacy.length, 1)
    assert.equal(legacy[0].term, 'Rest')
    assert.equal(legacy[0].explanation, String.raw`Es gilt $0\le r<\|b\|$.`)
    assert.deepEqual(legacy[0].aliases, [])

    const withAliases = parseGlossaryMarkdown(`| Begriff | Aliasformen | Erklärung |
|---|---|---|
| Bruch | Brüche; Brüchen | Ein Teil eines Ganzen. |`)

    assert.equal(withAliases.length, 1)
    assert.equal(withAliases[0].term, 'Bruch')
    assert.deepEqual(withAliases[0].aliases, ['Brüche', 'Brüchen'])
    assert.equal(withAliases[0].explanation, 'Ein Teil eines Ganzen.')

    const actualMarkdown = await readFile(new URL('../Glossar.md', import.meta.url), 'utf8')
    const actualEntries = parseGlossaryMarkdown(actualMarkdown)
    const actualByTerm = new Map(actualEntries.map(entry => [entry.term, entry]))
    const actualAliases = actualEntries.flatMap(entry => entry.aliases || [])

    assert.equal(actualEntries.length, 381)
    assert.deepEqual(actualByTerm.get('Einheit')?.aliases, ['Einheiten'])
    assert.deepEqual(actualByTerm.get('Zahl')?.aliases, ['Zahlen'])
    assert.equal(actualAliases.includes('einheitlich'), false)
    assert.equal(actualByTerm.get('Division')?.aliases.includes('dividiert'), false)
    assert.equal(actualByTerm.get('Multiplikation')?.aliases.includes('multipliziert'), false)
    assert.ok(actualByTerm.has('Gleichungssystem'))
    assert.ok(actualByTerm.has('Standardabweichung'))
  } finally {
    dom.window.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})
