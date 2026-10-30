import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLearningReport, selectLearningRecommendation } from '../src/lernpfad-recommendations.ts'

const task = (id, tags, level = 'Einsteiger', points = 1) => ({ id, tags, level, points })
const course = tasks => ({ url: 'https://example.test/course.md', version: '1.0.0', tasks, warnings: [], sendMode: false })
const snapshot = (states = [], phase = 'live') => ({ states: states.map(([taskId, status]) => ({ taskId, status, reason: '', source: 'test' })), warnings: [], phase })

test('ranks current weaknesses once per task/topic, retaining partial and unknown distinctions', () => {
  const tasks = [task('a', ['Algebra', 'Algebra', 'Geometrie']), task('b', ['Algebra']),
    task('c', ['Geometrie']), task('d', ['Transfer']), task('e', ['Transfer'], null), task('z', ['Reflexion'], null, 0)]
  const report = buildLearningReport(course([...tasks, tasks[0]]), snapshot([
    ['a', 'correct'], ['b', 'wrong'], ['c', 'unanswered'], ['d', 'partial'], ['z', 'unavailable']]))
  assert.deepEqual(report.statusCounts, { correct: 1, wrong: 1, partial: 1, unanswered: 1, unavailable: 2 })
  assert.deepEqual(report.weaknessTopics.map(t => [t.topic, t.weaknessCount]), [['Algebra', 1], ['Geometrie', 1], ['Transfer', 1]])
  assert.equal(report.topics.find(t => t.topic === 'Algebra').taskCount, 2)
  assert.equal(report.topics.find(t => t.topic === 'Transfer').partialCount, 1)
  assert.equal(report.topics.find(t => t.topic === 'Transfer').unavailableCount, 1)
  assert.ok(report.recommendations.every(r => r.taskCount === 4))
})

test('new snapshot replaces previous failure or reset state without cumulative counting', () => {
  const c = course([task('a', ['Algebra'])])
  assert.equal(buildLearningReport(c, snapshot([['a', 'wrong']])).weaknessTopics[0].weaknessCount, 1)
  assert.equal(buildLearningReport(c, snapshot([['a', 'correct']])).weaknessTopics.length, 0)
  assert.equal(buildLearningReport(c, snapshot([['a', 'unanswered']])).weaknessTopics[0].weaknessCount, 1)
})

test('mixed level mode resolves ties downwards; unknown levels are not fabricated', () => {
  const report = buildLearningReport(course([task('a', ['A'], 'Experte'), task('b', ['A'], 'Fortgeschritten'),
    task('c', ['A'], null), task('d', ['B'], null)]), snapshot())
  assert.equal(report.topics[0].level, 'Fortgeschritten')
  assert.match(report.topics[0].levelReason, /Gleichstand/)
  assert.equal(report.recommendations[1].targetLevel, 'Fortgeschritten')
  assert.equal(report.recommendations[2].targetLevel, 'Experte')
  assert.equal(selectLearningRecommendation('practice', report.topics[1], 'live').available, false)
  assert.equal(selectLearningRecommendation('deepen', { ...report.topics[0], level: 'Experte' }, 'live').available, false)
})

test('describes the three offers in learner-facing language for the selected topic', () => {
  const topic = {
    topic: 'Bruchrechnung', taskCount: 8, weaknessCount: 5, partialCount: 1,
    unavailableCount: 0, level: 'Einsteiger', levelReason: 'Technische Auswertung'
  }
  assert.equal(
    selectLearningRecommendation('weakness', topic, 'live').reason,
    'Wiederhole die Grundlagen zu „Bruchrechnung“ und festige die Inhalte, bei denen du noch unsicher bist.'
  )
  assert.equal(
    selectLearningRecommendation('practice', topic, 'live').reason,
    'Übe „Bruchrechnung“ auf demselben Niveau weiter und festige dein Wissen.'
  )
  assert.equal(
    selectLearningRecommendation('deepen', topic, 'live').reason,
    'Stelle dich neuen Herausforderungen und vertiefe „Bruchrechnung“ auf der nächsten Schwierigkeitsstufe.'
  )
  assert.doesNotMatch(
    [
      selectLearningRecommendation('weakness', topic, 'live').reason,
      selectLearningRecommendation('practice', topic, 'live').reason,
      selectLearningRecommendation('deepen', topic, 'live').reason,
    ].join(' '),
    /Aufgaben sind|Häufigstes angegebenes Niveau|Niveau für/
  )
})

test('Send suppresses even accidentally supplied prior correctness while retaining topic metadata', () => {
  for (const phase of ['collect', 'grading']) {
    const report = buildLearningReport(course([task('a', ['A'])]), snapshot([['a', 'wrong']], phase))
    assert.equal(report.statusCounts.wrong, 0)
    assert.equal(report.statusCounts.unavailable, 1)
    assert.deepEqual(report.weaknessTopics, [])
    assert.equal(report.recommendations[0].available, false)
    assert.equal(report.recommendations[1].targetLevel, 'Einsteiger')
  }
})

test('normalizes topic identity and handles a course without usable tags', () => {
  const report = buildLearningReport(course([task('a', [' Brüche ', 'brüche']), task('b', ['Brüche'])]), snapshot())
  assert.equal(report.topics.length, 1)
  assert.equal(report.topics[0].taskCount, 2)
  assert.equal(buildLearningReport(course([]), snapshot()).recommendations.length, 3)
  assert.ok(buildLearningReport(course([]), snapshot()).recommendations.every(r => !r.available))
})

test('carries a detached explicit course context into the learning report', () => {
  const c = course([task('a', ['Addition'])])
  c.context = {
    grade: 5, gradeSource: 'header-tags', schoolType: 'gymnasium',
    schoolTypeSource: 'comment', headerTags: ['Klasse 5', 'Gymnasium']
  }
  const report = buildLearningReport(c, snapshot())
  assert.deepEqual(report.context, c.context)
  assert.notEqual(report.context, c.context)
  assert.notEqual(report.context.headerTags, c.context.headerTags)
  report.context.headerTags.push('Spaeter')
  assert.deepEqual(c.context.headerTags, ['Klasse 5', 'Gymnasium'])
  assert.deepEqual(report.topics.map(topic => topic.topic), ['Addition'])
})
