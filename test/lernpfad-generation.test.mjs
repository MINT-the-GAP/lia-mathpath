import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const generationSource = await readFile(new URL('../src/lernpfad-generation.ts', import.meta.url), 'utf8')
const generationScript = ts.transpileModule(generationSource, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020
} }).outputText.replace(
  './lernpfad-recommendations',
  new URL('../src/lernpfad-recommendations.ts', import.meta.url).href
)
const {
  createLearningCourseGenerator,
  LearningGenerationError
} = await import('data:text/javascript;base64,' + Buffer.from(generationScript).toString('base64'))

const courseUrl = 'https://example.test/course.md'
const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('de-DE')

const topic = (name, level = 'Fortgeschritten', changes = {}) => ({
  topic: name,
  taskCount: 6,
  weaknessCount: 2,
  partialCount: 0,
  unavailableCount: 0,
  level,
  levelReason: level ? `Niveau ${level}` : 'Kein Niveau',
  ...changes
})

const report = (changes = {}) => {
  const algebra = topic('Algebra')
  return {
    courseUrl,
    phase: 'live',
    topics: [algebra],
    weaknessTopics: [algebra],
    recommendations: [],
    statusCounts: { correct: 1, wrong: 1, partial: 0, unanswered: 1, unavailable: 0 },
    warnings: [],
    ...changes
  }
}

const recommendation = (type, targetLevel, name = 'Algebra', changes = {}) => ({
  type,
  topic: name,
  targetLevel,
  taskCount: 4,
  available: true,
  reason: 'test',
  ...changes
})

const sharedOutput = (markdown = '<!--\nlernpfad-level: Einsteiger\n-->\n# Kurs') => ({
  tasks: Array.from({ length: 4 }, (_, index) => ({
    id: `task-${index + 1}`,
    url: `https://example.test/task-${index + 1}.md`,
    title: `Task ${index + 1}`,
    tags: ['Algebra'], topics: ['Algebra'], difficulty: index + 1, network: null, operator: null
  })),
  documents: [],
  source: markdown
})

function harness(initialReport = report(), generateImpl = async () => sharedOutput()) {
  let currentUrl = courseUrl
  let currentReport = initialReport
  let reads = 0
  const calls = []
  const sourceManifests = []
  const directManifests = []
  const runtime = {
    baseUrl: 'https://mint-the-gap.github.io/Aufgabensammlung/',
    catalog: { schema: 'schullia-course-catalog', version: 1, tasks: [] },
    assembler: { build: () => '' },
    generator: {
      async generate(_catalog, request, options) {
        calls.push(request)
        return generateImpl(request, {
        setReport: value => { currentReport = value },
        setCourseUrl: value => { currentUrl = value }
        }, options)
      },
      learningPathSourceOptions(manifest) {
        sourceManifests.push(structuredClone(manifest))
        return { header: [`lernpfad-level: ${manifest.level}`] }
      },
      buildDirectCourseUrl(base, manifest) {
        assert.equal(base, 'https://mint-the-gap.github.io/Aufgabensammlung/index.html')
        directManifests.push(structuredClone(manifest))
        return 'https://mint-the-gap.github.io/Aufgabensammlung/course.html#course=test'
      }
    }
  }
  const generate = createLearningCourseGenerator({
    getRecommendations: async () => {
      reads++
      return structuredClone(currentReport)
    },
    getCurrentCourseUrl: () => currentUrl,
    loadRuntime: async () => runtime,
    fetcher: async () => { throw new Error('unexpected direct fetch') }
  })
  return {
    calls,
    directManifests,
    generate,
    reads: () => reads,
    sourceManifests,
    setReport: value => { currentReport = value },
    setCourseUrl: value => { currentUrl = value }
  }
}

