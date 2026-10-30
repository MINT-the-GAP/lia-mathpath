#!/usr/bin/env node

// Real interpreter regression using local template overrides; nothing is published.
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundleFilenameForVersion } from './version-bundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mathPathBundleFilename = bundleFilenameForVersion(
  JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
)
const freezeRoot = process.env.MATHPATH_FREEZE_ROOT || path.resolve(root, '../Freeze/lia-freeze-v2')
const resetterRoot = process.env.MATHPATH_RESETTER_ROOT || path.resolve(root, '../Resetter')
const base = 'https://raw.githubusercontent.com/MINT-the-GAP/'
const mathPathUrl = `${base}lia-mathpath/master/README.md`
const freezeUrl = `${base}lia-freeze-v2/main/README.md`
const resetterUrl = `${base}lia-resetter/main/README.md`
const viewer = process.env.MATHPATH_VIEWER_URL || 'https://liascript.github.io/course/'
const timeout = Number(process.env.MATHPATH_BROWSER_TIMEOUT || 60_000)
const selected = process.argv.find(value => value.startsWith('--scenario='))?.split('=')[1]
const sendWithHints = process.argv.includes('--send-with-hints')
const scenarios = ['standalone', 'freeze-first', 'mathpath-first', 'freeze-delayed', 'freeze-send'].filter(name => !selected || name === selected)
assert.ok(scenarios.length, `Unknown scenario: ${selected}`)

async function loadPlaywright() {
  for (const filename of [path.join(root, 'package.json'), path.join(freezeRoot, 'package.json')]) {
    try { return createRequire(filename)('@playwright/test') } catch { /* try adjacent checkout */ }
  }
  throw new Error('Install @playwright/test, or set MATHPATH_FREEZE_ROOT to a checkout containing it.')
}

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* continue */ }
  }
  return undefined
}

function courseSource(name) {
  const imports = name === 'standalone' ? [mathPathUrl, resetterUrl]
    : name === 'freeze-first' ? [freezeUrl, mathPathUrl, resetterUrl] : [mathPathUrl, freezeUrl, resetterUrl]
  return [
    '<!--', 'author: MINT-the-GAP', 'version: 1.0.0', 'language: de', 'mode: Presentation',
    ...imports.map(url => `import: ${url}`), '-->', '', '# ADetails Browser Regression', '', '@Explain(Tutorial)', '',
    '## Mehrere Aufgaben', '', 'Erstes Ergebnis: [[ alpha ]]', '[[?]] @Explain', '',
    '@ADetails(2=BE;Bruchrechnung, Einheiten)', '', 'Zweites Ergebnis: [[ beta ]]', '[[?]] @Explain', '',
    '@ADetails(`points=1|2;tags=Einheiten, Bruchrechnung`)', '',
    'Unbewertetes Ergebnis: [[ zero ]]', '', '@ADetails(0=BE;Einheiten)', '',
    'Dezimalpunkte: [[ decimal ]]', '', '@ADetails(`points=1,5;tags=Bruchrechnung, Einheiten`)', '',
    '## Einzelreset', '', 'Reset-Ergebnis: [[ gamma ]]', '[[?]] @Explain', '',
    '@resetter', '', '@ADetails(1=BE;Einheiten, Bruchrechnung)', '',
    '## Abschluss', '', ...(name === 'standalone' ? ['Fertig.'] : ['@Abgabe', '', name === 'freeze-send' ? '@Auswertung(Send)' : '@Auswertung']), ''
  ].join('\n')
}

async function routeResources(page, name, served) {
  const courseUrl = `${base}lia-mathpath/master/test/fixtures/adetails-${name}.md`
  const resources = new Map([[courseUrl, { body: courseSource(name), contentType: 'text/markdown; charset=utf-8' }]])
  const definitions = [
    [mathPathUrl, path.join(root, 'README.md')],
    [`${base}lia-mathpath/master/dist/${mathPathBundleFilename}`,
      path.join(root, 'dist', mathPathBundleFilename)],
    [`${base}lia-mathpath/master/Explain.md`, path.join(root, 'Explain.md')],
    [`${base}lia-mathpath/master/Glossar.md`, path.join(root, 'Glossar.md')],
    [resetterUrl, path.join(resetterRoot, 'README.md')],
    [`${base}lia-resetter/main/dist/index.js`, path.join(resetterRoot, 'dist/index.js')]
  ]
  if (name !== 'standalone') definitions.push([freezeUrl, path.join(freezeRoot, 'README.md')],
    [`${base}lia-freeze-v2/main/dist/index.js`, path.join(freezeRoot, 'dist/index.js')])
  for (const [url, filename] of definitions) resources.set(url, {
    body: await readFile(filename),
    contentType: filename.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/markdown; charset=utf-8'
  })
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    url.search = ''
    const resource = resources.get(url.toString())
    if (!resource) return route.continue()
    served[url.toString()] = (served[url.toString()] || 0) + 1
    // Hold back the runtime, not just its network response: LiaScript waits for
    // external scripts before rendering. It must first render standalone hosts.
    const heldFreeze = name === 'freeze-delayed' && /lia-freeze-v2\/main\/dist\/index\.js$/.test(url.pathname)
    await route.fulfill({ status: request.method() === 'OPTIONS' ? 204 : 200,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'cache-control': 'no-store' },
      contentType: resource.contentType, body: request.method() === 'OPTIONS' || heldFreeze ? '' : resource.body })
  })
  return courseUrl
}

