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

function installRangeHitTesting(window, {
  legacyCaret = false,
  cssHighlights = true,
  maxHighlightConstructorArgs = Infinity
} = {}) {
  const state = {
    node: null,
    offset: 0,
    highlightRegistry: null,
    highlightConstructorArgumentCounts: [],
    rect: {
      x: 40,
      y: 20,
      left: 40,
      top: 20,
      right: 180,
      bottom: 44,
      width: 140,
      height: 24,
      toJSON() { return this }
    },
    setCaret(node, offset) {
      this.node = node
      this.offset = offset
    },
    clearCaret() {
      this.node = null
      this.offset = 0
    }
  }

  function caretPosition() {
    if (!state.node || !state.node.isConnected) return null
    return { offsetNode: state.node, offset: state.offset }
  }

  function caretRange() {
    const position = caretPosition()
    if (!position) return null
    const range = window.document.createRange()
    range.setStart(position.offsetNode, position.offset)
    range.collapse(true)
    return range
  }

  if (legacyCaret) {
    Object.defineProperty(window.document, 'caretPositionFromPoint', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window.document, 'caretRangeFromPoint', {
      configurable: true,
      value: caretRange
    })
  } else {
    Object.defineProperty(window.document, 'caretPositionFromPoint', {
      configurable: true,
      value: caretPosition
    })
    Object.defineProperty(window.document, 'caretRangeFromPoint', {
      configurable: true,
      value: undefined
    })
  }

  Object.defineProperty(window.Range.prototype, 'getClientRects', {
    configurable: true,
    value() {
      if (this.collapsed || !this.startContainer?.isConnected) return []
      const rects = [state.rect]
      rects.item = index => rects[index] || null
      return rects
    }
  })
  Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return this.collapsed || !this.startContainer?.isConnected
        ? { ...state.rect, width: 0, height: 0, right: state.rect.left, bottom: state.rect.top }
        : state.rect
    }
  })

  if (cssHighlights) {
    const css = window.CSS || {}
    const highlightRegistry = new Map()
    state.highlightRegistry = highlightRegistry
    Object.defineProperty(css, 'highlights', {
      configurable: true,
      value: highlightRegistry
    })
    window.CSS = css
    window.Highlight = class Highlight extends Set {
      constructor(...ranges) {
        super()
        state.highlightConstructorArgumentCounts.push(ranges.length)
        if (ranges.length > maxHighlightConstructorArgs) {
          throw new RangeError(`Highlight accepts at most ${maxHighlightConstructorArgs} constructor arguments`)
        }
        ranges.forEach(range => this.add(range))
      }
    }
  }

  return state
}

function dispatchPointer(window, target, type, { x = 80, y = 30 } = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y
  })
  target.dispatchEvent(event)
  return event
}