test('maps all three offers to the one shared strict-count policy and revalidates twice', async () => {
  const cases = [
    ['weakness', 'Einsteiger', 'schwaechen-ueben', 'einsteiger'],
    ['practice', 'Fortgeschritten', 'weitere-uebungen', 'fortgeschrittene'],
    ['deepen', 'Experte', 'vertiefungen', 'experten']
  ]
  for (const [type, level, offer, group] of cases) {
    const h = harness()
    const result = await h.generate({ courseUrl, recommendation: recommendation(type, level) }, { seed: 'fixed' })
    assert.equal(h.reads(), 2)
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.calls[0], {
      themes: ['Algebra'], blockedThemes: [], count: 4, group, strictCount: true, seed: 'fixed'
    })
    assert.equal(h.directManifests[0].offer, offer)
    assert.equal(h.directManifests[0].level, group)
    assert.equal(result.type, type)
    assert.equal(result.targetLevel, level)
    assert.deepEqual(result.taskIds, ['task-1', 'task-2', 'task-3', 'task-4'])
  }
})

test('uses complete normalized tags while preserving the selected topic text', async () => {
  const selected = '  TERME, mit `x`  '
  const named = topic('Terme, mit `x`', 'Einsteiger')
  const h = harness(report({ topics: [named], weaknessTopics: [named] }))
  const result = await h.generate({
    courseUrl,
    recommendation: recommendation('practice', 'Einsteiger', selected)
  })
  assert.deepEqual(h.calls[0].themes, ['TERME, mit `x`'])
  assert.equal(result.topic, 'TERME, mit `x`')

  const partial = harness(report({ topics: [topic('Bruchrechnung', 'Einsteiger')], weaknessTopics: [] }))
  await assert.rejects(
    partial.generate({ courseUrl, recommendation: recommendation('practice', 'Einsteiger', 'Bruch') }),
    error => error instanceof LearningGenerationError && error.code === 'OFFER_UNAVAILABLE'
  )
  assert.equal(partial.calls.length, 0)
})

test('rejects a recommendation that changes level while task documents are loading', async () => {
  const h = harness(report(), async (_query, controls) => {
    const changed = topic('Algebra', 'Experte')
    controls.setReport(report({ topics: [changed], weaknessTopics: [changed] }))
    return sharedOutput()
  })
  await assert.rejects(
    h.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten') }),
    error => error instanceof LearningGenerationError && error.code === 'STALE_RECOMMENDATION'
  )
  assert.equal(h.reads(), 2)
})

test('blocks a delayed Send phase and a course switch before returning generated data', async () => {
  const send = harness(report(), async (_query, controls) => {
    controls.setReport(report({ phase: 'collect', weaknessTopics: [] }))
    return sharedOutput()
  })
  await assert.rejects(
    send.generate({ courseUrl, recommendation: recommendation('weakness', 'Einsteiger') }),
    error => error instanceof LearningGenerationError && error.code === 'OFFER_UNAVAILABLE'
  )

  const switched = harness(report(), async (_query, controls) => {
    controls.setCourseUrl('https://example.test/other.md')
    return sharedOutput()
  })
  await assert.rejects(
    switched.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten') }),
    error => error instanceof LearningGenerationError && error.code === 'COURSE_CHANGED'
  )
})

test('does not invent a level above Experte or invoke the shared generator', async () => {
  const expert = topic('Algebra', 'Experte')
  const h = harness(report({ topics: [expert], weaknessTopics: [expert] }))
  await assert.rejects(
    h.generate({ courseUrl, recommendation: recommendation('deepen', null, 'Algebra', { available: false }) }),
    error => error instanceof LearningGenerationError && error.code === 'NO_HIGHER_LEVEL'
  )
  assert.equal(h.calls.length, 0)
})

