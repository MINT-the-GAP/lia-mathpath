import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  findAssignmentDetailsForQuiz, freezeOwnsAssignmentDetails,
  installAssignmentDetails, parseAssignmentDetails, readAssignmentDetails
} from '../src/adetails.ts'

const ROOT = '[data-lia-mathpath-adetails="points"]'
const markerHtml = raw => '<lia-adetails class="lia-assignment-details" data-adetails="' + raw + '"></lia-adetails>'
const badge = marker => marker.shadowRoot?.querySelector(ROOT) || null
async function flush() {
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
  await Promise.resolve()
}
async function withDocument(body, callback, prepare = () => {}) {
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    runScripts: 'outside-only', url: 'https://example.test/course/'
  })
  const { window } = dom
  try {
    prepare(window)
    installAssignmentDetails(window.document)
    await flush()
    await callback(window.document, window)
    await flush()
  } finally {
    window.dispatchEvent(new window.Event('pagehide'))
    await flush()
    window.close()
  }
}

test('parses points, zero, decimals, partial values, keys and deduplicated tags', () => {
  const cases = [
    ['0=BE;Brüche,Einheiten', 0, [0], ['Brüche', 'Einheiten'], '0 BE'],
    ['2;Geometrie', 2, [2], ['Geometrie'], '2 BE'],
    ['1,5=BE;Bruchrechnung', 1.5, [1.5], ['Bruchrechnung'], '1.5 BE'],
    ['points=1|2,5;tags=Brüche,Einheiten,Brüche', 3.5, [1, 2.5], ['Brüche', 'Einheiten'], '3.5 BE'],
    ['punkt:2;tag:Algebra', 2, [2], ['Algebra'], '2 BE'],
    ['punkte=2.25;tags:Geometrie, Transfer', 2.25, [2.25], ['Geometrie', 'Transfer'], '2.25 BE'],
    ['be:4;points=99;Tags=Algebra', 4, [4], ['Algebra'], '4 BE'],
    ['1=BE;Brüche;Einheiten', 1, [1], ['Brüche', 'Einheiten'], '1 BE'],
    ['2;2026', 2, [2], ['2026'], '2 BE'],
    ['0=BE;0,1', 0, [0], ['0', '1'], '0 BE'],
    ['points=2;3;tag:4', 2, [2], ['3', '4'], '2 BE'],
    ['Bruchrechnung', null, [], ['Bruchrechnung'], ''],
    ['', null, [], [], ''],
    ['-2;Algebra', null, [], ['Algebra'], '']
  ]
  for (const [raw, pointsValue, pointsParts, tags, expectedBadge] of cases) {
    const parsed = parseAssignmentDetails(raw)
    assert.equal(parsed.pointsValue, pointsValue, raw)
    assert.deepEqual(parsed.pointsParts, pointsParts, raw)
    assert.deepEqual(parsed.tags, tags, raw)
    assert.equal(parsed.badge, expectedBadge, raw)
  }
})

test('prefers complete metadata to a partial legacy attribute', () => {
  const dom = new JSDOM('<lia-adetails data-adetails="1=BE;Brüche" data-adetails-all="1=BE;Brüche,Einheiten"></lia-adetails>')
  try {
    assert.deepEqual(readAssignmentDetails(dom.window.document.querySelector('lia-adetails')).tags, ['Brüche', 'Einheiten'])
  } finally { dom.window.close() }
})

test('bounds marker lookup by the next quiz and containing flex child', () => {
  const dom = new JSDOM('<main><div class="flex-child">' +
    '<div class="lia-quiz" id="a"></div><div class="lia-script">' + markerHtml('1;Algebra') + '</div>' +
    '<div class="lia-quiz" id="b"></div><div class="lia-quiz" id="c"></div>' +
    '<div>' + markerHtml('2;Geometrie') + '</div><div class="lia-quiz" id="d"></div></div>' +
    '<div class="flex-child">' + markerHtml('3;Other') + '</div></main>')
  try {
    const doc = dom.window.document
    const markers = doc.querySelectorAll('lia-adetails')
    assert.equal(findAssignmentDetailsForQuiz(doc.getElementById('a')), markers[0])
    assert.equal(findAssignmentDetailsForQuiz(doc.getElementById('b')), null)
    assert.equal(findAssignmentDetailsForQuiz(doc.getElementById('c')), markers[1])
    assert.equal(findAssignmentDetailsForQuiz(doc.getElementById('d')), null)
  } finally { dom.window.close() }
})

