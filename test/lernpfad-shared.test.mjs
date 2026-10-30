import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { loadSharedCourseRuntime } from '../src/lernpfad-shared.ts'

function catalog() {
  return { schema: 'schullia-course-catalog', version: 1, tasks: [] }
}

function install(dom, changes = {}) {
  const value = catalog()
  dom.window.SchulLiaCourseSource = { build: () => '# Kurs' }
  dom.window.SchulLiaCourseCatalog = value
  dom.window.SchulLiaCourseGenerator = {
    schema: 'schullia-course-generator',
    version: 1,
    release: '1.0.3',
    profiles: {},
    validateCatalog: input => input,
    generate: async () => ({ tasks: [], documents: [], source: '# Kurs' }),
    learningPathSourceOptions: () => ({}),
    buildDirectCourseUrl: () => 'https://example.test/course.html#course=x',
    createSeededRandom: () => () => 0.5,
    ...changes
  }
}

test('accepts the explicit v1 shared runtime and returns one promise per document', async () => {
  const dom = new JSDOM('', { url: 'https://course.test/' })
  try {
    install(dom)
    const first = loadSharedCourseRuntime(dom.window.document, 'https://catalog.test/root/')
    const second = loadSharedCourseRuntime(dom.window.document, 'https://ignored.test/')
    assert.equal(first, second)
    const runtime = await first
    assert.equal(runtime.catalog.schema, 'schullia-course-catalog')
    assert.equal(runtime.generator.release, '1.0.3')
    assert.equal(runtime.baseUrl, 'https://catalog.test/root/')
    assert.equal(dom.window.document.querySelectorAll('script').length, 0)
  } finally { dom.window.close() }
})

test('loads release-pinned assets in dependency order', async () => {
  const dom = new JSDOM('', { url: 'https://course.test/' })
  try {
    const urls = []
    const append = dom.window.document.head.append.bind(dom.window.document.head)
    dom.window.document.head.append = (...nodes) => {
      for (const node of nodes) {
        urls.push(node.src)
        append(node)
        if (node.src.includes('course-source.js')) {
          dom.window.SchulLiaCourseSource = { build: () => '# Kurs' }
        } else if (node.src.includes('course-generator.js')) {
          install(dom)
          delete dom.window.SchulLiaCourseCatalog
        } else if (node.src.includes('course-catalog.js')) {
          dom.window.SchulLiaCourseCatalog = catalog()
        }
        queueMicrotask(() => node.dispatchEvent(new dom.window.Event('load')))
      }
    }
    const runtime = await loadSharedCourseRuntime(dom.window.document, 'https://catalog.test/root/')
    assert.equal(runtime.generator.release, '1.0.3')
    assert.deepEqual(urls, [
      'https://catalog.test/root/assets/course-source.js?v=1.0.3',
      'https://catalog.test/root/assets/course-generator.js?v=1.0.3',
      'https://catalog.test/root/assets/course-catalog.js?v=1.0.3'
    ])
  } finally { dom.window.close() }
})

test('rejects an incompatible generator, release, or catalog version', async () => {
  for (const changes of [{ version: 2 }, { schema: 'other' }, { release: '1.0.1' }]) {
    const dom = new JSDOM('', { url: 'https://course.test/' })
    try {
      install(dom, changes)
      await assert.rejects(loadSharedCourseRuntime(dom.window.document), /Version/)
    } finally { dom.window.close() }
  }
})
