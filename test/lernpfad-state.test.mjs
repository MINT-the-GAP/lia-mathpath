import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyNativeLearningState, nativeCourseVersion, projectLearningState,
  readLearningState, readNativeLearningTables
} from '../src/lernpfad-state.ts'

const task = (changes = {}) => ({ id: '#2:0', hash: '#2', sectionIndex: 1,
  taskIndex: 0, nativeIndex: 0, table: 'quiz', tags: ['Bruchrechnung'], points: 2,
  level: 'Einsteiger', mappingSafe: true, sourceLine: 10, ...changes })
const course = (changes = {}) => ({ url: 'https://example.test/a/course.md',
  version: '2.3.4', tasks: [task()], warnings: [], sendMode: false, ...changes })
const empty = () => ({ quiz: [], survey: [] })
const tables = (data, version = 2) => ({ quiz: [{ id: 1, version, data }], survey: [] })
const native = (solved, trial) => ({ solved, trial, score: 1, state: { Multi: [{ Text: '' }] } })
const bridge = (changes = {}) => ({ version: 1, courseUrl: course().url, courseVersion: '2.3.4',
  phase: 'review', payload: { s: [{ h: '#2', quiz: { 1: [native(1, 1)] } }] }, manualAwards: {}, ...changes })

test('native score:1 never turns a failed or untouched task into a correct answer', () => {
  assert.equal(classifyNativeLearningState(task(), native(0, 3)).status, 'wrong')
  assert.equal(classifyNativeLearningState(task(), native(0, 0)).status, 'unanswered')
  assert.equal(classifyNativeLearningState(task(), native(1, 3)).status, 'correct')
  assert.equal(classifyNativeLearningState(task(), native(-1, 0)).status, 'unavailable')
  assert.equal(classifyNativeLearningState(task(), undefined).status, 'unavailable')
  assert.equal(classifyNativeLearningState(task(), { solved: 0 }).status, 'unavailable')
  assert.equal(classifyNativeLearningState(task({ points: 0 }), undefined).status, 'unavailable')
})

test('missing compatible records are unanswered while malformed vectors remain unavailable', () => {
  for (const data of [empty(), tables([native(1, 1)], 1), tables([native(1, 1)], 3)]) {
    assert.equal(projectLearningState(course(), data).states[0].status, 'unanswered')
  }
  for (const data of [tables([]), tables([native(1, 1), native(0, 0)])]) {
    assert.equal(projectLearningState(course(), data).states[0].status, 'unavailable')
  }
  assert.equal(nativeCourseVersion('2.3.4'), 2)
  assert.equal(nativeCourseVersion('0.0.11'), 0)
  assert.equal(nativeCourseVersion(null), null)
  assert.equal(nativeCourseVersion('abc'), null)
  assert.equal(projectLearningState(course({ version: null }), tables([native(1, 1)])).states[0].status, 'unavailable')
})

test('reads the latest record of the compatible major version and respects reset on every click', () => {
  const data = tables([native(1, 1)])
  data.quiz[0].created = 1
  data.quiz.push({ id: 1, version: 2, created: 2, data: [native(0, 0)] })
  data.quiz.push({ id: 1, version: 9, created: 3, data: [native(1, 1)] })
  assert.equal(projectLearningState(course(), data).states[0].status, 'unanswered')
  data.quiz[1].data = [native(0, 1)]
  assert.equal(projectLearningState(course(), data).states[0].status, 'wrong')
  data.quiz[1].data = [native(1, 2)]
  assert.equal(projectLearningState(course(), data).states[0].status, 'correct')
})

test('uses section and table indexes across slides without shifting surveys into quizzes', () => {
  const authored = course({ tasks: [task(), task({ id: '#2:1', taskIndex: 1, table: 'survey' }),
    task({ id: '#2:2', taskIndex: 2, nativeIndex: 1 }),
    task({ id: '#3:0', hash: '#3', sectionIndex: 2 })] })
  const data = tables([native(1, 1), native(0, 0)])
  data.quiz.push({ id: 2, version: 2, data: [native(0, 2)] })
  assert.deepEqual(projectLearningState(authored, data).states.map(state => state.status),
    ['correct', 'unavailable', 'unanswered', 'wrong'])
  authored.tasks[2].mappingSafe = false
  assert.equal(projectLearningState(authored, data).states[2].status, 'unavailable')
})

test('Send and pending or incompatible Freeze never reveal native or frozen outcomes', () => {
  const data = tables([native(1, 1)])
  for (const value of [bridge({ phase: 'collect' }), bridge({ phase: 'grading' }),
    bridge({ phase: 'unavailable' }), bridge({ courseUrl: 'https://other.test/a/course.md' }),
    bridge({ courseVersion: '2.3.5' }), null]) {
    assert.equal(projectLearningState(course(), data, value, true).states[0].status, 'unavailable')
  }
  assert.equal(projectLearningState(course({ sendMode: true }), data).phase, 'collect')
  assert.equal(projectLearningState(course({ sendMode: true }), data).states[0].status, 'unavailable')
})

