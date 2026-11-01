import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DIRECT_COURSE_RELEASE, generateAndOpenLearningCourse, LearningCourseOpenError
} from '../src/lernpfad-open.ts'
import { SHARED_COURSE_RELEASE } from '../src/lernpfad-shared.ts'

const target = 'https://mint-the-gap.github.io/Aufgabensammlung/course.html?v=1.0.10#course=%7B%22v%22%3A1%7D'

test('keeps the direct course shell aligned with the shared runtime release', () => {
  assert.equal(DIRECT_COURSE_RELEASE, SHARED_COURSE_RELEASE)
})

function browser() {
  const calls = []
  const popup = {
    closed: false,
    opener: {},
    close() { this.closed = true; calls.push(['close']) },
    location: { replace(value) { calls.push(['replace', value]) } }
  }
  return { calls, popup, window: { open(...args) { calls.push(['open', ...args]); return popup } } }
}

test('reserves a separated popup synchronously and navigates only after generation', async () => {
  const harness = browser()
  let finish
  const pending = generateAndOpenLearningCourse(
    () => new Promise(resolve => { finish = resolve }),
    harness.window
  )
  assert.deepEqual(harness.calls, [['open', 'about:blank', '_blank']])
  assert.equal(harness.popup.opener, null)
  finish({ openingTarget: target, marker: 4 })
  const result = await pending
  assert.equal(result.marker, 4)
  assert.deepEqual(harness.calls[1], ['replace', target])
  assert.equal(harness.popup.closed, false)
})

test('reports blocked popups before generation starts', async () => {
  let generated = 0
  await assert.rejects(
    generateAndOpenLearningCourse(async () => { generated++; return { openingTarget: target } }, { open: () => null }),
    error => error instanceof LearningCourseOpenError && error.code === 'POPUP_BLOCKED'
  )
  assert.equal(generated, 0)
})

test('closes the reserved page after generation or target validation fails', async () => {
  for (const generate of [
    async () => { throw new Error('Katalog fehlt') },
    async () => ({ openingTarget: 'javascript:alert(1)' }),
    async () => ({ openingTarget: 'https://mint-the-gap.github.io/Aufgabensammlung/course.html?v=next#course=x' })
  ]) {
    const harness = browser()
    await assert.rejects(generateAndOpenLearningCourse(generate, harness.window))
    assert.equal(harness.popup.closed, true)
    assert.equal(harness.calls.some(call => call[0] === 'replace'), false)
  }
})
