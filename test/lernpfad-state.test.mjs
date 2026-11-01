import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyNativeLearningState, nativeCourseVersion, projectLearningState,
  readLearningState
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
const liveBridge = (tasks, changes = {}) => bridge({
  phase: 'live', payload: null,
  liveState: { version: 1, slides: { '#2': tasks } },
  ...changes,
})

test('native score:1 never turns a failed or untouched task into a correct answer', () => {
  assert.deepEqual(
    (({ status, failedAttempts }) => ({ status, failedAttempts }))(
      classifyNativeLearningState(task(), native(0, 3))
    ),
    { status: 'wrong', failedAttempts: 3 }
  )
  assert.equal(classifyNativeLearningState(task(), native(0, 0)).status, 'unanswered')
  assert.deepEqual(
    (({ status, failedAttempts }) => ({ status, failedAttempts }))(
      classifyNativeLearningState(task(), native(1, 13))
    ),
    { status: 'correct', failedAttempts: 12 }
  )
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

test('reads the latest record of the compatible major version and respects reset on every read', () => {
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

test('review trusts its snapshot instead of stale live fallback data, including evaluation-only native results', () => {
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

test('projects live Freeze metadata with exact failed-attempt counts', () => {
  const authored = course({ tasks: [
    task(),
    task({ id: '#2:1', taskIndex: 1, nativeIndex: 1 }),
    task({ id: '#2:2', taskIndex: 2, nativeIndex: 2 }),
  ] })
  const live = liveBridge([
    { taskIndex: 0, nativeIndex: 0, table: 'quiz', outcome: 'correct', trial: 13 },
    { taskIndex: 1, nativeIndex: 1, table: 'quiz', outcome: 'wrong', trial: 4 },
  ])
  assert.deepEqual(projectLearningState(authored, empty(), live, true).states.map(state =>
    [state.status, state.failedAttempts]), [
    ['correct', 12], ['wrong', 4], ['unanswered', 0],
  ])
})

test('never touches IndexedDB while reading live, Send, or frozen learning state', async () => {
  let accesses = 0
  const win = {
    get indexedDB() { accesses++; throw new Error('must not be accessed') },
    __liaFreezeLearningStateV1__: { read: () => liveBridge([
      { taskIndex: 0, nativeIndex: 0, table: 'quiz', outcome: 'correct', trial: 3 },
    ]) },
    document: { body: { classList: { contains: () => false } } },
  }
  const live = await readLearningState(course(), win)
  assert.equal(live.states[0].status, 'correct')
  assert.equal(live.states[0].failedAttempts, 2)
  win.__liaFreezeLearningStateV1__.read = () => bridge({ phase: 'collect' })
  assert.equal((await readLearningState(course(), win)).phase, 'collect')
  win.__liaFreezeLearningStateV1__.read = () => bridge()
  assert.equal((await readLearningState(course(), win)).phase, 'review')
  assert.equal(accesses, 0)
})
