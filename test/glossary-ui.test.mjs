import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, test } from 'node:test'

import { JSDOM, VirtualConsole } from 'jsdom'

let bundleSource = ''

before(async () => {
  bundleSource = await readFile(process.env.MATHPATH_TEST_BUNDLE || new URL('../dist/index.js', import.meta.url), 'utf8')
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
    caretPositionCalls: 0,
    caretRangeCalls: 0,
    rangeRectCalls: 0,
    highlightRegistrations: 0,
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
    },
    resetCalls() {
      this.caretPositionCalls = 0
      this.caretRangeCalls = 0
      this.rangeRectCalls = 0
      this.highlightRegistrations = 0
    }
  }

  function caretPosition() {
    state.caretPositionCalls++
    if (!state.node || !state.node.isConnected) return null
    return { offsetNode: state.node, offset: state.offset }
  }

  function caretRange() {
    state.caretRangeCalls++
    if (!state.node || !state.node.isConnected) return null
    const range = window.document.createRange()
    range.setStart(state.node, state.offset)
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
      state.rangeRectCalls++
      if (this.collapsed || !this.startContainer?.isConnected) return []
      if (this.startContainer.parentElement?.closest('[hidden], [data-test-hidden="1"]')) return []
      const rects = [state.rect]
      rects.item = index => rects[index] || null
      return rects
    }
  })
  Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      state.rangeRectCalls++
      return this.collapsed || !this.startContainer?.isConnected
        ? { ...state.rect, width: 0, height: 0, right: state.rect.left, bottom: state.rect.top }
        : state.rect
    }
  })

  if (cssHighlights) {
    const css = window.CSS || {}
    const highlightRegistry = new class extends Map {
      set(name, value) {
        if (name === 'lia-mathpath-glossary') state.highlightRegistrations++
        return super.set(name, value)
      }
    }()
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

async function flushDomWork(window) {
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
  // The observer batches content work in one frame; painting can use the next frame.
  for (let frame = 0; frame < 2; frame++) {
    await new Promise(resolve => window.requestAnimationFrame(resolve))
  }
  await Promise.resolve()
}

function trackTextWalks(document) {
  const roots = []
  const visited = []
  const nativeCreateTreeWalker = document.createTreeWalker
  document.createTreeWalker = function (root, whatToShow, filter) {
    const walker = nativeCreateTreeWalker.call(this, root, whatToShow, filter)
    if (whatToShow & document.defaultView.NodeFilter.SHOW_TEXT) {
      roots.push(root)
      const nativeNextNode = walker.nextNode
      walker.nextNode = function () {
        const node = nativeNextNode.call(this)
        if (node?.nodeType === document.defaultView.Node.TEXT_NODE) visited.push(node)
        return node
      }
    }
    return walker
  }
  return {
    roots,
    visited,
    reset() {
      roots.length = 0
      visited.length = 0
    },
    assertLocal() {
      assert.equal(roots.includes(document.body), false, 'local mutations must not walk document.body')
      assert.equal(roots.includes(document.documentElement), false, 'local mutations must not walk the document root')
      assert.equal(roots.includes(document), false, 'local mutations must not walk the whole document')
    }
  }
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
  const observers = []
  if (options.realObserver) {
    const NativeMutationObserver = window.MutationObserver
    window.MutationObserver = class extends NativeMutationObserver {
      constructor(callback) {
        super(callback)
        observers.push(this)
      }
    }
  }
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
  } finally {
    await flushDomWork(window)
    // Closing jsdom removes body; observers must not schedule new frames during teardown.
    observers.forEach(observer => observer.disconnect())
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

test('follows LiaScript light and dark theme tokens instead of arbitrary button text colors', async () => {
  const themeFixture = [
    '<style>',
    '  html {',
    '    --color-highlight: 20, 115, 117;',
    '    --color-background: 250, 250, 250;',
    '    --color-text: 24, 28, 34;',
    '  }',
    '  html.lia-variant-dark {',
    '    --color-highlight: 150, 230, 235;',
    '    --color-background: 35, 39, 45;',
    '    --color-text: 245, 247, 250;',
    '  }',
    '</style>',
    '<button style="color: rgb(255, 255, 255)">fremder Kursbutton</button>',
    '<main class="lia-slide__content">Theme-Probe</main>'
  ].join('')

  await withMathPath(themeFixture, async ({ window, document }) => {
    const root = document.documentElement
    const value = property => root.style.getPropertyValue(property).trim()

    assert.equal(value('--lia-mathpath-accent-rgb'), '20, 115, 117')
    assert.equal(value('--lia-mathpath-accent-contrast-rgb'), '255, 255, 255')
    assert.equal(value('--lia-mathpath-light-accent-rgb'), '67, 143, 145')
    assert.equal(value('--lia-mathpath-light-accent-contrast-rgb'), '0, 0, 0')
    assert.equal(value('--lia-mathpath-surface-rgb'), '250, 250, 250')
    assert.equal(value('--lia-mathpath-text-rgb'), '24, 28, 34')

    root.classList.add('lia-variant-dark')
    await flushDomWork(window)

    assert.equal(value('--lia-mathpath-accent-rgb'), '150, 230, 235')
    assert.equal(value('--lia-mathpath-accent-contrast-rgb'), '0, 0, 0')
    assert.equal(value('--lia-mathpath-light-accent-rgb'), '171, 235, 239')
    assert.equal(value('--lia-mathpath-light-accent-contrast-rgb'), '0, 0, 0')
    assert.equal(value('--lia-mathpath-surface-rgb'), '35, 39, 45')
    assert.equal(value('--lia-mathpath-text-rgb'), '245, 247, 250')

    const css = document.getElementById('lia-mathpath-style-v1')?.textContent || ''
    assert.match(css, /lia-mathpath-glossary-highlight[^}]*--lia-mathpath-accent-rgb/)
    assert.doesNotMatch(css, /lia-mathpath-glossary-highlight[^}]*--lia-mathpath-light-accent-rgb/)
    assert.match(css, /lia-mathpath-explain-dialog[\s\S]*background: rgb\(var\(--lia-mathpath-surface-rgb/)
    assert.match(css, /lia-mathpath-explain-close[\s\S]*--lia-mathpath-accent-contrast-rgb/)
    assert.match(css, /lia-mathpath-tooltip[\s\S]*background: rgba\(var\(--lia-mathpath-surface-rgb/)
    assert.doesNotMatch(css, /background:\s*#fff/)
  }, { realObserver: true })
})

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
    await flushDomWork(window)

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
    await flushDomWork(window)

    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'pointermove')
    assert.equal(tooltip?.dataset.open, '0', 'a removed term must not retain a stale range hit')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)

    textNode.data = 'Ein Bruch entsteht.'
    await flushDomWork(window)
    hitTesting.setCaret(textNode, 6)
    dispatchPointer(window, paragraph, 'click')
    assert.equal(tooltip?.dataset.open, '1')
    paragraph.remove()
    await flushDomWork(window)

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
    await flushDomWork(window)

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

    await flushDomWork(window)
    const walks = trackTextWalks(document)
    paragraph.classList.add('lia-mathpath-no-glossary')
    await flushDomWork(window)

    assert.equal(registry.size, 0, 'opting out removes normal-term ranges from the CSS registry')
    assert.equal(tooltip?.dataset.open, '0')
    dispatchPointer(window, paragraph, 'pointermove')
    assert.equal(tooltip?.dataset.open, '0', 'an opted-out paragraph no longer produces range hits')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)

    paragraph.classList.remove('lia-mathpath-no-glossary')
    await flushDomWork(window)

    assert.equal(registry.size, 1, 'removing the opt-out class registers the normal term again')
    const restoredHighlight = Array.from(registry.values())[0]
    assert.equal(restoredHighlight.size, 1)
    dispatchPointer(window, paragraph, 'pointermove')
    assert.equal(tooltip?.dataset.open, '1')
    assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
    assert.strictEqual(paragraph.firstChild, textNode)
    assertSameChildren(paragraph, childNodes)
    walks.assertLocal()
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

test('setTooltips off disables automatic terms while explicit terms remain interactive', async () => {
  let hitTesting
  await withMathPath(
    [
      '<p id="range">Ein Bruch bleibt als Elm-Text erhalten.</p>',
      '<p><em id="semantic">Bruch</em></p>',
      '<p id="wrapped">Ein Bruch wird automatisch markiert.</p>',
      '<span id="manual" data-lia-term="Bruch">manueller Begriff</span>'
    ].join(''),
    ({ window, document, api }) => {
      const rangeParagraph = markElmOwned(document.querySelector('#range'))
      const rangeText = rangeParagraph.firstChild
      const semantic = document.querySelector('#semantic')
      const manual = document.querySelector('#manual')

      api.setGlossary([entry('Bruch', [], 'Ein Teil eines Ganzen.')])

      const wrapper = document.querySelector('#wrapped [data-lia-mathpath-auto-term="wrapper"]')
      assert.ok(wrapper)
      assert.equal(semantic.dataset.liaMathpathAutoTerm, 'semantic')
      assert.equal(manual.hasAttribute('data-lia-mathpath-auto-term'), false)
      assert.equal(hitTesting.highlightRegistry?.size, 1)

      semantic.dispatchEvent(new window.MouseEvent('mouseenter'))
      const tooltip = document.querySelector('.lia-mathpath-tooltip')
      assert.equal(tooltip?.dataset.open, '1')

      assert.equal(api.setTooltips(' OFF '), false)
      assert.equal(api.tooltipsEnabled(), false)
      assert.equal(document.documentElement.dataset.liaMathpathTooltips, 'off')
      assert.equal(tooltip?.dataset.open, '0')
      assert.equal(tooltip?.textContent, '')
      assert.equal(hitTesting.highlightRegistry?.size, 0)
      assert.equal(document.querySelector('.lia-mathpath-range-layer'), null)

      semantic.dispatchEvent(new window.MouseEvent('mouseenter'))
      const pointerdown = dispatchPointer(window, semantic, 'pointerdown')
      semantic.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      assert.equal(pointerdown.defaultPrevented, false)
      assert.equal(tooltip?.dataset.open, '0')

      wrapper.dispatchEvent(new window.MouseEvent('mouseenter'))
      wrapper.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      assert.equal(tooltip?.dataset.open, '0')

      hitTesting.setCaret(rangeText, 6)
      dispatchPointer(window, rangeParagraph, 'pointermove')
      dispatchPointer(window, rangeParagraph, 'click')
      assert.equal(tooltip?.dataset.open, '0')

      manual.dispatchEvent(new window.MouseEvent('mouseenter'))
      assert.equal(tooltip?.dataset.open, '1')
      assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')
      manual.dispatchEvent(new window.MouseEvent('mouseleave'))
      assert.equal(tooltip?.dataset.open, '0')
      assert.strictEqual(rangeParagraph.firstChild, rangeText)
    },
    {
      beforeEval(window) {
        hitTesting = installRangeHitTesting(window)
      }
    }
  )
})

test('setTooltips on catches up content added while automatic tooltips were off', async () => {
  let hitTesting
  await withMathPath('<p id="existing">Ein Bruch ist schon vorhanden.</p>', async ({ window, document, api }) => {
    api.setGlossary([entry('Bruch')])
    const existingWrapper = document.querySelector('#existing [data-lia-mathpath-auto-term="wrapper"]')
    assert.ok(existingWrapper)

    assert.equal(api.setTooltips('off'), false)

    const unmanaged = document.createElement('p')
    unmanaged.id = 'added-unmanaged'
    unmanaged.textContent = 'Ein Bruch kam spaeter hinzu.'
    const elmParagraph = markElmOwned(document.createElement('p'))
    elmParagraph.id = 'added-elm'
    elmParagraph.textContent = 'Auch dieser Bruch kam spaeter hinzu.'
    const elmText = elmParagraph.firstChild
    document.body.append(unmanaged, elmParagraph)
    await flushDomWork(window)
    api.setGlossary([entry('Bruch')])
    await flushDomWork(window)

    assert.equal(unmanaged.querySelector('[data-lia-mathpath-auto-term]'), null)
    assert.strictEqual(elmParagraph.firstChild, elmText)
    assert.equal(hitTesting.highlightRegistry?.size, 0)

    hitTesting.setCaret(elmText, 12)
    dispatchPointer(window, elmParagraph, 'pointermove')
    assert.notEqual(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '1')

    assert.equal(api.setTooltips('@0'), true, 'an unbound macro parameter fails open')
    assert.equal(api.tooltipsEnabled(), true)
    assert.equal(document.documentElement.hasAttribute('data-lia-mathpath-tooltips'), false)
    assert.strictEqual(document.querySelector('#existing [data-lia-mathpath-auto-term="wrapper"]'), existingWrapper)
    assert.equal(unmanaged.querySelectorAll('[data-lia-mathpath-auto-term="wrapper"]').length, 1)
    assert.strictEqual(elmParagraph.firstChild, elmText)
    assert.equal(hitTesting.highlightRegistry?.size, 1)

    const wrapperCount = document.querySelectorAll('[data-lia-mathpath-auto-term="wrapper"]').length
    assert.equal(api.setTooltips('off'), false)
    assert.equal(api.setTooltips('on'), true)
    assert.equal(api.setTooltips('on'), true)
    assert.equal(document.querySelectorAll('[data-lia-mathpath-auto-term="wrapper"]').length, wrapperCount)
    assert.equal(document.querySelectorAll(
      '.lia-mathpath-glossary-highlight .lia-mathpath-glossary-highlight'
    ).length, 0)

    hitTesting.clearCaret()
    const addedWrapper = unmanaged.querySelector('[data-lia-mathpath-auto-term="wrapper"]')
    addedWrapper.dispatchEvent(new window.MouseEvent('mouseenter'))
    assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '1')
  }, {
    realObserver: true,
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
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

test('matches noun aliases without matching verbs, derivations or compounds', async () => {
  await withMathPath(
    [
      '<p>Eine Zahl, viele Zahlen; wir zahlen.</p>',
      '<p>Eine Einheit, mehrere Einheiten, einheitlich, Einheitensystem und Flächeneinheit.</p>',
      '<p><em>Zahlen</em> <em>zahlen</em></p>'
    ].join(''),
    ({ document, api }) => {
      api.setGlossary([
        entry('Zahl', ['Zahlen']),
        entry('Einheit', ['Einheiten'])
      ])

      const paragraphs = document.querySelectorAll('p')
      assert.deepEqual(highlights(document, paragraphs[0]).map(element => [
        element.textContent,
        element.dataset.liaTerm
      ]), [
        ['Zahl', 'Zahl'],
        ['Zahlen', 'Zahl']
      ])
      assert.deepEqual(highlights(document, paragraphs[1]).map(element => [
        element.textContent,
        element.dataset.liaTerm
      ]), [
        ['Einheit', 'Einheit'],
        ['Einheiten', 'Einheit']
      ])

      const semanticTerms = paragraphs[2].querySelectorAll('em')
      assert.equal(semanticTerms[0].classList.contains('lia-mathpath-glossary-highlight'), true)
      assert.equal(semanticTerms[0].dataset.liaTerm, 'Zahl')
      assert.equal(semanticTerms[1].classList.contains('lia-mathpath-glossary-highlight'), false)
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

test('excludes native TOC ranges, emphasis and explicit terms while course text stays interactive', async () => {
  let hitTesting
  await withMathPath([
    '<nav class="lia-toc">',
    '  <p>Ein Bruch im Inhaltsverzeichnis.</p>',
    '  <em>Bruch</em>',
    '  <span data-lia-term="Bruch">Bruch</span>',
    '</nav>',
    '<main><p>Ein Bruch im Kurs.</p></main>'
  ].join(''), ({ window, document, api }) => {
    const toc = markElmOwned(document.querySelector('.lia-toc'))
    const course = markElmOwned(document.querySelector('main p'))
    const courseText = course.firstChild
    const tocTargets = Array.from(toc.querySelectorAll('p, em, span'))
    const tocTextNodes = tocTargets.map(element => element.firstChild)

    api.setGlossary([entry('Bruch')])

    assert.equal(highlights(document, toc).length, 0)
    assert.equal(toc.querySelector('[data-lia-mathpath-bound], [data-lia-mathpath-auto-term]'), null)
    assert.deepEqual(tocTargets.map(element => element.firstChild), tocTextNodes)
    const ranges = Array.from(hitTesting.highlightRegistry.values()).flatMap(value => Array.from(value))
    assert.equal(ranges.length, 1)
    assert.strictEqual(ranges[0].startContainer, courseText)

    tocTargets.forEach((target, index) => {
      hitTesting.setCaret(tocTextNodes[index], target.tagName === 'P' ? 6 : 2)
      target.dispatchEvent(new window.MouseEvent('mouseenter'))
      dispatchPointer(window, target, 'pointermove')
      assert.equal(dispatchPointer(window, target, 'pointerdown').defaultPrevented, false)
      assert.equal(dispatchPointer(window, target, 'click').defaultPrevented, false)
      assert.equal(document.querySelector('.lia-mathpath-tooltip[data-open="1"]'), null)
    })

    hitTesting.setCaret(courseText, 6)
    dispatchPointer(window, course, 'pointermove')
    assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '1')
    assert.strictEqual(course.firstChild, courseText)
  }, {
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('keeps repeatedly rebuilt standalone lia-navigation TOCs inactive across glossary and tooltip updates', async () => {
  let hitTesting
  await withMathPath('<main><em>Bruch</em></main>', async ({ window, document, api, errors }) => {
    api.setGlossary([entry('Bruch')])

    for (let cycle = 0; cycle < 3; cycle++) {
      const toc = document.createElement('div')
      toc.id = 'lia-bm-toc5'
      toc.innerHTML = '<p>Ein Bruch im TOC.</p><p class="elm">Ein Bruch als Elm-Text.</p>' +
        '<em>Bruch</em><span data-lia-term="Bruch">Bruch</span>'
      const elmParagraph = markElmOwned(toc.querySelector('.elm'))
      const elmText = elmParagraph.firstChild
      document.body.append(toc)
      await flushDomWork(window)

      assert.equal(highlights(document, toc).length, 0, 'an inserted TOC must remain unmarked')
      api.setGlossary([entry('Bruch', [], `Erklaerung ${cycle}`)])
      api.setTooltips('off')
      api.setTooltips('on')
      await flushDomWork(window)

      assert.equal(highlights(document, toc).length, 0)
      assert.equal(toc.querySelector('[data-lia-mathpath-bound], [data-lia-mathpath-auto-term]'), null)
      assert.equal(hitTesting.highlightRegistry.size, 0)
      assert.strictEqual(elmParagraph.firstChild, elmText)
      hitTesting.setCaret(elmText, 6)
      dispatchPointer(window, elmParagraph, 'pointermove')
      for (const target of toc.querySelectorAll('p, em, span')) {
        target.dispatchEvent(new window.MouseEvent('mouseenter'))
        assert.equal(dispatchPointer(window, target, 'pointerdown').defaultPrevented, false)
        assert.equal(dispatchPointer(window, target, 'click').defaultPrevented, false)
      }
      assert.equal(document.querySelector('.lia-mathpath-tooltip[data-open="1"]'), null)

      const courseTerm = document.querySelector('main em')
      courseTerm.dispatchEvent(new window.MouseEvent('mouseenter'))
      assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '1')
      courseTerm.dispatchEvent(new window.MouseEvent('mouseleave'))
      assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '0')
      toc.remove()
      await flushDomWork(window)
    }
    assert.deepEqual(errors, [])
  }, {
    realObserver: true,
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('deactivates hovered and pinned terms and their styled clones when moved into either TOC', async () => {
  for (const activation of ['mouseenter', 'click']) {
    for (const tocAttribute of ['class="lia-toc"', 'id="lia-bm-toc5"']) {
      await withMathPath([
        '<style>nav a { cursor: pointer; font-weight: 700; border-bottom: 2px solid;',
        '  box-shadow: 0 1px 0 blue; background-color: rgb(230, 240, 250); }</style>',
        '<main><a href="#next" data-lia-term="Bruch">Bruch</a></main>',
        `<nav ${tocAttribute}><a href="#next">Kapitel</a></nav>`
      ].join(''), async ({ window, document, api, errors }) => {
        const term = document.querySelector('main a')
        const toc = document.querySelector('nav')
        const baseline = toc.querySelector('a')
        api.setGlossary([entry('Bruch')])
        dispatchPointer(window, term, activation)
        const tooltip = document.querySelector('.lia-mathpath-tooltip')
        assert.equal(tooltip?.dataset.open, '1')

        const clone = term.cloneNode(true)
        toc.append(term, clone)
        assert.equal(dispatchPointer(window, term, 'pointerdown').defaultPrevented, false,
          'existing listeners must respect the new TOC parent before the observer runs')
        assert.equal(dispatchPointer(window, clone, 'pointerdown').defaultPrevented, false)
        await flushDomWork(window)
        assert.equal(tooltip?.dataset.open, '0', 'moving an active term into the TOC closes its tooltip')

        for (const target of [term, clone]) {
          target.dispatchEvent(new window.MouseEvent('mouseenter'))
          assert.equal(dispatchPointer(window, target, 'pointerdown').defaultPrevented, false)
          assert.equal(dispatchPointer(window, target, 'click').defaultPrevented, false)
          assert.equal(tooltip?.dataset.open, '0', 'TOC clicks must not pin a moved or cloned term')
          const actualStyle = window.getComputedStyle(target)
          const baselineStyle = window.getComputedStyle(baseline)
          for (const property of ['cursor', 'borderBottomStyle', 'boxShadow', 'backgroundColor', 'fontWeight']) {
            assert.equal(actualStyle[property], baselineStyle[property], `${property} must preserve TOC navigation styles`)
          }
        }
        assert.deepEqual(errors, [])
      }, { realObserver: true })
    }
  }
})

test('removes a pinned Elm range when lia-navigation moves its text into the TOC', async () => {
  let hitTesting
  await withMathPath('<main><p>Ein Bruch im Kurs.</p></main><div id="lia-bm-toc5"></div>',
    async ({ window, document, api }) => {
      const paragraph = markElmOwned(document.querySelector('p'))
      const textNode = paragraph.firstChild
      api.setGlossary([entry('Bruch')])
      hitTesting.setCaret(textNode, 6)
      dispatchPointer(window, paragraph, 'click')
      const tooltip = document.querySelector('.lia-mathpath-tooltip')
      assert.equal(tooltip?.dataset.open, '1')
      assert.equal(hitTesting.highlightRegistry.get('lia-mathpath-glossary')?.size, 1)

      document.querySelector('#lia-bm-toc5').append(paragraph)
      await flushDomWork(window)

      assert.equal(tooltip?.dataset.open, '0')
      assert.equal(hitTesting.highlightRegistry.size, 0)
      dispatchPointer(window, paragraph, 'pointermove')
      assert.equal(dispatchPointer(window, paragraph, 'pointerdown').defaultPrevented, false)
      assert.equal(dispatchPointer(window, paragraph, 'click').defaultPrevented, false)
      assert.equal(tooltip?.dataset.open, '0')
      assert.strictEqual(paragraph.firstChild, textNode)
      assert.equal(paragraph.childNodes.length, 1)
    }, {
      realObserver: true,
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

  assert.equal(documentCounts.get('click'), 2)
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
    await flushDomWork(window)

    assert.strictEqual(paragraph.querySelector('em'), emphasis)
    assert.strictEqual(emphasis.firstChild, textNode)
    assert.equal(emphasis.dataset.liaTerm, 'Bruch')

    emphasis.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '1')
    paragraph.remove()
    assert.doesNotThrow(() => window.dispatchEvent(new window.Event('scroll')))
    assert.equal(document.querySelector('.lia-mathpath-tooltip')?.dataset.open, '0')

    await flushDomWork(window)
    assert.deepEqual(errors, [])
  }, { realObserver: true })
})

for (const legacyCaret of [false, true]) {
  test(`drawing and input surfaces skip all glossary hit tests (${legacyCaret ? 'legacy' : 'modern'} caret)`, async () => {
    let hitTesting
    await withMathPath([
      '<main><p>Ein Bruch im Kurs.</p><span data-lia-term="Bruch">Bruch</span></main>',
      '<canvas></canvas><input><textarea></textarea><button><span>Stift</span></button>',
      '<select><option>Bruch</option></select><div contenteditable="true"><span>Eingabe</span></div>'
    ].join(''), ({ window, document, api }) => {
      const paragraph = markElmOwned(document.querySelector('p'))
      api.setGlossary([entry('Bruch')])
      hitTesting.clearCaret()
      hitTesting.resetCalls()

      const surfaces = document.querySelectorAll('canvas, input, textarea, button span, select, [contenteditable] span')
      for (const surface of surfaces) {
        for (let move = 0; move < 24; move++) dispatchPointer(window, surface, 'pointermove')
        assert.equal(dispatchPointer(window, surface, 'pointerdown').defaultPrevented, false)
        assert.equal(dispatchPointer(window, surface, 'click').defaultPrevented, false)
      }
      assert.equal(hitTesting.caretPositionCalls, 0, 'excluded surfaces must not query caretPositionFromPoint')
      assert.equal(hitTesting.caretRangeCalls, 0, 'excluded surfaces must not query legacy caretRangeFromPoint')
      assert.equal(hitTesting.rangeRectCalls, 0, 'excluded surfaces must not test glossary range rectangles')

      hitTesting.setCaret(paragraph.firstChild, 6)
      dispatchPointer(window, paragraph, 'pointermove')
      const tooltip = document.querySelector('.lia-mathpath-tooltip')
      assert.equal(tooltip?.dataset.open, '1', 'course glossary hover still works')
      hitTesting.resetCalls()
      const canvas = document.querySelector('canvas')
      dispatchPointer(window, canvas, 'pointermove')
      assert.equal(tooltip.dataset.open, '0', 'moving from a virtual term onto canvas closes the hover')
      assert.equal(hitTesting.caretPositionCalls + hitTesting.caretRangeCalls, 0)
      assert.equal(hitTesting.rangeRectCalls, 0)

      const explicitTerm = document.querySelector('main span')
      explicitTerm.dispatchEvent(new window.MouseEvent('mouseenter'))
      assert.equal(tooltip.dataset.open, '1')
      dispatchPointer(window, canvas, 'pointermove')
      assert.equal(tooltip.dataset.open, '0', 'canvas also closes a DOM-term hover without mouseleave')

      for (const term of [paragraph, explicitTerm]) {
        dispatchPointer(window, term, 'click')
        assert.equal(tooltip.dataset.open, '1')
        hitTesting.resetCalls()
        dispatchPointer(window, canvas, 'pointermove')
        assert.equal(tooltip.dataset.open, '1', 'canvas movement preserves a pinned tooltip')
        assert.equal(dispatchPointer(window, canvas, 'click').defaultPrevented, false)
        assert.equal(tooltip.dataset.open, '0', 'an outside canvas click dismisses the pin')
        assert.equal(hitTesting.caretPositionCalls + hitTesting.caretRangeCalls, 0)
        assert.equal(hitTesting.rangeRectCalls, 0)
      }
    }, {
      beforeEval(window) {
        hitTesting = installRangeHitTesting(window, { legacyCaret })
      }
    })
  })
}

test('repeated drawing toolbar and bm-row state changes do not scan course text or rebuild highlights', async () => {
  let hitTesting
  await withMathPath([
    '<main><p>Ein Bruch im Kurs.</p>',
    '<div class="bm-row"><canvas></canvas><div role="toolbar"><button>Stift</button></div></div></main>'
  ].join(''), async ({ window, document, api, errors }) => {
    const paragraph = markElmOwned(document.querySelector('p'))
    api.setGlossary([entry('Bruch'), entry('Summe')])
    await flushDomWork(window)
    const range = Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))[0]
    const walks = trackTextWalks(document)
    hitTesting.resetCalls()

    const row = document.querySelector('.bm-row')
    const toolbar = document.querySelector('[role="toolbar"]')
    const button = document.querySelector('button')
    for (let batch = 0; batch < 3; batch++) {
      for (let mutation = 0; mutation < 20; mutation++) {
        row.className = `bm-row ${mutation % 2 ? 'bm-active' : 'bm-idle'}`
        toolbar.className = `canvas-toolbar ${mutation % 2 ? 'writing' : 'ready'}`
        button.className = mutation % 2 ? 'selected' : 'idle'
        button.id = `pen-${batch}-${mutation}`
        button.dataset.liaTerm = mutation % 2 ? 'Bruch' : 'Summe'
      }
      await flushDomWork(window)
    }

    walks.assertLocal()
    assert.equal(walks.roots.length, 0, 'pure toolbar state changes need no glossary text walk')
    assert.equal(hitTesting.highlightRegistrations, 0, 'layout state alone must preserve the existing Highlight')
    assert.strictEqual(Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))[0], range)
    assert.strictEqual(paragraph.firstChild, range.startContainer)
    assert.equal(button.classList.contains('lia-mathpath-glossary-highlight'), false)
    assert.deepEqual(errors, [])
  }, {
    realObserver: true,
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('coalesces successive text mutations into a local update while preserving untouched ranges', async () => {
  let hitTesting
  await withMathPath('<main><p id="changed">Ein Bruch entsteht.</p><p id="stable">Ein Bruch bleibt.</p></main>',
    async ({ window, document, api }) => {
      const changed = markElmOwned(document.querySelector('#changed'))
      const stable = markElmOwned(document.querySelector('#stable'))
      const text = changed.firstChild
      api.setGlossary([entry('Bruch'), entry('Summe')])
      await flushDomWork(window)
      const stableRange = Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))
        .find(range => range.startContainer === stable.firstChild)
      const walks = trackTextWalks(document)
      hitTesting.resetCalls()

      text.data = 'Eine Summe kommt.'
      await Promise.resolve()
      text.data = 'Eine Summe entsteht.'
      await Promise.resolve()
      assert.equal(hitTesting.highlightRegistrations, 0, 'separate mutation deliveries wait for the shared frame')
      await flushDomWork(window)

      walks.assertLocal()
      assert.equal(walks.visited.includes(stable.firstChild), false, 'unchanged paragraphs must not be searched')
      assert.equal(hitTesting.highlightRegistrations, 1, 'the batch publishes updated ranges once')
      const ranges = Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))
      assert.equal(ranges.length, 2)
      assert.strictEqual(ranges.find(range => range.startContainer === stable.firstChild), stableRange)
      assert.strictEqual(changed.firstChild, text)
      hitTesting.setCaret(text, 7)
      dispatchPointer(window, changed, 'pointermove')
      assert.equal(document.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Summe')
    }, {
      realObserver: true,
      beforeEval(window) {
        hitTesting = installRangeHitTesting(window)
      }
    })
})

test('indexes inserted course subtrees locally and updates semantic and generated term text', async () => {
  let hitTesting
  await withMathPath('<main><p id="stable">Ein Bruch bleibt.</p></main>', async ({ window, document, api }) => {
    const stable = markElmOwned(document.querySelector('#stable'))
    api.setGlossary([entry('Bruch'), entry('Summe')])
    await flushDomWork(window)
    const stableRange = Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))[0]
    const walks = trackTextWalks(document)

    const subtree = document.createElement('section')
    subtree.innerHTML = '<p class="elm">Eine Summe entsteht.</p><em>Bruch</em><p class="plain">Ein Bruch entsteht.</p>'
    const elm = markElmOwned(subtree.querySelector('.elm'))
    const semantic = markElmOwned(subtree.querySelector('em'))
    const elmText = elm.firstChild
    document.querySelector('main').append(subtree)
    await flushDomWork(window)

    walks.assertLocal()
    assert.equal(walks.visited.includes(stable.firstChild), false)
    assert.strictEqual(elm.firstChild, elmText)
    assert.equal(semantic.dataset.liaTerm, 'Bruch')
    const wrapper = subtree.querySelector('.plain [data-lia-mathpath-auto-term="wrapper"]')
    assert.ok(wrapper, 'new unmanaged course text receives a glossary wrapper')
    const registryRanges = Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))
    assert.ok(registryRanges.includes(stableRange), 'inserting content preserves unrelated virtual ranges')
    hitTesting.setCaret(elmText, 7)
    dispatchPointer(window, elm, 'pointermove')
    assert.equal(document.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Summe')

    walks.reset()
    semantic.firstChild.data = 'Summe'
    wrapper.firstChild.data = 'Summe'
    await flushDomWork(window)
    walks.assertLocal()
    assert.equal(walks.visited.includes(stable.firstChild), false)
    for (const term of [semantic, wrapper]) {
      assert.equal(term.dataset.liaTerm, 'Summe', 'changed automatic text must use the new canonical term')
      term.dispatchEvent(new window.MouseEvent('mouseenter'))
      assert.equal(document.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Summe')
    }

    semantic.firstChild.data = 'Kein Fachwort'
    wrapper.firstChild.data = 'Kein Fachwort'
    await flushDomWork(window)
    assert.equal(semantic.hasAttribute('data-lia-term'), false)
    assert.equal(subtree.querySelector('.plain [data-lia-term]'), null)
    walks.assertLocal()
  }, {
    realObserver: true,
    beforeEval(window) {
      hitTesting = installRangeHitTesting(window)
    }
  })
})

test('updates explicit data-lia-term attributes locally and keeps hover and pin interactions active', async () => {
  await withMathPath('<main><span id="term">Anteil</span><p>Ein Bruch bleibt.</p></main>',
    async ({ window, document, api }) => {
      api.setGlossary([entry('Bruch'), entry('Summe')])
      await flushDomWork(window)
      const term = document.querySelector('#term')
      const walks = trackTextWalks(document)
      term.dataset.liaTerm = 'Bruch'
      await flushDomWork(window)
      walks.assertLocal()
      term.dispatchEvent(new window.MouseEvent('mouseenter'))
      const tooltip = document.querySelector('.lia-mathpath-tooltip')
      assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Bruch')

      term.dataset.liaTerm = 'Summe'
      await flushDomWork(window)
      term.dispatchEvent(new window.MouseEvent('mouseenter'))
      assert.equal(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Summe')
      dispatchPointer(window, term, 'click')
      term.dispatchEvent(new window.MouseEvent('mouseleave'))
      assert.equal(tooltip?.dataset.open, '1')
      dispatchPointer(window, document.body, 'click', { x: 300, y: 200 })
      assert.equal(tooltip?.dataset.open, '0')
      walks.assertLocal()
    }, { realObserver: true })
})

test('changing a container id into and out of the navigation exclusion updates only that subtree', async () => {
  let hitTesting
  await withMathPath('<main><section><p>Ein Bruch entsteht.</p></section><p id="stable">Ein Bruch bleibt.</p></main>',
    async ({ window, document, api }) => {
      const section = markElmOwned(document.querySelector('section'))
      const paragraph = section.querySelector('p')
      const stable = markElmOwned(document.querySelector('#stable'))
      api.setGlossary([entry('Bruch')])
      await flushDomWork(window)
      const stableRange = Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))
        .find(range => range.startContainer === stable.firstChild)
      const walks = trackTextWalks(document)
      hitTesting.setCaret(paragraph.firstChild, 6)
      dispatchPointer(window, paragraph, 'click')
      const tooltip = document.querySelector('.lia-mathpath-tooltip')
      assert.equal(tooltip?.dataset.open, '1')

      section.id = 'lia-bm-toc5'
      await flushDomWork(window)
      assert.equal(tooltip?.dataset.open, '0', 'entering the excluded context dismisses a pinned term')
      assert.deepEqual(Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary')), [stableRange])
      section.id = 'course-details'
      await flushDomWork(window)
      const ranges = Array.from(hitTesting.highlightRegistry.get('lia-mathpath-glossary'))
      assert.equal(ranges.length, 2)
      assert.ok(ranges.includes(stableRange))
      dispatchPointer(window, paragraph, 'pointermove')
      assert.equal(tooltip?.dataset.open, '1', 'leaving the excluded context restores the term')
      walks.assertLocal()
      assert.equal(walks.visited.includes(stable.firstChild), false)
    }, {
      realObserver: true,
      beforeEval(window) {
        hitTesting = installRangeHitTesting(window)
      }
    })
})

for (const visibilityAttribute of ['class', 'style', 'hidden']) {
  test(`slide ${visibilityAttribute} changes and resize repaint fallback ranges without rescanning text`, async () => {
    let hitTesting
    await withMathPath('<section class="lia-slide__content"><p>Ein Bruch entsteht.</p></section>',
      async ({ window, document, api, errors }) => {
        const section = markElmOwned(document.querySelector('section'))
        const paragraph = section.querySelector('p')
        api.setGlossary([entry('Bruch')])
        await flushDomWork(window)
        const walks = trackTextWalks(document)
        hitTesting.setCaret(paragraph.firstChild, 6)
        dispatchPointer(window, paragraph, 'click')
        const tooltip = document.querySelector('.lia-mathpath-tooltip')
        assert.equal(tooltip?.dataset.open, '1')
        assert.ok(document.querySelector('.lia-mathpath-range-rect'))

        // jsdom has no layout engine; the Range stub models the hidden slide geometry.
        section.dataset.testHidden = '1'
        if (visibilityAttribute === 'hidden') section.hidden = true
        if (visibilityAttribute === 'style') section.style.display = 'none'
        if (visibilityAttribute === 'class') section.classList.add('slide-hidden')
        await flushDomWork(window)
        assert.equal(tooltip?.dataset.open, '0', 'a pin on the hidden slide must close')
        assert.equal(document.querySelector('.lia-mathpath-range-rect'), null)

        section.dataset.testHidden = '0'
        if (visibilityAttribute === 'hidden') section.hidden = false
        if (visibilityAttribute === 'style') section.style.display = ''
        if (visibilityAttribute === 'class') section.classList.remove('slide-hidden')
        await flushDomWork(window)
        assert.ok(document.querySelector('.lia-mathpath-range-rect'), 'returning to the slide restores range markers')
        dispatchPointer(window, paragraph, 'click')
        assert.equal(tooltip?.dataset.open, '1')
        Object.assign(hitTesting.rect, { x: 90, y: 60, left: 90, top: 60, right: 230, bottom: 84 })
        window.dispatchEvent(new window.Event('resize'))
        await flushDomWork(window)
        assert.equal(document.querySelector('.lia-mathpath-range-rect')?.style.left, '90px')
        assert.equal(document.querySelector('.lia-mathpath-range-rect')?.style.top, '60px')
        assert.equal(tooltip?.style.left, '90px')
        assert.equal(tooltip?.style.top, '50px')
        walks.assertLocal()
        assert.equal(walks.roots.length, 0, 'visibility and size updates need geometry refresh only')
        assert.deepEqual(errors, [])
      }, {
        realObserver: true,
        beforeEval(window) {
          hitTesting = installRangeHitTesting(window, { cssHighlights: false })
        }
      })
  })
}
test('removing the glossary text from a pinned semantic term closes its tooltip immediately', async () => {
  await withMathPath('<main><em>Bruch</em></main>', async ({ window, document, api }) => {
    const term = markElmOwned(document.querySelector('em'))
    api.setGlossary([entry('Bruch')])
    await flushDomWork(window)
    dispatchPointer(window, term, 'click')
    const tooltip = document.querySelector('.lia-mathpath-tooltip')
    assert.equal(tooltip?.dataset.open, '1')

    term.firstChild.data = 'Kein Fachwort'
    await flushDomWork(window)
    assert.equal(term.hasAttribute('data-lia-term'), false)
    assert.equal(tooltip?.dataset.open, '0', 'the removed term must not leave a pinned explanation behind')
    term.dispatchEvent(new window.MouseEvent('mouseenter'))
    assert.equal(tooltip?.dataset.open, '0')
  }, { realObserver: true })
})

for (const visibilityAttribute of ['hidden', 'style']) {
  test(`a pinned explicit term closes when its slide ancestor becomes ${visibilityAttribute}`, async () => {
    await withMathPath('<section><span data-lia-term="Bruch">Bruch</span></section>',
      async ({ window, document, api }) => {
        const slide = document.querySelector('section')
        const term = slide.querySelector('span')
        api.setGlossary([entry('Bruch')])
        await flushDomWork(window)
        dispatchPointer(window, term, 'click')
        const tooltip = document.querySelector('.lia-mathpath-tooltip')
        assert.equal(tooltip?.dataset.open, '1')

        if (visibilityAttribute === 'hidden') slide.hidden = true
        else slide.style.display = 'none'
        await flushDomWork(window)
        assert.equal(tooltip?.dataset.open, '0')

        if (visibilityAttribute === 'hidden') slide.hidden = false
        else slide.style.display = ''
        await flushDomWork(window)
        term.dispatchEvent(new window.MouseEvent('mouseenter'))
        assert.equal(tooltip?.dataset.open, '1', 'returning to the slide restores explicit-term hover')
      }, { realObserver: true })
  })
}

test('discovers inserted glossary entries and changed table explanations, including pure child removal', async () => {
  await withMathPath('<main><p>Ein Bruch und eine Summe.</p></main>', async ({ window, document, api }) => {
    const table = document.createElement('table')
    table.innerHTML = '<thead><tr><th>Begriff</th><th>Erklaerung</th></tr></thead>' +
      '<tbody><tr><td>Bruch</td><td id="explanation">Grundteil<span id="extra"> mit Zusatz</span></td></tr></tbody>'
    document.body.append(table)
    await flushDomWork(window)
    assert.equal(api.getGlossary('Bruch')?.explanation, 'Grundteil mit Zusatz')

    document.querySelector('#extra').remove()
    await flushDomWork(window)
    assert.equal(api.getGlossary('Bruch')?.explanation, 'Grundteil', 'removing only a child must update the table definition')

    document.querySelector('#explanation').firstChild.data = 'Neuer Grundteil'
    await flushDomWork(window)
    assert.equal(api.getGlossary('Bruch')?.explanation, 'Neuer Grundteil')

    const row = document.createElement('tr')
    row.innerHTML = '<td>Summe</td><td>Ergebnis der Addition</td>'
    table.querySelector('tbody').append(row)
    await flushDomWork(window)
    assert.equal(api.getGlossary('Summe')?.explanation, 'Ergebnis der Addition')
    const term = document.querySelector('main [data-lia-term="Summe"]')
    assert.ok(term, 'a new table entry activates its existing occurrence in the course')
    term.dispatchEvent(new window.MouseEvent('mouseenter'))
    assert.equal(document.querySelector('.lia-mathpath-tooltip-title')?.textContent, 'Summe')
  }, { realObserver: true })
})
for (const visibilityAttribute of ['visibility', 'aria-hidden']) {
  test(`a pinned virtual term closes for slide ${visibilityAttribute} even if its range retains geometry`, async () => {
    let hitTesting
    await withMathPath('<section><p>Ein Bruch entsteht.</p></section>', async ({ window, document, api }) => {
      const slide = markElmOwned(document.querySelector('section'))
      const paragraph = slide.querySelector('p')
      const text = paragraph.firstChild
      api.setGlossary([entry('Bruch')])
      await flushDomWork(window)
      const walks = trackTextWalks(document)
      hitTesting.setCaret(text, 6)
      dispatchPointer(window, paragraph, 'click')
      const tooltip = document.querySelector('.lia-mathpath-tooltip')
      assert.equal(tooltip?.dataset.open, '1')

      if (visibilityAttribute === 'visibility') slide.style.visibility = 'hidden'
      else slide.setAttribute('aria-hidden', 'true')
      await flushDomWork(window)
      assert.equal(tooltip?.dataset.open, '0', 'hidden slides cannot keep their virtual tooltip pinned')
      assert.strictEqual(paragraph.firstChild, text)

      if (visibilityAttribute === 'visibility') slide.style.visibility = ''
      else slide.removeAttribute('aria-hidden')
      await flushDomWork(window)
      dispatchPointer(window, paragraph, 'pointermove')
      assert.equal(tooltip?.dataset.open, '1')
      walks.assertLocal()
      assert.equal(walks.roots.length, 0, 'visibility changes should refresh geometry without rematching text')
    }, {
      realObserver: true,
      beforeEval(window) {
        hitTesting = installRangeHitTesting(window)
      }
    })
  })
}