test('reports the actual strict-count shortage and rejects duplicate generated IDs', async () => {
  const shortage = harness(report(), async () => {
    const error = new Error('Nur drei Treffer')
    error.code = 'INSUFFICIENT_TASKS'
    error.matchingTaskCount = 3
    throw error
  })
  await assert.rejects(
    shortage.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten') }),
    error => error instanceof LearningGenerationError && error.code === 'INSUFFICIENT_TASKS' &&
      error.details.matchingTaskCount === 3 && error.details.requiredTaskCount === 4
  )

  const duplicate = harness(report(), async () => {
    const output = sharedOutput()
    output.tasks[3] = { ...output.tasks[2] }
    return output
  })
  await assert.rejects(
    duplicate.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten') }),
    error => error instanceof LearningGenerationError && error.code === 'INSUFFICIENT_TASKS'
  )
})

test('classifies conflicting task templates as an unsupported dependency', async () => {
  const h = harness(report(), async () => {
    const error = new Error('Die Aufgaben verwenden unterschiedliche Definitionen für @style.')
    error.code = 'BUILD_FAILED'
    throw error
  })
  await assert.rejects(
    h.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten') }),
    error => error instanceof LearningGenerationError && error.code === 'UNSUPPORTED_DEPENDENCY'
  )
})

test('returns detached structured data and preserves generated ADetails/Explain source verbatim', async () => {
  const markdown = [
    '<!--',
    'lernpfad-level: Fortgeschritten',
    'import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md',
    '-->',
    '# Aufgabe',
    '[[ 0 ]]',
    '[[?]] @Explain',
    '@ADetails(`0=BE;Brüche, Terme`)',
    '# Dein weiterer Lernpfad',
    '@Lernpfad'
  ].join('\n')
  const output = sharedOutput(markdown)
  const h = harness(report(), async () => output)
  const result = await h.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten') })
  assert.equal(result.markdown, markdown)
  assert.match(result.markdown, /@ADetails\(`0=BE;Brüche, Terme`\)/)
  assert.match(result.markdown, /\[\[\?\]\] @Explain/)
  assert.doesNotMatch(result.markdown, /freeze|@Abgabe|@Auswertung/i)
  result.taskIds[0] = 'changed'
  assert.equal(output.tasks[0].id, 'task-1')
})

test('honors aborts and validates the fixed structured request before I/O', async () => {
  const h = harness()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    h.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten') }, { signal: controller.signal }),
    error => error instanceof LearningGenerationError && error.code === 'ABORTED'
  )
  await assert.rejects(
    h.generate({ courseUrl, recommendation: recommendation('practice', 'Fortgeschritten', 'Algebra', { taskCount: 3 }) }),
    error => error instanceof LearningGenerationError && error.code === 'INVALID_REQUEST'
  )
  assert.equal(h.calls.length, 0)
})

test('builds source options and direct manifest around the same shared selection', async () => {
  let receivedOptions
  const h = harness(report(), async (request, _controls, options) => {
    assert.equal(request.seed, 17)
    receivedOptions = options
    return sharedOutput('<!--\nlernpfad-level: Einsteiger\n-->\n# Generated\n@Lernpfad')
  })
  const result = await h.generate(
    { courseUrl, recommendation: recommendation('weakness', 'Einsteiger') },
    { seed: 17 }
  )
  assert.equal(receivedOptions.assembler.build instanceof Function, true)
  assert.deepEqual(receivedOptions.sourceOptions, { header: ['lernpfad-level: einsteiger'] })
  assert.deepEqual(h.sourceManifests, [{
    v: 1, kind: 'lernpfad', offer: 'schwaechen-ueben', topic: 'Algebra', level: 'einsteiger', urls: []
  }])
  assert.deepEqual(h.directManifests, [{
    v: 1, kind: 'lernpfad', offer: 'schwaechen-ueben', topic: 'Algebra', level: 'einsteiger',
    urls: Array.from({ length: 4 }, (_, index) => `https://example.test/task-${index + 1}.md`)
  }])
  assert.equal(result.catalogVersion, 1)
  assert.match(result.openingTarget, /course\.html#course=/)
})