test('review trusts its snapshot instead of stale live IndexedDB, including evaluation-only native results', () => {
  const frozen = bridge()
  const result = projectLearningState(course(), tables([native(0, 8)]), frozen, true)
  assert.equal(result.states[0].status, 'correct')
  assert.equal(result.states[0].source, 'freeze-snapshot')
  frozen.payload.s[0].quizEval = { 1: [native(0, 1)] }
  assert.equal(projectLearningState(course(), tables([native(1, 1)]), frozen, true).states[0].status, 'wrong')
  delete frozen.payload.s[0].quiz
  delete frozen.payload.s[0].quizEval
  assert.equal(projectLearningState(course(), tables([native(1, 1)]), frozen, true).states[0].status, 'unavailable')
})

test('manual awards use authored task identity and distinguish zero, partial and full credit', () => {
  const authored = course({ tasks: [task({ table: 'survey' })] })
  for (const [award, expected] of [['0', 'wrong'], ['0,5', 'partial'], [2, 'correct'], ['', 'unavailable'], ['abc', 'unavailable'], [3, 'unavailable']]) {
    const data = bridge({ manualAwards: { '#2::task::1': award } })
    assert.equal(projectLearningState(authored, empty(), data, true).states[0].status, expected)
  }
  const zero = course({ tasks: [task({ table: 'survey', points: 0 })] })
  assert.equal(projectLearningState(zero, empty(), bridge({ manualAwards: { '#2::task::1': 0 } }), true).states[0].status, 'unavailable')
})

function fakeDatabase(data, beforeComplete = () => {}) {
  const calls = { opens: [], modes: [], closed: 0 }
  const factory = { open(url) {
    calls.opens.push(url)
    const request = {}
    const db = { objectStoreNames: { contains: name => name === 'quiz' },
      close: () => calls.closed++, transaction(names, mode) {
        calls.modes.push(mode)
        const tx = { objectStore() { return { getAll() {
          const read = {}
          setImmediate(() => {
            read.result = data; read.onsuccess?.(); beforeComplete(); tx.oncomplete?.()
          })
          return read
        } } } }
        return tx
      } }
    setImmediate(() => { request.result = db; request.onsuccess?.() })
    return request
  } }
  return { calls, factory }
}

test('opens only the exact course URL and reads through a readonly transaction', async () => {
  const { calls, factory } = fakeDatabase(tables([native(1, 1)]).quiz)
  const data = await readNativeLearningTables(course().url, factory)
  assert.equal(data.quiz[0].data[0].solved, 1)
  assert.deepEqual(calls.opens, [course().url])
  assert.deepEqual(calls.modes, ['readonly'])
  assert.equal(calls.closed, 1)
})

test('reads the exact generated parent course identity but rejects arbitrary custom protocols', async () => {
  const parentUrl = 'parent:schullia-0123456789abcdef'
  const { calls, factory } = fakeDatabase(tables([native(1, 1)]).quiz)
  const data = await readNativeLearningTables(parentUrl, factory)
  assert.equal(data.quiz[0].data[0].solved, 1)
  assert.deepEqual(calls.opens, [parentUrl])
  assert.deepEqual(await readNativeLearningTables('parent:other-0123456789abcdef', factory), empty())
  assert.deepEqual(calls.opens, [parentUrl])
})

test('aborts absent database creation and tolerates disabled browser storage', async () => {
  let aborted = 0
  const factory = { open() {
    const request = { transaction: { abort: () => aborted++ } }
    setImmediate(() => request.onupgradeneeded?.())
    return request
  } }
  assert.deepEqual(await readNativeLearningTables(course().url, factory), empty())
  assert.equal(aborted, 1)
  assert.deepEqual(await readNativeLearningTables(course().url), empty())
})

test('checks deferred Send again after an asynchronous database read', async () => {
  let current = bridge({ phase: 'live', payload: null })
  const { factory } = fakeDatabase(tables([native(1, 1)]).quiz, () => { current = bridge({ phase: 'grading' }) })
  const win = { indexedDB: factory, __liaFreezeLearningStateV1__: { read: () => current },
    document: { getElementById: () => null, body: { classList: { contains: () => false } } } }
  const result = await readLearningState(course(), win)
  assert.equal(result.phase, 'grading')
  assert.equal(result.states[0].status, 'unavailable')
})

test('a legacy Freeze import without a protected phase keeps native live state available', async () => {
  const { calls, factory } = fakeDatabase(tables([native(1, 1)]).quiz)
  const win = { indexedDB: factory, __liaFreezeV2LifecycleV1__: { bootScheduled: true },
    __liaSubmissionDemo: {},
    document: { getElementById: () => ({}), body: { classList: { contains: () => false } } } }
  const result = await readLearningState(course(), win)
  assert.equal(result.phase, 'live')
  assert.equal(result.states[0].status, 'correct')
  assert.deepEqual(calls.opens, [course().url])
})

test('never opens native storage in Send collection or in old frozen review', async () => {
  let opened = 0
  let frozen = false
  const win = { indexedDB: { open: () => { opened++; throw new Error('not allowed') } },
    document: { getElementById: () => null, body: { classList: { contains: value => frozen && value === 'lia-course-frozen' } } } }
  assert.equal((await readLearningState(course({ sendMode: true }), win)).phase, 'collect')
  frozen = true
  win.__liaFreezeV2LifecycleV1__ = {}
  assert.equal((await readLearningState(course(), win)).phase, 'unavailable')
  assert.equal(opened, 0)
})
