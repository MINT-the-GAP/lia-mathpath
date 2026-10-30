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
    release: '1.0.0',
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
    assert.equal(runtime.generator.release, '1.0.0')
    assert.equal(runtime.baseUrl, 'https://catalog.test/root/')
    assert.equal(dom.window.document.querySelectorAll('script').length, 0)
  } finally { dom.window.close() }
})

test('rejects an incompatible generator or catalog version', async () => {
  for (const changes of [{ version: 2 }, { schema: 'other' }]) {
    const dom = new JSDOM('', { url: 'https://course.test/' })
    try {
      install(dom, changes)
      await assert.rejects(loadSharedCourseRuntime(dom.window.document), /Version/)
    } finally { dom.window.close() }
  }
})
