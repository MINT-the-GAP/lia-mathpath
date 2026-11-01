import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  installRuntimeLearningState,
  readRuntimeLearningState,
} from '../src/lernpfad-runtime-state.js'

test('tracks live outcomes and native trial labels without persistent storage', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <main><div class="lia-quiz failed">
      <button class="lia-quiz__check">Prüfen 12</button>
    </div></main>
  </body>`, { url: 'https://liascript.github.io/course/?course#2' })
  let storageAccesses = 0
  Object.defineProperty(dom.window, 'indexedDB', {
    configurable: true,
    get() { storageAccesses++; throw new Error('must not be accessed') },
  })
  installRuntimeLearningState(dom.window)
  let state = readRuntimeLearningState(dom.window)
  assert.deepEqual(state.slides['#2'], [{
    taskIndex: 0, nativeIndex: 0, table: 'quiz', outcome: 'wrong', trial: 12,
  }])

  const quiz = dom.window.document.querySelector('.lia-quiz')
  quiz.className = 'lia-quiz solved'
  quiz.querySelector('.lia-quiz__check').textContent = 'Prüfen 13'
  state = readRuntimeLearningState(dom.window)
  assert.equal(state.slides['#2'][0].outcome, 'correct')
  assert.equal(state.slides['#2'][0].trial, 13)

  quiz.className = 'lia-quiz open'
  quiz.querySelector('.lia-quiz__check').textContent = 'Prüfen'
  state = readRuntimeLearningState(dom.window)
  assert.equal(state.slides['#2'][0].outcome, 'open')
  assert.equal(state.slides['#2'][0].trial, 0)
  assert.equal(storageAccesses, 0)
  dom.window.close()
})