async function snapshot(page) {
  return page.evaluate(() => {
    const deep = (root, selector) => {
      const result = [...root.querySelectorAll(selector)]
      for (const node of root.querySelectorAll('*')) if (node.shadowRoot) result.push(...deep(node.shadowRoot, selector))
      return result
    }
    const badges = deep(document, '.lia-adetails-points,.lia-mathpath-adetails-points,[data-lia-mathpath-adetails-points]')
      .filter(node => !node.hidden && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
    return {
      hash: location.hash, quizzes: document.querySelectorAll('.lia-quiz').length,
      markers: [...document.querySelectorAll('.lia-assignment-details')].map(marker => ({
        tag: marker.localName, raw: marker.getAttribute('data-adetails'), all: marker.getAttribute('data-adetails-all'),
        instance: marker.getAttribute('data-adetails-instance'),
        tags: marker.getAttribute('data-adetail-tags'),
        mathpathOwner: marker.getAttribute('data-lia-mathpath-adetails-owner'),
        standaloneBadges: marker.shadowRoot?.querySelectorAll('.lia-mathpath-adetails-points').length || 0,
        freezeBadges: marker.shadowRoot?.querySelectorAll('.lia-adetails-points').length || 0
      })),
      badges: badges.map(node => {
        const style = getComputedStyle(node)
        return { text: node.textContent.trim(), html: node.outerHTML, style: {
          display: style.display, fontWeight: style.fontWeight, opacity: style.opacity,
          borderTopWidth: style.borderTopWidth, borderRadius: style.borderRadius,
          paddingLeft: style.paddingLeft, paddingRight: style.paddingRight
        } }
      }),
      explain: [...document.querySelectorAll('lia-mathpath-explain')].map(host =>
        [...(host.shadowRoot?.querySelectorAll('.lia-mathpath-explain-link') || [])].map(link => link.textContent.trim())),
      frozen: document.body.classList.contains('lia-course-frozen'),
      inputs: [...document.querySelectorAll('input.lia-quiz__input')].map(node => node.outerHTML),
      freezeBar: Boolean(document.querySelector('#lia-freeze-bar')),
      controls: [...document.querySelectorAll('.lia-quiz__control button')].map(node => ({
        class: node.className, title: node.title, text: node.textContent, html: node.outerHTML
      }))
    }
  })
}

async function waitForSnapshot(page, predicate, label) {
  const deadline = Date.now() + timeout
  let value
  while (Date.now() < deadline) {
    value = await snapshot(page)
    if (predicate(value)) return value
    await page.waitForTimeout(100)
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`)
}

async function navigate(page, slide) {
  await page.evaluate(value => { location.hash = `#${value}` }, slide)
  await page.waitForFunction(value => location.hash === `#${value}`, slide)
}

async function freezeRoundTrip(browser, page, name, result, expect) {
  await navigate(page, 4)
  await page.locator('#lia-name').fill('ADetails Regression')
  await page.locator('#lia-create-link').click()
  await expect(page.locator('#lia-link')).not.toHaveValue('')
  if (name === 'freeze-send') {
    await expect(page.locator('body')).toHaveClass(/lia-send-review/)
    await expect(page.locator('#lia-send-grading-overlay')).toHaveCount(0)
  }
  const link = await page.locator('#lia-link').inputValue()
  const sourceUrl = new URL(decodeURIComponent(new URL(link).search.slice(1)))
  const token = decodeURIComponent(sourceUrl.hash.slice('#submission='.length))
  assert.match(token, /^gz:/)
  const payload = JSON.parse(gunzipSync(Buffer.from(token.slice(3), 'base64url')).toString('utf8'))
  const quizElements = new Map()
  for (const slide of payload.s) for (const state of [slide.quiz, slide.quizEval]) {
    for (const [section, tasks] of Object.entries(state || {})) {
      if (Number(section) !== 1) continue
      tasks.forEach((task, index) => quizElements.set(index, task))
    }
  }
  const firstCorrect = quizElements.get(0)?.solved === 1
  const declared = payload.ev.declarations['#2'].tl
  const notMade = declared.slice(1).filter((task, offset) => {
    const state = quizElements.get(offset + 1)
    return !state || (Number(state.solved) === 0 && !Number(state.trial))
  }).length
  result.submission = { firstCorrect, notMade, tasks: [...quizElements], nativeDom: payload.nativeDom, tags: declared.map(task => task.tg), sendChecks: payload.sendChecks }
  if (name === 'freeze-send') assert.ok(firstCorrect, 'Send grading preserves the recorded answer')
  const reviewContext = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const review = await reviewContext.newPage()
    review.setDefaultTimeout(timeout)
    review.on('pageerror', error => result.errors.push(String(error)))
    await routeResources(review, name, result.served)
    await review.goto(link, { waitUntil: 'domcontentloaded', timeout })
    await expect(review.locator('body')).toHaveClass(/lia-shared-freeze-link/)
    if (name === 'freeze-send') await expect(review.locator('body')).toHaveClass(/lia-send-review/)
    await navigate(review, 2)
    await waitForSnapshot(review, value => value.quizzes === 4 && value.badges.length === 4, 'Reopened Freeze link')
    await expect(review.locator('input.lia-quiz__input').nth(0)).toHaveValue('alpha')
    await expect(review.locator('input.lia-quiz__input').nth(0)).toHaveAttribute('readonly')
    const award = review.locator('lia-adetails .lia-adetails-award-input').nth(0)
    await expect(award).toBeVisible()
    await award.fill('1')
    await award.dispatchEvent('change')
    await expect(award).toHaveValue('1')
    return { restoredAnswer: 'alpha', manualAward: '1', firstCorrect, notMade,
      tags: declared.map(task => task.tg), sendChecks: payload.sendChecks }
  } finally { await reviewContext.close() }
}

async function runScenario(browser, name, expect) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(timeout)
  const result = { name, ok: false, served: {}, checks: [], errors: [], consoleErrors: [] }
  page.on('pageerror', error => result.errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()) })
  const check = (label, condition, details) => {
    result.checks.push({ label, ok: Boolean(condition), details })
    assert.ok(condition, label)
  }
  try {
    const courseUrl = await routeResources(page, name, result.served)
    await page.goto(`${viewer}?${courseUrl}#2`, { waitUntil: 'domcontentloaded', timeout })
    let state = await waitForSnapshot(page, value => value.quizzes === 4 && value.badges.length >= 4, 'Initial ADetails rendering')
    result.initial = state
    check('One badge per quiz, with zero, summed and decimal points', state.badges.length === 4 &&
      JSON.stringify(state.badges.map(badge => badge.text)) === JSON.stringify(['2 BE', '3 BE', '0 BE', '1.5 BE']), state.badges)
    if (name === 'standalone' || name === 'freeze-delayed') check('Standalone points use Freeze typography without a pill',
      state.badges.every(badge => badge.style.display === 'inline-flex' && badge.style.fontWeight === '700' &&
        badge.style.opacity === '0.92' && badge.style.borderTopWidth === '0px' &&
        badge.style.borderRadius === '0px' && badge.style.paddingLeft === '0px' &&
        badge.style.paddingRight === '0px'), state.badges)
    check('All ordinary comma-separated and backtick tags survive macro expansion',
      state.markers[0]?.raw === '2=BE;Bruchrechnung, Einheiten' &&
      state.markers[1]?.raw === 'points=1|2;tags=Einheiten, Bruchrechnung', state.markers)
    check('No unintended frozen state', !state.frozen)
    if (name === 'standalone') check('Standalone does not load Freeze', !state.freezeBar &&
      !Object.keys(result.served).some(url => url.includes('/lia-freeze-v2/')))
    if (name === 'freeze-delayed') {
      check('Before delayed initialization all four badges belong to MathPath',
        state.markers.every(marker => marker.standaloneBadges === 1 && marker.freezeBadges === 0), state.markers)
      await page.locator('input.lia-quiz__input').first().fill('draft')
      await page.addScriptTag({ content: await readFile(path.join(freezeRoot, 'dist/index.js'), 'utf8') })
      state = await waitForSnapshot(page, value => value.badges.length === 4 &&
        value.markers.every(marker => marker.freezeBadges === 1 && marker.standaloneBadges === 0), 'Actual delayed Freeze takeover')
      await expect(page.locator('input.lia-quiz__input').first()).toHaveValue('draft')
      check('Freeze takes over already rendered MathPath hosts without duplicating badges or losing input', true, state.markers)
    }
    check('Markers use unique non-placeholder instance tokens',
      state.markers.every(marker => marker.instance && !marker.instance.includes('@')) &&
      new Set(state.markers.map(marker => marker.instance)).size === 4, state.markers.map(marker => marker.instance))

    const first = page.locator('.lia-quiz').nth(0)
    // Opened Explain hints expose a pre-existing Send restoration failure in
    // both unchanged repositories. Keep it reproducible without conflating
    // that case with the regular Send/ADetails interoperability regression.
    if (name !== 'freeze-send' || sendWithHints) {
    await first.locator('.lia-quiz__hint').click()
    await page.locator('.lia-quiz').nth(1).locator('.lia-quiz__hint').click()
    state = await waitForSnapshot(page, value => value.explain.length === 2 && value.explain.every(tags => tags.length === 2), 'Opened native hints')
    check('Each native hint reads all topics from its own ADetails marker', JSON.stringify(state.explain) ===
      JSON.stringify([['Bruchrechnung', 'Einheiten'], ['Einheiten', 'Bruchrechnung']]), state.explain)
    }
    const firstInput = page.locator('input.lia-quiz__input').nth(0)
    if (name === 'freeze-send') {
      await expect(page.locator('body')).toHaveClass(/lia-send-collect/)
      await firstInput.fill('alpha')
      await first.locator('.lia-quiz__check').click()
      await expect(page.locator('lia-adetails .lia-send-status').first()).toContainText('Antwort gespeichert')
      await expect(firstInput).toHaveValue('alpha')
      await expect(firstInput).toBeEditable()
      await expect(first.locator('.text-success,.is-success')).toHaveCount(0)
      check('Send keeps live checking neutral and the input editable', true)
      const review = await freezeRoundTrip(browser, page, name, result, expect)
      check('Send grades the submitted task correctly and keeps three untouched tasks unmade',
        review.firstCorrect && review.notMade === 3, review)
      check('Frozen metadata preserves all ADetails tags in Send mode',
        JSON.stringify(review.tags.slice(0, 2)) === JSON.stringify([['Bruchrechnung', 'Einheiten'], ['Einheiten', 'Bruchrechnung']]), review.tags)
    } else {
    await firstInput.fill('wrong')
    await first.locator('.lia-quiz__check').click()
    await expect(firstInput).toHaveValue('wrong')
    await firstInput.fill('alpha')
    await first.locator('.lia-quiz__check').click()
    await expect(firstInput).toBeDisabled()
    await expect(first.locator('.text-success,.is-success').first()).toBeVisible()
    check('Native wrong-then-correct checking works', true)

    await navigate(page, 3)
    await waitForSnapshot(page, value => value.quizzes === 1 && value.badges.length === 1, 'Reset slide')
    await page.locator('input.lia-quiz__input').fill('gamma')
    await page.locator('.lia-quiz__check').click()
    await expect(page.locator('input.lia-quiz__input')).toBeDisabled()
    const reset = page.locator('lia-resetter-host input[type=button]')
    await expect(reset).toBeVisible()
    await reset.click()
    await expect(page.locator('input.lia-quiz__input')).toHaveValue('')
    await page.locator('input.lia-quiz__input').fill('gamma')
    await page.locator('.lia-quiz__check').click()
    await expect(page.locator('input.lia-quiz__input')).toBeDisabled()
    check('Reset and subsequent checking preserve ADetails and Elm DOM', true)
    for (let cycle = 0; cycle < 2; cycle++) {
      await navigate(page, 2)
      state = await waitForSnapshot(page, value => value.quizzes === 4 && value.badges.length === 4, 'Return to multiple quizzes')
      await navigate(page, 3)
      await waitForSnapshot(page, value => value.quizzes === 1 && value.badges.length === 1, 'Repeated reset slide')
    }
    check('Slide changes and rerendering do not duplicate badges', true)
    if (name === 'mathpath-first') {
      const review = await freezeRoundTrip(browser, page, name, result, expect)
      check('Freeze link reopens independently and teacher correction remains available', true, review)
    }
    }
    check('No uncaught JavaScript or Elm ownership error', result.errors.length === 0, result.errors)
    check('No created_by_elm error logged', !result.consoleErrors.some(value => /created_by_elm|virtualdom|virtual-dom/i.test(value)), result.consoleErrors)
    result.ok = true
  } catch (error) {
    result.failure = { message: error.message, stack: error.stack }
    try { result.final = await snapshot(page) } catch { /* page may have crashed */ }
  } finally { await context.close() }
  return result
}

const { chromium, expect } = await loadPlaywright()
const configuredExpect = expect.configure({ timeout })
const executablePath = await chromePath()
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const report = { ok: false, interpreter: viewer, browser: browser.version(), scenarios: [] }
try {
  for (const name of scenarios) {
    const result = await runScenario(browser, name, configuredExpect)
    report.scenarios.push(result)
    process.stderr.write(`${name}: ${result.ok ? 'PASS' : result.failure.message}\n`)
  }
  report.ok = report.scenarios.every(result => result.ok)
} finally { await browser.close() }
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exitCode = report.ok ? 0 : 1