test('renders metadata without modifying any quiz or marker light-DOM children', async () => {
  await withDocument('<main><div class="lia-quiz"><input value="42"><div class="lia-quiz__control"><button>Check</button></div></div>' +
    markerHtml('0=BE;Algebra') + markerHtml('points=1|2,5;tags=Geometry') + '</main>', async doc => {
    const quiz = doc.querySelector('.lia-quiz')
    const children = [...quiz.childNodes]
    const input = quiz.querySelector('input')
    const button = quiz.querySelector('button')
    const markers = [...doc.querySelectorAll('lia-adetails')]
    const markerChildren = markers.map(marker => [...marker.childNodes])
    assert.deepEqual(markers.map(marker => badge(marker)?.textContent), ['0 BE', '3.5 BE'])
    markers[0].setAttribute('data-adetails', '2=BE;Algebra')
    await flush()
    assert.equal(badge(markers[0]).textContent, '2 BE')
    assert.deepEqual([...quiz.childNodes], children)
    assert.equal(quiz.querySelector('input'), input)
    assert.equal(quiz.querySelector('button'), button)
    markers.forEach((marker, index) => assert.deepEqual([...marker.childNodes], markerChildren[index]))
    assert.equal(doc.querySelector('.lia-course-frozen, .lia-submit-box, #lia-freeze-bar'), null)
  })
})

test('cleans detached hosts and renders replacement hosts once', async () => {
  await withDocument('<main>' + markerHtml('1;Algebra') + '</main>', async doc => {
    const initial = doc.querySelector('lia-adetails')
    const detachedBadge = badge(initial)
    const replacement = doc.createElement('lia-adetails')
    replacement.className = 'lia-assignment-details'
    replacement.setAttribute('data-adetails', '2;Geometrie')
    initial.replaceWith(replacement)
    await flush()
    assert.equal(detachedBadge.isConnected, false)
    assert.equal(badge(initial), null)
    assert.equal(initial.hasAttribute('data-lia-mathpath-adetails-owner'), false)
    assert.equal(badge(replacement)?.textContent, '2 BE')
    replacement.setAttribute('data-adetails', '3;Geometrie')
    await flush()
    assert.equal(replacement.shadowRoot.querySelectorAll(ROOT).length, 1)
    assert.equal(badge(replacement).textContent, '3 BE')
  })
})

for (const variant of ['modern', 'legacy']) {
  const activate = win => {
    if (variant === 'modern') win.__liaFreezeV2LifecycleV1__ = { bootScheduled: true }
    else win.__liaSubmissionDemo = { createLink() {} }
  }
  test('yields to ' + variant + ' Freeze already loaded', async () => {
    await withDocument(markerHtml('2;Algebra'), doc => {
      const marker = doc.querySelector('lia-adetails')
      assert.equal(freezeOwnsAssignmentDetails(doc), true)
      assert.equal(badge(marker), null)
      assert.equal(marker.hasAttribute('data-lia-mathpath-adetails-owner'), false)
    }, activate)
  })
  test('hands over to delayed ' + variant + ' Freeze while retaining its shadow tree', async () => {
    await withDocument(markerHtml('2;Algebra'), async (doc, win) => {
      const marker = doc.querySelector('lia-adetails')
      const ownBadge = badge(marker)
      assert.ok(ownBadge)
      const freezeRoot = doc.createElement('span')
      freezeRoot.setAttribute('data-lia-freeze-adetails-sidecar', '1')
      freezeRoot.textContent = 'Freeze points and correction'
      marker.shadowRoot.append(freezeRoot)
      marker.style.setProperty('display', 'inline-flex', 'important')
      activate(win)
      doc.dispatchEvent(new win.Event('load'))
      await flush()
      assert.equal(badge(marker), null)
      assert.equal(ownBadge.isConnected, false)
      assert.equal(freezeRoot.parentNode, marker.shadowRoot)
      assert.equal(freezeRoot.textContent, 'Freeze points and correction')
      assert.equal(marker.style.getPropertyValue('display'), 'inline-flex')
      assert.equal(marker.style.getPropertyPriority('display'), 'important')
      assert.equal(marker.hasAttribute('data-lia-mathpath-adetails-owner'), false)
    })
  })
}

test('does not take over an existing Freeze shadow sidecar before its runtime signal', async () => {
  await withDocument(markerHtml('2;Algebra'), doc => {
    const marker = doc.querySelector('lia-adetails')
    assert.equal(badge(marker), null)
    assert.equal(marker.shadowRoot.textContent, 'Freeze')
  }, win => {
    const marker = win.document.querySelector('lia-adetails')
    const root = win.document.createElement('span')
    root.setAttribute('data-lia-freeze-adetails-sidecar', '1')
    root.textContent = 'Freeze'
    marker.attachShadow({ mode: 'open' }).append(root)
  })
})

