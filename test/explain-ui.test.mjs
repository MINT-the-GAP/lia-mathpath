import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, test } from 'node:test'

import { JSDOM, VirtualConsole } from 'jsdom'

const BRUCHRECHNUNG_URL = 'https://example.test/explain/bruchrechnung'
const EINHEITEN_URL = 'https://example.test/explain/einheiten'
const TUTORIAL_URL = 'https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/Aufgabensammlung/refs/heads/main/Repetitorium/Erklaerungen/00_00_00_Tutorial.md'
const EXPLAIN_MARKDOWN = [
  '| Thema | Link |',
  `| Tutorial | ${TUTORIAL_URL} |`,
  `| Bruchrechnung | ${BRUCHRECHNUNG_URL} |`,
  `| Einheiten | ${EINHEITEN_URL} |`
].join('\n')

let bundleSource = ''
let readmeSource = ''
let explainSource = ''

before(async () => {
  ;[bundleSource, readmeSource, explainSource] = await Promise.all([
    readFile(new URL('../dist/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../Explain.md', import.meta.url), 'utf8')
  ])
})

async function flushDomWork() {
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
  await Promise.resolve()
}

async function withMathPath(body, callback, options = {}) {
  const errors = []
  const fetchUrls = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: options.url || 'https://example.test/course/',
    virtualConsole
  })
  const { window } = dom

  window.fetch = async input => {
    const url = String(input)
    fetchUrls.push(url)
    if (url.endsWith('/Explain.md')) {
      return { ok: true, text: async () => EXPLAIN_MARKDOWN }
    }
    return { ok: false, text: async () => '' }
  }
  window.setInterval = () => 1
  window.clearInterval = () => {}
  window.MutationObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }

  try {
    window.eval(bundleSource)
    await flushDomWork()
    await callback({ window, document: window.document, errors, fetchUrls })
    await flushDomWork()
  } finally {
    dom.window.close()
  }
}

function explainLinks(element) {
  return Array.from(
    element.shadowRoot.querySelectorAll('.lia-mathpath-explain-link')
  )
}

test('README forwards the optional @Explain argument to the custom element', () => {
  assert.match(
    readmeSource,
    /^@Explain: <lia-mathpath-explain data-lia-explain-topic="@0"><\/lia-mathpath-explain>$/m
  )
})

test('README uses a local DevServer-compatible bundle URL without a query string', () => {
  assert.match(readmeSource, /^script:\s+\.\/dist\/index\.js$/m)
  assert.doesNotMatch(readmeSource, /^script:.*\?/m)
})

test('README places one live @Explain(Tutorial) on its first slide', () => {
  const firstSlide = readmeSource.split(/\r?\n# Glossarbegriffe sicher verwenden/)[0]
  const liveCalls = firstSlide.match(/<h2>\s*@Explain\(Tutorial\)\s*<\/h2>/g) || []

  assert.equal(liveCalls.length, 1)
  assert.match(
    firstSlide,
    /\*\*Live-Test: manuell und außerhalb eines Hints\*\*\r?\n\r?\n<h2>\s*@Explain\(Tutorial\)\s*<\/h2>/
  )
  assert.doesNotMatch(firstSlide, /\[\[\?\]\].*@Explain\(Tutorial\)/)
})

test('Explain.md maps Tutorial to the dedicated explanation course', () => {
  const tutorialRow = explainSource.split(/\r?\n/).find(line =>
    /^\|\s*Tutorial\s*\|/.test(line)
  )

  assert.ok(tutorialRow)
  assert.equal(tutorialRow.split('|')[2].trim(), TUTORIAL_URL)
})

test('renders a freely placed Tutorial outside quiz and hint contexts', async () => {
  await withMathPath(
    [
      '<main>',
      '  <p>Inhalt vor dem Link</p>',
      '  <lia-mathpath-explain data-lia-explain-topic="Tutorial"></lia-mathpath-explain>',
      '  <p>Inhalt nach dem Link</p>',
      '</main>'
    ].join(''),
    ({ document, errors }) => {
      const element = document.querySelector('lia-mathpath-explain')
      const links = explainLinks(element)

      assert.equal(element.closest('.lia-quiz'), null)
      assert.equal(element.closest('[data-hint]'), null)
      assert.deepEqual(links.map(link => link.textContent), ['Tutorial'])
      assert.equal(links[0].href, TUTORIAL_URL)
      assert.equal(
        links[0].closest('li').textContent,
        'Das Tutorial zeigt dir die wichtigsten LiaScript-Funktionen mit kurzen Erklärungen und GIFs.'
      )
      assert.deepEqual(errors, [])
    }
  )
})

test('loads Explain.md next to a loopback course before the GitHub fallback', async () => {
  await withMathPath(
    '<lia-mathpath-explain data-lia-explain-topic="Tutorial"></lia-mathpath-explain>',
    ({ document, errors, fetchUrls }) => {
      const explainFetches = fetchUrls.filter(url => url.endsWith('/Explain.md'))
      const element = document.querySelector('lia-mathpath-explain')

      assert.deepEqual(explainFetches, ['http://localhost:8001/Explain.md'])
      assert.deepEqual(explainLinks(element).map(link => link.textContent), ['Tutorial'])
      assert.deepEqual(errors, [])
    },
    {
      url: 'http://localhost:8001/liascript/index.html?http://localhost:8001/README.md'
    }
  )
})

test('prefers an explicit Explain topic over a related ADetails topic', async () => {
  await withMathPath(
    [
      '<div class="lia-quiz">',
      '  <lia-mathpath-explain data-lia-explain-topic="Bruchrechnung"></lia-mathpath-explain>',
      '  <span data-adetails-all="1=BE; Einheiten"></span>',
      '</div>'
    ].join(''),
    ({ document, errors }) => {
      const element = document.querySelector('lia-mathpath-explain')
      const links = explainLinks(element)

      assert.deepEqual(links.map(link => link.textContent), ['Bruchrechnung'])
      assert.equal(links[0].href, BRUCHRECHNUNG_URL)
      assert.deepEqual(errors, [])
    }
  )
})

test('keeps the parameterless ADetails fallback with no attribute or LiaScript @0 sentinel', async () => {
  for (const topicAttribute of ['', ' data-lia-explain-topic="@0"']) {
    await withMathPath(
      [
        '<div class="lia-quiz">',
        `  <lia-mathpath-explain${topicAttribute}></lia-mathpath-explain>`,
        '  <span data-adetails-all="1=BE; Bruchrechnung, Einheiten"></span>',
        '</div>'
      ].join(''),
      ({ document, errors }) => {
        const element = document.querySelector('lia-mathpath-explain')
        const links = explainLinks(element)

        assert.deepEqual(
          links.map(link => link.textContent),
          ['Bruchrechnung', 'Einheiten']
        )
        assert.deepEqual(errors, [])
      }
    )
  }
})

test('shows the existing empty message for an unknown explicit topic', async () => {
  await withMathPath(
    [
      '<div class="lia-quiz">',
      '  <lia-mathpath-explain data-lia-explain-topic="Unbekannt"></lia-mathpath-explain>',
      '  <span data-adetails-all="1=BE; Bruchrechnung"></span>',
      '</div>'
    ].join(''),
    ({ document, errors }) => {
      const element = document.querySelector('lia-mathpath-explain')

      assert.deepEqual(explainLinks(element), [])
      assert.equal(
        element.shadowRoot.querySelector('li')?.textContent,
        'Leider gibt es noch keinen automatisch verlinkten Erklärungskurs.'
      )
      assert.deepEqual(errors, [])
    }
  )
})
