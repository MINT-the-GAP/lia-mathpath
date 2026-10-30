import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { buildLearningReport } from '../src/lernpfad-recommendations.ts'

const source = await readFile(new URL('../src/lernpfad-ui.ts', import.meta.url), 'utf8')
const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
  .replace('./lernpfad-service', 'data:text/javascript,export function getLearningRecommendations(){throw new Error("unexpected default loader")}')
  .replace('./lernpfad-recommendations', new URL('../src/lernpfad-recommendations.ts', import.meta.url).href)
  .replace('./lernpfad-open-course', 'data:text/javascript,export function openLearningCourse(){throw new Error()}')
const { registerLearningPathElement } = await import('data:text/javascript;base64,' + Buffer.from(script).toString('base64'))
const tick = () => new Promise(resolve => setImmediate(resolve))
const report = () => buildLearningReport({ url: 'https://example.test/course.md', warnings: [], tasks: [
  { id: 'a', tags: ['Algebra'], level: 'Einsteiger' }, { id: 'b', tags: ['Transfer'], level: 'Experte' }
] }, { phase: 'live', warnings: [], states: [{ taskId: 'a', status: 'wrong' }, { taskId: 'b', status: 'correct' }] })

test('loads only on click, owns its controls, and updates each offer without quiz mutation', async () => {
  const dom = new JSDOM('<main><div class="lia-quiz"><input value="answer"><button>Check</button></div><lia-mathpath-lernpfad></lia-mathpath-lernpfad></main>')
  try {
    let reads = 0
    registerLearningPathElement(dom.window.document, async () => { reads++; return report() })
    registerLearningPathElement(dom.window.document, async () => { throw new Error('duplicate registration') })
    const host = dom.window.document.querySelector('lia-mathpath-lernpfad')
    const quiz = dom.window.document.querySelector('.lia-quiz')
    const input = quiz.querySelector('input')
    const html = quiz.outerHTML
    assert.equal(reads, 0)
    assert.equal(host.shadowRoot.querySelectorAll('button').length, 1)
    host.shadowRoot.querySelector('button').click()
    await tick()
    assert.equal(reads, 1)
    assert.equal(host.shadowRoot.querySelectorAll('select').length, 3)
    assert.equal(host.shadowRoot.querySelectorAll('button.open-course').length, 3)
    assert.equal(host.shadowRoot.querySelectorAll('button').length, 4)
    assert.equal(host.report.recommendations[1].targetLevel, 'Einsteiger')
    const deepen = host.shadowRoot.querySelector('[data-offer=deepen] select')
    deepen.value = 'Transfer'
    deepen.dispatchEvent(new dom.window.Event('change'))
    assert.equal(host.report.recommendations[2].available, false)
    assert.match(host.shadowRoot.querySelector('[data-offer=deepen] .reason').textContent, /höhere Stufe/)
    const copy = host.report
    copy.topics[0].topic = 'changed'
    assert.equal(host.report.topics[0].topic, 'Algebra')
    host.shadowRoot.querySelector('button').click()
    await tick()
    assert.equal(reads, 2)
    assert.equal(host.shadowRoot.querySelectorAll('section').length, 3)
    assert.equal(quiz.outerHTML, html)
    assert.equal(quiz.querySelector('input'), input)
  } finally { dom.window.close() }
})

test('generates from the changed dropdown snapshot, blocks double starts, and retries after errors', async () => {
  const dom = new JSDOM('<lia-mathpath-lernpfad></lia-mathpath-lernpfad>')
  try {
    const calls = []
    let finish
    let fail = false
    const open = (request, options) => {
      calls.push({ request: structuredClone(request), signal: options.signal })
      if (fail) return Promise.reject(new Error('Nur drei passende Aufgaben gefunden'))
      if (!finish) return new Promise(resolve => { finish = () => resolve({
        topic: request.recommendation.topic,
        openingTarget: 'https://mint-the-gap.github.io/Aufgabensammlung/course.html#course=x'
      }) })
      return Promise.resolve({
        topic: request.recommendation.topic,
        openingTarget: 'https://mint-the-gap.github.io/Aufgabensammlung/course.html#course=x'
      })
    }
    registerLearningPathElement(dom.window.document, async () => report(), open)
    const host = dom.window.document.querySelector('lia-mathpath-lernpfad')
    host.shadowRoot.querySelector('button.create').click()
    await tick()
    const section = host.shadowRoot.querySelector('[data-offer=practice]')
    const select = section.querySelector('select')
    select.value = 'Transfer'
    select.dispatchEvent(new dom.window.Event('change'))
    const button = section.querySelector('button.open-course')
    button.click()
    button.click()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].request.courseUrl, 'https://example.test/course.md')
    assert.equal(calls[0].request.recommendation.topic, 'Transfer')
    assert.equal(calls[0].request.recommendation.targetLevel, 'Experte')
    assert.ok(calls[0].signal instanceof AbortSignal)
    assert.ok([...host.shadowRoot.querySelectorAll('button.open-course')].every(control => control.disabled))
    finish()
    await tick()
    assert.match(section.querySelector('.course-status').textContent, /neuen Fenster/)
    assert.equal(button.disabled, false)

    fail = true
    button.click()
    await tick()
    assert.match(section.querySelector('.course-status').textContent, /Nur drei/)
    assert.equal(button.disabled, false)
    fail = false
    button.click()
    await tick()
    assert.equal(calls.length, 3)
    assert.match(section.querySelector('.course-status').textContent, /neuen Fenster/)
  } finally { dom.window.close() }
})