test('survives persisted pagehide and disposes on the later nonpersisted pagehide', async () => {
  await withDocument(markerHtml('1;Algebra').replace('<lia-adetails',
    '<lia-adetails style="display:none !important"'), async (doc, win) => {
    const marker = doc.querySelector('lia-adetails')
    assert.equal(badge(marker)?.textContent, '1 BE')
    win.dispatchEvent(new win.PageTransitionEvent('pagehide', { persisted: true }))
    marker.setAttribute('data-adetails', '2;Algebra')
    await flush()
    assert.equal(badge(marker)?.textContent, '2 BE')
    win.dispatchEvent(new win.PageTransitionEvent('pagehide', { persisted: false }))
    assert.equal(badge(marker), null)
    assert.equal(marker.style.getPropertyValue('display'), 'none')
    assert.equal(marker.style.getPropertyPriority('display'), 'important')
    assert.equal(marker.hasAttribute('data-lia-mathpath-adetails-owner'), false)
    marker.setAttribute('data-adetails', '3;Algebra')
    doc.dispatchEvent(new win.Event('load'))
    await flush()
    assert.equal(badge(marker), null)
  })
})

function escapeParameter(value) {
  const slash = String.fromCharCode(92)
  return [...String(value)].map(character => {
    if ([92, 34, 39, 96].includes(character.charCodeAt(0))) return slash + character
    if (character.charCodeAt(0) === 10) return slash + 'n'
    if (character.charCodeAt(0) === 9) return slash + 't'
    return character
  }).join('').replaceAll('$' + '{', slash + '$' + '{')
}
async function evaluateMacro(parameters) {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const macro = readme.match(/^@ADetails\r?\n<script[^>]*>([\s\S]*?)<\/script>\r?\n@end/m)
  assert.ok(macro, 'README defines ADetails')
  assert.doesNotMatch(macro[1], /@uid/, 'the script body must not rely on unexpanded nested uid macros')
  const expanded = macro[1].replace(/@('?)(\d+)/g, (match, quote, index) => {
    if (Number(index) >= parameters.length) return match
    return quote ? escapeParameter(parameters[Number(index)]) : parameters[Number(index)]
  })
  const dom = new JSDOM('', { runScripts: 'outside-only' })
  const messages = []
  try {
    new dom.window.Function('send', expanded)({ lia: message => messages.push(message) })
    const output = messages.find(message => message.startsWith('HTML: '))
    assert.ok(output)
    dom.window.document.body.innerHTML = output.slice(6)
    const marker = dom.window.document.querySelector('lia-adetails')
    return {
      raw: marker?.getAttribute('data-adetails') ?? null,
      instance: marker?.getAttribute('data-adetails-instance') ?? null,
      alert: dom.window.document.querySelector('[role="alert"]')?.textContent ?? null,
      elements: [...dom.window.document.body.children].map(element => element.tagName)
    }
  } finally { dom.window.close() }
}

test('macro preserves positional comma tags and removes exact unused placeholders', async () => {
  const output = await evaluateMacro(['1=BE;Bruchrechnung', 'Einheiten', 'Transfer'])
  assert.equal(output.raw, '1=BE;Bruchrechnung,Einheiten,Transfer')
  assert.match(output.instance, /^lia-adetails-[0-9a-f]{1,8}(?:-[0-9a-f]{1,8}){3}$/)
  const repeated = await evaluateMacro(['1=BE;Bruchrechnung', 'Einheiten', 'Transfer'])
  assert.notEqual(repeated.instance, output.instance)
  assert.equal(output.alert, null)
  assert.equal((await evaluateMacro([])).raw, '')
})

test('macro serializes quoted metadata and markup characters safely', async () => {
  const raw = 'points=1|2,5;tags=Brüche,Einheiten,"A & B",O\'Brien,<b>Transfer</b>'
  const output = await evaluateMacro([raw])
  assert.equal(output.raw, raw)
  assert.deepEqual(output.elements, ['LIA-ADETAILS'])
  assert.equal(output.alert, null)
})

test('macro reports argument overflow and accepts unlimited tags inside one backtick argument', async () => {
  const allowed = ['1=BE;Start', ...Array.from({ length: 31 }, (_, index) => 'Tag' + index)]
  const output = await evaluateMacro(allowed)
  assert.equal(output.raw, allowed.join(','))
  assert.equal(output.alert, null)
  const tooMany = await evaluateMacro([...allowed, 'Overflow'])
  assert.equal(tooMany.raw, null)
  assert.match(tooMany.alert, /Backticks/)
  const complete = [...allowed, 'Overflow'].join(',')
  assert.equal((await evaluateMacro([complete])).raw, complete)
})