function assertSameChildren(element, children) {
  assert.equal(element.childNodes.length, children.length)
  children.forEach((child, index) => assert.strictEqual(element.childNodes[index], child))
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

async function assertVirtualHoverCloses(dispatchExit) {
  let hitTesting
  await withMathPath('<p>Ein Bruch bleibt normaler Kurstext.</p>', ({ window, document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch')])
    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')

    const tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.dataset.open, '1')
    dispatchExit({ window, document, paragraph })
    assert.equal(tooltip?.dataset.open, '0')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
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

test('tooltips an unmarked term in Elm-owned text by range without changing its DOM', async () => {
  let hitTesting
  await withMathPath('<p>Ein Bruch bleibt normaler Kurstext.</p>', ({ window, document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch', [], 'Ein Teil eines Ganzen.')])

    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
    assert.equal(paragraph.textContent, 'Ein Bruch bleibt normaler Kurstext.')
    assert.equal(highlights(document, paragraph).length, 0)

    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')

    let tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.ok(tooltip)
    assert.equal(tooltip.dataset.open, '1')
    assert.equal(tooltip.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
    assert.match(tooltip.querySelector('.lia-mathpath-tooltip-body')?.textContent || '', /Teil eines Ganzen/)

    hitTesting.clearCaret()
    dispatchPointer(window, document.body, 'pointermove', { x: 300, y: 100 })
    assert.equal(tooltip.dataset.open, '0', 'moving away closes an unpinned range tooltip')

    hitTesting.setCaret(textNode, 6)
    const pointerdown = dispatchPointer(window, paragraph, 'pointerdown')
    const click = dispatchPointer(window, paragraph, 'click')
    assert.equal(pointerdown.defaultPrevented, false, 'range interaction must preserve text selection')
    assert.equal(click.defaultPrevented, false, 'range clicks must not cancel the authored text event')
    tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip.dataset.open, '1')
    assert.equal(tooltip.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')

    hitTesting.clearCaret()
    dispatchPointer(window, document.body, 'pointermove', { x: 300, y: 100 })
    assert.equal(tooltip.dataset.open, '1', 'click pins a range tooltip')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('maps an Elm-owned range alias with legacy caret hit-testing and no CSS Highlight API', async () => {
  let hitTesting
  await withMathPath('<p>Ein Anteil kann als Bruch geschrieben werden.</p>', ({ window, document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch', ['Anteil'], 'Ein Teil eines Ganzen.')])

    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')

    const tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.ok(tooltip)
    assert.equal(tooltip.dataset.open, '1')
    assert.equal(tooltip.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
    assert.equal(api.getGlossary('Anteil')?.term, 'Bruch')
    assert.equal(highlights(document, paragraph).length, 0)
    assertSameChildren(paragraph, childNodes)
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window, {
        legacyCaret: true,
        cssHighlights: false
      })
    }
  })
})

test('reindexes Elm-owned ranges after characterData changes and removes stale hits', async () => {
  let hitTesting
  await withMathPath('<p>Ein Bruch entsteht.</p>', async ({ window, document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([
      entry('Bruch', [], 'Bruch-Erklaerung.'),
      entry('Summe', [], 'Summe-Erklaerung.')
    ])

    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')
    let tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')

    hitTesting.clearCaret()
    dispatchPointer(window, document.body, 'pointermove', { x: 300, y: 100 })
    textNode.data = 'Eine Summe entsteht.'
    await flushDomWork()

    hitTesting.setCaret(textNode, 7)
    dispatchPointer(window, paragraph, 'pointermove')
    tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.dataset.open, '1')
    assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Summe')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)

    hitTesting.clearCaret()
    dispatchPointer(window, document.body, 'pointermove', { x: 300, y: 100 })
    textNode.data = 'Kein Fachwort bleibt.'
    await flushDomWork()

    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')
    assert.equal(tooltip?.dataset.open, '0', 'a removed term must not retain a stale range hit')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)

    textNode.data = 'Ein Bruch entsteht.'
    await flushDomWork()
    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'click')
    assert.equal(tooltip?.dataset.open, '1')
    paragraph.remove()
    await flushDomWork()

    window.dispatchEvent(new window.Event('scroll'))
    assert.equal(tooltip?.dataset.open, '0', 'detaching the Elm container closes a pinned range tooltip')
  }, {
    realObserver: true,
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('closes an unpinned virtual tooltip immediately when characterData removes its term', async () => {
  let hitTesting
  await withMathPath('<p>Ein Bruch entsteht.</p>', async ({ window, document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch')])
    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')

    const tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.dataset.open, '1')

    textNode.data = 'Kein Fachwort bleibt.'
    await flushDomWork()

    assert.equal(
      tooltip?.dataset.open,
      '0',
      'the observer must close a stale unpinned hover without another pointer event'
    )
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
  }, {
    realObserver: true,
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('pointerout to outside the document closes an unpinned virtual hover', async () => {
  await assertVirtualHoverCloses(({ window, paragraph }) => {
    paragraph.dispatchEvent(new window.MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: null
    }))
  })
})

test('window blur closes an unpinned virtual hover', async () => {
  await assertVirtualHoverCloses(({ window }) => {
    window.dispatchEvent(new window.Event('blur'))
  })
})

test('fallback overlay repaints its range rectangles after a captured transitionend', async () => {
  let hitTesting
  await withMathPath('<p>Ein Bruch entsteht.</p>', async ({ window, document, api, errors }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch')])

    let marker = document.querySelector('.lia-mathpath-range-rect')
    assert.ok(marker)
    assert.equal(marker.style.left, '40px')
    assert.equal(marker.style.top, '20px')

    Object.assign(hitTesting.rect, {
      x: 90,
      y: 60,
      left: 90,
      top: 60,
      right: 230,
      bottom: 84
    })
    paragraph.dispatchEvent(new window.Event('transitionend', { bubbles: true }))
    await new Promise(resolve => window.requestAnimationFrame(resolve))

    marker = document.querySelector('.lia-mathpath-range-rect')
    assert.ok(marker)
    assert.equal(marker.style.left, '90px')
    assert.equal(marker.style.top, '60px')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
    assert.deepEqual(errors, [])
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window, { cssHighlights: false })
    }
  })
})

test('layout refresh repositions an unpinned virtual tooltip at a stationary pointer', async () => {
  let hitTesting
  await withMathPath('<p>Ein Bruch entsteht.</p>', async ({ window, document, api, errors }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch')])
    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove', { x: 80, y: 30 })

    const tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.dataset.open, '1')
    assert.equal(tooltip?.style.left, '40px')
    assert.equal(tooltip?.style.top, '10px')

    Object.assign(hitTesting.rect, {
      x: 60,
      y: 25,
      left: 60,
      top: 25,
      right: 200,
      bottom: 49
    })
    paragraph.dispatchEvent(new window.Event('transitionend', { bubbles: true }))
    await new Promise(resolve => window.requestAnimationFrame(resolve))

    assert.equal(tooltip?.dataset.open, '1')
    assert.equal(tooltip?.style.left, '60px')
    assert.equal(tooltip?.style.top, '15px')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)

    Object.assign(hitTesting.rect, {
      x: 240,
      y: 100,
      left: 240,
      top: 100,
      right: 380,
      bottom: 124
    })
    paragraph.dispatchEvent(new window.Event('transitionend', { bubbles: true }))
    await new Promise(resolve => window.requestAnimationFrame(resolve))

    assert.equal(
      tooltip?.dataset.open,
      '0',
      'moving the range away from the stored pointer closes an unpinned tooltip'
    )
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
    assert.deepEqual(errors, [])
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('layout refresh keeps a valid virtual hover below an overlapping tooltip', async () => {
  let hitTesting
  await withMathPath('<p>Ein Bruch entsteht.</p>', async ({ window, document, api, errors }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch')])
    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove', { x: 80, y: 30 })

    const tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.dataset.open, '1')
    assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')

    const stackCalls = []
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => tooltip
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: (x, y) => {
        stackCalls.push([x, y])
        return [tooltip, paragraph]
      }
    })

    paragraph.dispatchEvent(new window.Event('transitionend', { bubbles: true }))
    await new Promise(resolve => window.requestAnimationFrame(resolve))

    assert.equal(
      tooltip?.dataset.open,
      '1',
      'the tooltip overlay must not hide the authored range beneath it from hit-testing'
    )
    assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
    assert.ok(stackCalls.some(([x, y]) => x === 80 && y === 30))
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
    assert.deepEqual(errors, [])
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('dynamic no-glossary opt-out removes and restores an Elm-owned virtual term', async () => {
  let hitTesting
  await withMathPath('<p>Ein Bruch entsteht.</p>', async ({ window, document, api, errors }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    api.setGlossary([entry('Bruch')])
    const registry = hitTesting.highlightRegistry
    assert.ok(registry)
    assert.equal(registry.size, 1)

    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')
    const tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.dataset.open, '1')

    paragraph.classList.add('lia-mathpath-no-glossary')
    await flushDomWork()

    assert.equal(registry.size, 0, 'opting out removes normal-term ranges from the CSS registry')
    assert.equal(tooltip?.dataset.open, '0')
    dispatchPointer(window, paragraph, 'pointermove')
    assert.equal(tooltip?.dataset.open, '0', 'an opted-out paragraph no longer produces range hits')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)

    paragraph.classList.remove('lia-mathpath-no-glossary')
    await flushDomWork()

    assert.equal(registry.size, 1, 'removing the opt-out class registers the normal term again')
    const restoredHighlight = Array.from(registry.values())[0]
    assert.equal(restoredHighlight.size, 1)
    dispatchPointer(window, paragraph, 'pointermove')
    assert.equal(tooltip?.dataset.open, '1')
    assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
    assert.deepEqual(errors, [])
  }, {
    realObserver: true,
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('registers many virtual ranges in one Highlight without variadic constructor arguments', async () => {
  const termCount = 48
  const terms = Array.from(
    { length: termCount },
    (_, index) => `Fachwort${String(index + 1).padStart(2, '0')}`
  )
  let hitTesting

  await withMathPath(`<p>${terms.join(' ')}</p>`, ({ document, api }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    const textNode = paragraph.firstChild
    const childNodes = Array.from(paragraph.childNodes)

    assert.doesNotThrow(() => api.setGlossary(terms.map(term => entry(term))))

    const registry = hitTesting.highlightRegistry
    assert.ok(registry)
    assert.equal(registry.size, 1, 'all normal-term ranges share one registered Highlight')
    const registeredHighlight = Array.from(registry.values())[0]
    assert.equal(registeredHighlight.size, termCount)
    assert.equal(
      Array.from(registeredHighlight).every(range => range.startContainer === textNode),
      true
    )
    assert.ok(hitTesting.highlightConstructorArgumentCounts.includes(0))
    assert.equal(
      hitTesting.highlightConstructorArgumentCounts.every(count => count <= 16),
      true
    )
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window, { maxHighlightConstructorArgs: 16 })
    }
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
  let hitTesting
  const body = [
    '<div class="notip"><em>Bruch</em></div>',
    '<code><em>Bruch</em></code>',
    '<span class="katex"><em>Bruch</em></span>',
    '<div class="lia-mathpath-tooltip"><em>Bruch</em></div>',
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Bruch</text></svg>'
  ].join('')

  await withMathPath(body, ({ window, document, api }) => {
    const elements = Array.from(document.body.querySelectorAll('em, text'))
    elements.forEach(markElmOwned)
    const textNodes = elements.map(element => element.firstChild)

    api.setGlossary([entry('Bruch')])

    assert.equal(highlights(document).length, 0)
    assert.equal(document.querySelector('[data-lia-term]'), null)
    assert.deepEqual(elements.map(element => element.firstChild), textNodes)
    textNodes.forEach((textNode, index) => {
      hitTesting.setCaret(textNode, 2)
      dispatchPointer(window, elements[index], 'pointermove')
      assert.equal(
        document.querySelector('.lia-mathpath-tooltip[data-open=1]'),
        null,
        'excluded Elm-owned text must not create a virtual range tooltip'
      )
    })
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
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
  assert.equal(documentCounts.get('pointermove'), 1)
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