test('multiple Lernpfad hosts own independent listeners and each click starts once', async () => {
  const dom = new JSDOM('<lia-mathpath-lernpfad></lia-mathpath-lernpfad><lia-mathpath-lernpfad></lia-mathpath-lernpfad>')
  try {
    const calls = []
    registerLearningPathElement(dom.window.document, async () => report(), async request => {
      calls.push(request)
      return {
        topic: request.recommendation.topic,
        openingTarget: 'https://mint-the-gap.github.io/Aufgabensammlung/course.html#course=x'
      }
    })
    const hosts = [...dom.window.document.querySelectorAll('lia-mathpath-lernpfad')]
    for (const host of hosts) {
      host.shadowRoot.querySelector('button.create').click()
      await tick()
      host.shadowRoot.querySelector('[data-offer=practice] button.open-course').click()
      await tick()
    }
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.recommendation.type === 'practice'))
  } finally { dom.window.close() }
})

test('Send collection and grading show recommendations but cannot start a course or open a popup', async () => {
  for (const phase of ['collect', 'grading']) {
    const dom = new JSDOM('<lia-mathpath-lernpfad></lia-mathpath-lernpfad>')
    try {
      const collection = report()
      collection.phase = phase
      let opens = 0
      registerLearningPathElement(dom.window.document, async () => collection, async request => {
        opens++
        return {
          topic: request.recommendation.topic,
          openingTarget: 'https://mint-the-gap.github.io/Aufgabensammlung/course.html#course=x'
        }
      })
      const host = dom.window.document.querySelector('lia-mathpath-lernpfad')
      host.shadowRoot.querySelector('button.create').click()
      await tick()
      assert.equal(host.shadowRoot.querySelectorAll('select').length, 3)
      const buttons = [...host.shadowRoot.querySelectorAll('button.open-course')]
      assert.equal(buttons.length, 3)
      assert.ok(buttons.every(button => button.disabled))
      assert.ok([...host.shadowRoot.querySelectorAll('.course-status')]
        .every(status => /freigegebenen Auswertung/.test(status.textContent)))
      buttons.forEach(button => button.click())
      await tick()
      assert.equal(opens, 0)
    } finally { dom.window.close() }
  }
})

test('a late Send transition disables an already rendered live report before popup reservation', async () => {
  const dom = new JSDOM('<lia-mathpath-lernpfad></lia-mathpath-lernpfad>')
  try {
    let opens = 0
    registerLearningPathElement(dom.window.document, async () => report(), async request => {
      opens++
      return {
        topic: request.recommendation.topic,
        openingTarget: 'https://mint-the-gap.github.io/Aufgabensammlung/course.html#course=x'
      }
    })
    const host = dom.window.document.querySelector('lia-mathpath-lernpfad')
    host.shadowRoot.querySelector('button.create').click()
    await tick()
    const button = host.shadowRoot.querySelector('[data-offer=practice] button.open-course')
    assert.equal(button.disabled, false)
    dom.window.document.body.classList.add('lia-send-collect')
    button.click()
    await tick()
    assert.equal(opens, 0)
    assert.equal(host.report.phase, 'collect')
    assert.ok([...host.shadowRoot.querySelectorAll('button.open-course')]
      .every(control => control.disabled))
  } finally { dom.window.close() }
})

test('disconnect cancels a pending render and reconnect allows a fresh request', async () => {
  const dom = new JSDOM('<lia-mathpath-lernpfad></lia-mathpath-lernpfad>')
  try {
    let resolve
    let reads = 0
    registerLearningPathElement(dom.window.document, () => {
      reads++
      return reads === 1 ? new Promise(done => { resolve = done }) : Promise.resolve(report())
    })
    const host = dom.window.document.querySelector('lia-mathpath-lernpfad')
    host.shadowRoot.querySelector('button').click()
    host.remove()
    resolve(report())
    await tick()
    assert.equal(host.report, null)
    dom.window.document.body.append(host)
    assert.match(host.shadowRoot.querySelector('[role=status]').textContent, /abgebrochen/)
    host.shadowRoot.querySelector('button').click()
    await tick()
    assert.equal(reads, 2)
    assert.equal(host.report.topics.length, 2)
  } finally { dom.window.close() }
})

test('a failed refresh removes stale recommendations and supports retry', async () => {
  const dom = new JSDOM('<lia-mathpath-lernpfad></lia-mathpath-lernpfad>')
  try {
    let fail = false
    registerLearningPathElement(dom.window.document, async () => { if (fail) throw new Error('Quelle nicht erreichbar'); return report() })
    const host = dom.window.document.querySelector('lia-mathpath-lernpfad')
    host.shadowRoot.querySelector('button').click()
    await tick()
    fail = true
    host.shadowRoot.querySelector('button').click()
    await tick()
    assert.equal(host.report, null)
    assert.equal(host.shadowRoot.querySelectorAll('section').length, 0)
    assert.equal(host.shadowRoot.querySelector('button').disabled, false)
    assert.match(host.shadowRoot.querySelector('[role=status]').textContent, /Quelle nicht erreichbar/)
  } finally { dom.window.close() }
})
