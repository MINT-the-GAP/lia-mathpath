import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, test } from 'node:test'

import { JSDOM, VirtualConsole } from 'jsdom'

let bundleSource = ''

before(async () => {
  bundleSource = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8')
})

function entry(term, aliases = [], explanation = `${term} erklärt`) {
  return { term, aliases, explanation, tags: [], links: [] }
}

function markElmOwned(element) {
  Object.defineProperty(element, 'created_by_elm', {
    configurable: true,
    writable: true,
    value: true
  })
  return element
}

function highlights(document, scope = document) {
  return Array.from(scope.querySelectorAll('.lia-mathpath-glossary-highlight'))
}

async function flushDomWork() {
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
  await Promise.resolve()
}

async function withMathPath(body, callback, options = {}) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://example.test/course/',
    virtualConsole
  })
  const { window } = dom
  window.fetch = async () => ({ ok: false, text: async () => '' })
  window.setInterval = () => 1
  window.clearInterval = () => {}
  if (!options.realObserver) {
    window.MutationObserver = class {
      observe() {}
      disconnect() {}
      takeRecords() { return [] }
    }
  }
  options.beforeEval?.(window)

  try {
    const evaluations = options.evaluations || 1
    for (let i = 0; i < evaluations; i++) window.eval(bundleSource)
    assert.ok(window.__LIA_MATHPATH__, 'bundle must expose the MathPath API')
    await callback({ dom, window, document: window.document, api: window.__LIA_MATHPATH__, errors })
    await flushDomWork()
  } finally {
    dom.window.close()
  }
}

test('activates an Elm-owned em without replacing the element or its text node', async () => {
  await withMathPath('<p><em>Bruch</em></p>', ({ document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const emphasis = paragraph.querySelector('em')
    const textNode = emphasis.firstChild

    api.setGlossary([entry('Bruch')])

    assert.strictEqual(paragraph.querySelector('em'), emphasis)
    assert.strictEqual(emphasis.firstChild, textNode)
    assert.equal(emphasis.textContent, 'Bruch')
    assert.equal(emphasis.dataset.liaTerm, 'Bruch')
    assert.equal(emphasis.classList.contains('lia-mathpath-glossary-highlight'), true)
    assert.equal(emphasis.classList.contains('lia-mathpath-term'), true)
  })
})

test('leaves unmarked text in Elm-owned DOM untouched', async () => {
  await withMathPath('<p>Ein Bruch bleibt normaler Kurstext.</p>', ({ document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild

    api.setGlossary([entry('Bruch')])

    assert.strictEqual(paragraph.firstChild, textNode)
    assert.equal(paragraph.textContent, 'Ein Bruch bleibt normaler Kurstext.')
    assert.equal(highlights(document, paragraph).length, 0)
  })
})

test('automatically highlights unmanaged text', async () => {
  await withMathPath('<p>Ein Bruch ist markiert.</p>', ({ document, api }) => {
    const paragraph = document.querySelector('p')
    const originalTextNode = paragraph.firstChild

    api.setGlossary([entry('Bruch')])

    const highlight = paragraph.querySelector('.lia-mathpath-glossary-highlight')
    assert.ok(highlight)
    assert.notStrictEqual(paragraph.firstChild, originalTextNode)
    assert.equal(highlight.textContent, 'Bruch')
    assert.equal(highlight.dataset.liaTerm, 'Bruch')
  })
})

test('binds explicit data-lia-term and opens the canonical tooltip on hover and click', async () => {
  await withMathPath('<span data-lia-term="Brüche">Brüche</span>', ({ window, document, api }) => {
    const term = document.querySelector('[data-lia-term]')
    api.setGlossary([entry('Bruch', ['Brüche'], 'Ein Teil eines Ganzen.')])
    assert.equal(term.classList.contains('lia-mathpath-term'), true)

    term.dispatchEvent(new window.MouseEvent('mouseenter'))
    let tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.ok(tooltip)
    assert.equal(tooltip.dataset.open, '1')
    assert.equal(tooltip.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
    assert.match(tooltip.querySelector('.lia-mathpath-tooltip-body')?.textContent || '', /Teil eines Ganzen/)

    term.dispatchEvent(new window.MouseEvent('mouseleave'))
    assert.equal(tooltip.dataset.open, '0')

    term.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip.dataset.open, '1')
    assert.equal(tooltip.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
  })
})

test('maps controlled aliases and inflections to canonical entries', async () => {
  await withMathPath(
    '<p>Bruch, Brüche, Brüchen, erweitert, Erweitern, gekürzt und Kürzen.</p>',
    ({ document, api }) => {
      api.setGlossary([
        entry('Bruch', ['Brüche', 'Brüchen']),
        entry('Erweitern', ['erweitert']),
        entry('Kürzen', ['gekürzt'])
      ])

      assert.deepEqual(highlights(document).map(element => [element.textContent, element.dataset.liaTerm]), [
        ['Bruch', 'Bruch'],
        ['Brüche', 'Bruch'],
        ['Brüchen', 'Bruch'],
        ['erweitert', 'Erweitern'],
        ['Erweitern', 'Erweitern'],
        ['gekürzt', 'Kürzen'],
        ['Kürzen', 'Kürzen']
      ])
      assert.equal(api.getGlossary('Brüche')?.term, 'Bruch')
      assert.equal(api.getGlossary('Brüchen')?.term, 'Bruch')
      assert.equal(api.getGlossary('erweitert')?.term, 'Erweitern')
      assert.equal(api.getGlossary('gekürzt')?.term, 'Kürzen')
    }
  )
})

test('prefers exact and longer matches and avoids uncontrolled compound stemming', async () => {
  await withMathPath(
    '<p>Teilung, Bruchstrich, Bruch und Divisionsoperator.</p>',
    ({ document, api }) => {
      api.setGlossary([
        entry('Division', ['Teilung']),
        entry('Teilung'),
        entry('Bruch', ['Bruchstrich']),
        entry('Bruchstrich')
      ])

      const matches = highlights(document).map(element => [element.textContent, element.dataset.liaTerm])
      assert.deepEqual(matches, [
        ['Teilung', 'Teilung'],
        ['Bruchstrich', 'Bruchstrich'],
        ['Bruch', 'Bruch']
      ])
      assert.equal(api.getGlossary('Teilung')?.term, 'Teilung')
      assert.equal(matches.some(([text]) => text === 'Divisionsoperator'), false)
      assert.match(document.querySelector('p').textContent, /Divisionsoperator/)
    }
  )
})

test('keeps notip, code, KaTeX, tooltip and SVG contents excluded', async () => {
  const body = [
    '<div class="notip"><em>Bruch</em></div>',
    '<code><em>Bruch</em></code>',
    '<span class="katex"><em>Bruch</em></span>',
    '<div class="lia-mathpath-tooltip"><em>Bruch</em></div>',
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Bruch</text></svg>'
  ].join('')

  await withMathPath(body, ({ document, api }) => {
    const elements = Array.from(document.body.querySelectorAll('em, text'))
    const textNodes = elements.map(element => element.firstChild)

    api.setGlossary([entry('Bruch')])

    assert.equal(highlights(document).length, 0)
    assert.equal(document.querySelector('[data-lia-term]'), null)
    assert.deepEqual(elements.map(element => element.firstChild), textNodes)
  })
})

test('is idempotent for generated highlights and per-element listeners', async () => {
  await withMathPath('<em>Bruch</em><p>Bruch</p>', ({ document, api }) => {
    const semanticTerm = document.querySelector('em')
    const plainText = document.querySelector('p')
    const listenerCounts = new Map()
    const nativeAddEventListener = semanticTerm.addEventListener
    semanticTerm.addEventListener = function (type, listener, options) {
      listenerCounts.set(type, (listenerCounts.get(type) || 0) + 1)
      return nativeAddEventListener.call(this, type, listener, options)
    }

    const glossary = [entry('Bruch')]
    api.setGlossary(glossary)
    const semanticTextNode = semanticTerm.firstChild
    const generatedHighlight = plainText.querySelector('.lia-mathpath-glossary-highlight')
    api.setGlossary(glossary)

    assert.strictEqual(semanticTerm.firstChild, semanticTextNode)
    assert.strictEqual(plainText.querySelector('.lia-mathpath-glossary-highlight'), generatedHighlight)
    assert.equal(plainText.querySelectorAll('.lia-mathpath-glossary-highlight').length, 1)
    assert.deepEqual(Object.fromEntries(listenerCounts), {
      mouseenter: 1,
      pointerdown: 1,
      mouseleave: 1,
      click: 1
    })
  })
})

test('duplicate bundle evaluation does not duplicate global listeners', async () => {
  const documentCounts = new Map()
  const windowCounts = new Map()

  await withMathPath('', async () => {}, {
    evaluations: 2,
    beforeEval(window) {
      const nativeDocumentAdd = window.document.addEventListener
      const nativeWindowAdd = window.addEventListener
      window.document.addEventListener = function (type, listener, options) {
        documentCounts.set(type, (documentCounts.get(type) || 0) + 1)
        return nativeDocumentAdd.call(this, type, listener, options)
      }
      window.addEventListener = function (type, listener, options) {
        windowCounts.set(type, (windowCounts.get(type) || 0) + 1)
        return nativeWindowAdd.call(this, type, listener, options)
      }
    }
  })

  assert.equal(documentCounts.get('click'), 1)
  assert.equal(documentCounts.get('keydown'), 1)
  assert.equal(windowCounts.get('scroll'), 1)
  assert.equal(windowCounts.get('resize'), 1)
})

test('observer activates inserted Elm emphasis and detached pinned targets stay safe', async () => {
  await withMathPath('', async ({ window, document, api, errors }) => {
    api.setGlossary([entry('Bruch')])
    const paragraph = markElmOwned(document.createElement('p'))
    paragraph.innerHTML = '<em>Bruch</em>'
    const emphasis = paragraph.querySelector('em')
    const textNode = emphasis.firstChild

    document.body.append(paragraph)
    await flushDomWork()

    assert.strictEqual(paragraph.querySelector('em'), emphasis)
    assert.strictEqual(emphasis.firstChild, textNode)
    assert.equal(emphasis.dataset.liaTerm, 'Bruch')

    emphasis.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '1')
    paragraph.remove()
    assert.doesNotThrow(() => window.dispatchEvent(new window.Event('scroll')))
    assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '0')

    await flushDomWork()
    assert.deepEqual(errors, [])
  }, { realObserver: true })
})
