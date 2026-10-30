#!/usr/bin/env node

// Real LiaScript + local MathPath/Freeze/Resetter resources; no publication.
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const freezeRoot = process.env.MATHPATH_FREEZE_ROOT || path.resolve(root, '../Freeze/lia-freeze-v2')
const resetterRoot = process.env.MATHPATH_RESETTER_ROOT || path.resolve(root, '../Resetter')
const base = 'https://raw.githubusercontent.com/MINT-the-GAP/'
const mathPathUrl = base + 'lia-mathpath/master/README.md'
const freezeUrl = base + 'lia-freeze-v2/main/README.md'
const resetterUrl = base + 'lia-resetter/main/README.md'
const viewer = process.env.MATHPATH_VIEWER_URL || 'https://liascript.github.io/course/'
const timeout = Number(process.env.MATHPATH_BROWSER_TIMEOUT || 60_000)
const selected = process.argv.find(value => value.startsWith('--scenario='))?.slice(11)
const scenarios = ['standalone', 'freeze-first', 'mathpath-first', 'freeze-delayed', 'freeze-send'].filter(name => !selected || name === selected)
const buttonText = 'Empfehlungen für deinen weiteren Lernpfad erstellen'
const hostSelector = 'lia-mathpath-lernpfad'
assert.ok(scenarios.length, 'Unknown scenario: ' + selected)

const { chromium, expect: baseExpect } = createRequire(path.join(root, 'package.json'))('@playwright/test')
const expect = baseExpect.configure({ timeout })

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* try next */ }
  }
}

function courseSource(name) {
  const imports = name === 'standalone' ? [mathPathUrl, resetterUrl]
    : name === 'freeze-first' ? [freezeUrl, mathPathUrl, resetterUrl] : [mathPathUrl, freezeUrl, resetterUrl]
  return [
    '<!--', 'author: MINT-the-GAP', 'version: 2.3.4', 'language: de', 'mode: Presentation',
    'lernpfad-level: Einsteiger', ...imports.map(url => 'import: ' + url), '-->', '',
    '# Lernpfad Browser Regression', '', '@Explain(Tutorial)', '',
    '## Mehrere Aufgaben', '', 'Erstes Ergebnis: [[ alpha ]]', '[[?]] @Explain', '',
    '@ADetails(2=BE;Bruchrechnung, Einheiten)', '',
    'Zweites Ergebnis: [[ beta ]]', '[[?]] @Explain', '',
    '@ADetails(`points=1|2;tags=Einheiten, Bruchrechnung`)', '',
    'Unbewertetes Ergebnis: [[ zero ]]', '', '@ADetails(0=BE;Reflexion)', '',
    'Dezimalpunkte: [[ decimal ]]', '', '@ADetails(`points=1,5;tags=Bruchrechnung, Einheiten`)', '',
    '@Lernpfad', '',
    '## Einzelreset', '', '<!-- lernpfad-level: Fortgeschritten -->', '',
    'Reset-Ergebnis: [[ gamma ]]', '[[?]] @Explain', '', '@resetter', '',
    '@ADetails(1=BE;Einheiten, Bruchrechnung)', '',
    '## Unbesuchte Aufgabe', '', '<!-- lernpfad-level: Experte -->', '',
    'Dieses Ergebnis bleibt offen: [[ delta ]]', '', '@ADetails(2=BE;Transfer)', '',
    '## Empfehlungen', '', '@Lernpfad', '', '@Lernpfad', '',
    ...(name === 'standalone' ? [] : ['## Abgabe', '', '@Abgabe', '', name === 'freeze-send' ? '@Auswertung(Send)' : '@Auswertung']), ''
  ].join('\n')
}

async function routeResources(page, name, served, holdFreeze = name === 'freeze-delayed') {
  const courseUrl = base + 'lia-mathpath/master/test/fixtures/lernpfad-' + name + '.md'
  const resources = new Map([[courseUrl, { body: courseSource(name), contentType: 'text/markdown; charset=utf-8' }]])
  const definitions = [
    [mathPathUrl, path.join(root, 'README.md')],
    [base + 'lia-mathpath/master/dist/index.js', path.join(root, 'dist/index.js')],
    [base + 'lia-mathpath/master/Explain.md', path.join(root, 'Explain.md')],
    [base + 'lia-mathpath/master/Glossar.md', path.join(root, 'Glossar.md')],
    [resetterUrl, path.join(resetterRoot, 'README.md')],
    [base + 'lia-resetter/main/dist/index.js', path.join(resetterRoot, 'dist/index.js')]
  ]
  if (name !== 'standalone') definitions.push([freezeUrl, path.join(freezeRoot, 'README.md')],
    [base + 'lia-freeze-v2/main/dist/index.js', path.join(freezeRoot, 'dist/index.js')])
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
    const withheld = holdFreeze && /lia-freeze-v2\/main\/dist\/index\.js$/.test(url.pathname)
    await route.fulfill({ status: request.method() === 'OPTIONS' ? 204 : 200,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'cache-control': 'no-store' },
      contentType: resource.contentType,
      body: request.method() === 'OPTIONS' || withheld ? '' : resource.body })
  })
  return courseUrl
}

async function navigate(page, slide, quizzes, hosts) {
  await page.evaluate(value => { location.hash = '#' + value }, slide)
  await expect(page.locator('.lia-quiz')).toHaveCount(quizzes)
  await expect(page.locator(hostSelector)).toHaveCount(hosts)
}

async function recommend(page, hostIndex = 0) {
  const host = page.locator(hostSelector).nth(hostIndex)
  const button = host.getByRole('button', { name: buttonText, exact: true })
  await expect(button).toBeVisible()
  await button.click()
  await expect(button).toBeEnabled()
  const report = await host.evaluate(element => element.report)
  if (!report) throw new Error('Lernpfad returned no report: ' + await host.locator('.summary').textContent())
  assert.ok(report && Array.isArray(report.recommendations), 'Host exposes its structured report')
  return report
}

function topic(report, name) {
  const value = report.topics.find(item => item.topic === name)
  assert.ok(value, 'Missing topic: ' + name)
  return value
}

function totalTasks(report) { return Object.values(report.statusCounts).reduce((sum, count) => sum + count, 0) }

function contrastRatio(foreground, background) {
  const channels = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
  const luminance = value => {
    const [red, green, blue] = channels(value).map(channel => {
      const normalized = channel / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

async function quizRecords(page, courseUrl) {
  return page.evaluate(async name => {
    const names = await indexedDB.databases()
    if (!names.some(entry => entry.name === name)) return null
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Unexpected new database')) }
    })
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('quiz', 'readonly').objectStore('quiz').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  }, courseUrl)
}

async function verifyUi(page, report) {
  const host = page.locator(hostSelector).first()
  await expect(host.locator('section[data-offer]')).toHaveCount(3)
  await expect(host.locator('select')).toHaveCount(3)
  await expect(host.locator('button')).toHaveCount(4)
  await expect(host.locator('button.open-course')).toHaveCount(3)
  assert.deepEqual(report.recommendations.map(value => value.taskCount), [4, 4, 4])
  const practice = report.recommendations.find(value => value.type === 'practice')
  const deeper = report.recommendations.find(value => value.type === 'deepen')
  assert.equal(practice.targetLevel, 'Einsteiger')
  assert.equal(deeper.targetLevel, 'Fortgeschritten')
  if (report.phase === 'collect' || report.phase === 'grading') {
    await expect(host.locator('.summary-message')).toHaveCount(1)
    await expect(host.locator('.summary-item')).toHaveCount(0)
  } else {
    await expect(host.locator('.summary-item')).toHaveCount(5)
  }
  const desktop = await host.evaluate(element => {
    const root = element.shadowRoot
    const create = root.querySelector('button.create')
    const offers = root.querySelector('.offers')
    const warning = root.querySelector('.warnings')
    const styles = getComputedStyle(create)
    return {
      fontSize: styles.fontSize,
      buttonHeight: create.getBoundingClientRect().height,
      buttonWidth: create.getBoundingClientRect().width,
      hostWidth: element.getBoundingClientRect().width,
      columns: getComputedStyle(offers).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      warningBeforeOffers: !!(warning.compareDocumentPosition(offers) & Node.DOCUMENT_POSITION_FOLLOWING)
    }
  })
  assert.equal(desktop.fontSize, '16px')
  assert.ok(desktop.buttonHeight >= 40 && desktop.buttonHeight <= 56, JSON.stringify(desktop))
  assert.ok(desktop.buttonWidth < desktop.hostWidth, JSON.stringify(desktop))
  assert.equal(desktop.columns, 3)
  assert.equal(desktop.warningBeforeOffers, true)

  const dark = await host.evaluate(element => {
    const root = element.shadowRoot
    const properties = {
      '--lia-mathpath-accent-rgb': '84, 196, 198',
      '--lia-mathpath-accent-contrast-rgb': '0, 0, 0',
      '--lia-mathpath-surface-rgb': '18, 28, 30',
      '--lia-mathpath-text-rgb': '230, 239, 240'
    }
    for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value)
    const select = root.querySelector('select')
    const create = root.querySelector('button.create')
    const result = {
      selectColor: getComputedStyle(select).color,
      selectBackground: getComputedStyle(select).backgroundColor,
      buttonColor: getComputedStyle(create).color,
      buttonBackground: getComputedStyle(create).backgroundColor
    }
    for (const name of Object.keys(properties)) element.style.removeProperty(name)
    return result
  })
  assert.ok(contrastRatio(dark.selectColor, dark.selectBackground) >= 4.5, JSON.stringify(dark))
  assert.ok(contrastRatio(dark.buttonColor, dark.buttonBackground) >= 4.5, JSON.stringify(dark))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const mobile = await host.evaluate(element => {
    const root = element.shadowRoot
    const create = root.querySelector('button.create')
    return {
      columns: getComputedStyle(root.querySelector('.offers')).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      buttonWidth: create.getBoundingClientRect().width,
      hostWidth: element.getBoundingClientRect().width
    }
  })
  assert.equal(mobile.columns, 1)
  assert.ok(Math.abs(mobile.buttonWidth - mobile.hostWidth) <= 2, JSON.stringify(mobile))
  await page.setViewportSize({ width: 1360, height: 960 })
  await host.locator('section[data-offer="deepen"] select').selectOption({ label: 'Transfer' })
  await expect(host.locator('section[data-offer="deepen"] .reason')).toContainText(/höher|höchste|Experte/i)
  assert.equal((await host.evaluate(element => element.report)).recommendations.find(value => value.type === 'deepen').available, false)
}

async function createAndReview(browser, page, name, result, check) {
  await navigate(page, 6, 0, 0)
  await page.locator('#lia-name').fill('Lernpfad Regression')
  await page.locator('#lia-create-link').click()
  await expect(page.locator('#lia-link')).not.toHaveValue('')
  if (name === 'freeze-send') await expect(page.locator('body')).toHaveClass(/lia-send-review/)
  const link = await page.locator('#lia-link').inputValue()
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const review = await context.newPage()
    review.setDefaultTimeout(timeout)
    review.on('pageerror', error => result.errors.push(String(error)))
    await routeResources(review, name, result.served, false)
    await review.goto(link, { waitUntil: 'domcontentloaded', timeout })
    await expect(review.locator('body')).toHaveClass(/lia-shared-freeze-link/)
    await navigate(review, 5, 0, 2)
    let report = await recommend(review)
    assert.equal(report.phase, 'review')
    assert.ok(report.statusCounts.correct >= 1, 'Reviewed snapshot retains the correct answer')
    check('Independent Freeze link restores course-wide recommendation state', report)
    await navigate(review, 2, 4, 1)
    await expect(review.locator('input.lia-quiz__input').first()).toHaveValue('alpha')
    const award = review.locator('lia-adetails .lia-adetails-award-input').first()
    await expect(award).toBeVisible()
    await award.fill('1')
    await award.dispatchEvent('change')
    // Leave Freeze's own evaluation layer through its public navigation bar.
    await review.locator('#lia-freeze-first').click()
    await navigate(review, 5, 0, 2)
    // In Send review, Freeze can asynchronously raise its evaluation overlay
    // after correction. The initial recommendation button was checked above;
    // read the same public API here to isolate the cross-slide state adapter.
    report = name === 'freeze-send'
      ? await review.evaluate(() => window.__LIA_MATHPATH__.getLearningRecommendations())
      : await recommend(review)
    assert.ok(report.statusCounts.partial >= 1, 'Teacher correction of 1/2 points is partial')
    check(name === 'freeze-send'
      ? 'Manual Send correction is readable from another slide through the public read-only API'
      : 'Manual correction remains readable from another slide', report)
  } finally { await context.close() }
}

async function runScenario(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(timeout)
  const result = { name, ok: false, served: {}, checks: [], errors: [], consoleErrors: [] }
  const check = (label, details) => result.checks.push({ label, ok: true, details })
  page.on('pageerror', error => result.errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()) })
  try {
    const courseUrl = await routeResources(page, name, result.served)
    await page.goto(viewer + '?' + courseUrl + '#5', { waitUntil: 'domcontentloaded', timeout })
    await expect(page.locator(hostSelector)).toHaveCount(2)
    const recordsBefore = await quizRecords(page, courseUrl)
    let report = await recommend(page)
    assert.equal(totalTasks(report), 6)
    if (name === 'freeze-send') {
      assert.equal(report.statusCounts.unanswered, 0)
      assert.equal(report.statusCounts.unavailable, 6, 'Send collection withholds all task outcomes')
    } else {
      assert.equal(report.statusCounts.unanswered, 6, 'Missing compatible records count as not yet completed')
    }
    assert.equal(report.statusCounts.wrong, 0)
    assert.equal(topic(report, 'Bruchrechnung').taskCount, 4)
    assert.equal(topic(report, 'Einheiten').taskCount, 4)
    assert.equal(topic(report, 'Transfer').unavailableCount, name === 'freeze-send' ? 1 : 0)
    assert.deepEqual((await quizRecords(page, courseUrl)) || [], recordsBefore || [], 'Recommendation button never writes quiz state')
    await verifyUi(page, report)
    check('Whole course metadata, explicit levels and absent-state handling', report)
    const second = await recommend(page, 1)
    assert.equal(totalTasks(second), 6)
    check('Multiple macro instances do not duplicate tasks')
    if (name === 'standalone') {
      assert.ok(!Object.keys(result.served).some(url => url.includes('/lia-freeze-v2/')))
      assert.equal(await page.locator('.lia-submit-box,#lia-freeze-bar').count(), 0)
      check('MathPath alone loads neither Freeze nor submission UI')
    }
    await navigate(page, 2, 4, 1)
    await expect(page.locator('lia-adetails')).toHaveCount(4)
    if (name === 'freeze-delayed') {
      await page.addScriptTag({ content: await readFile(path.join(freezeRoot, 'dist/index.js'), 'utf8') })
      await expect.poll(() => page.evaluate(() => window.__liaFreezeLearningStateV1__?.read()?.phase)).not.toBe(undefined)
      report = await recommend(page)
      assert.equal(totalTasks(report), 6)
      check('Delayed Freeze initialization preserves the Lernpfad reader')
    }
    const firstInput = page.locator('input.lia-quiz__input').first()
    const firstQuiz = page.locator('.lia-quiz').first()
    if (name === 'freeze-send') {
      await expect(page.locator('body')).toHaveClass(/lia-send-collect/)
      await firstInput.fill('alpha')
      await firstQuiz.locator('.lia-quiz__check').click()
      await expect(firstInput).toBeEditable()
      report = await recommend(page)
      assert.equal(report.phase, 'collect')
      assert.equal(report.statusCounts.correct, 0)
      assert.equal(report.statusCounts.wrong, 0)
      assert.equal(report.statusCounts.partial, 0)
      assert.equal(report.recommendations.find(value => value.type === 'weakness').available, false)
      check('Send collection reveals no deferred correctness', report)
      await createAndReview(browser, page, name, result, check)
    } else {
      await firstInput.fill('wrong')
      await firstQuiz.locator('.lia-quiz__check').click()
      await expect(firstQuiz.locator('.text-error').first()).toBeVisible()
      await page.evaluate(() => {
        window.__lernpfadNodes = [...document.querySelectorAll('.lia-quiz,.lia-quiz button,input.lia-quiz__input')]
        window.__lernpfadMarkup = window.__lernpfadNodes.map(node => node.outerHTML)
      })
      report = await recommend(page)
      assert.equal(report.statusCounts.wrong, 1)
      assert.equal(topic(report, 'Bruchrechnung').weaknessCount, 4)
      assert.equal(topic(report, 'Einheiten').weaknessCount, 4)
      assert.equal(topic(report, 'Reflexion').weaknessCount, 1, 'An explicit untouched native quiz remains unanswered at zero BE')
      assert.ok(await page.evaluate(() => window.__lernpfadNodes.every((node, index) =>
        node.isConnected && node.outerHTML === window.__lernpfadMarkup[index])))
      check('Current failure and untouched siblings rank equally; zero BE and Elm nodes are preserved', report)
      await firstInput.fill('alpha')
      await firstQuiz.locator('.lia-quiz__check').click()
      await expect(firstInput).toBeDisabled()
      await navigate(page, 5, 0, 2)
      report = await recommend(page)
      assert.equal(report.statusCounts.correct, 1)
      assert.equal(report.statusCounts.wrong, 0)
      assert.equal(topic(report, 'Bruchrechnung').weaknessCount, 3)
      check('Later correct answer replaces prior errors across slides', report)
      await navigate(page, 3, 1, 0)
      await page.locator('input.lia-quiz__input').fill('gamma')
      await page.locator('.lia-quiz__check').click()
      await expect(page.locator('input.lia-quiz__input')).toBeDisabled()
      await navigate(page, 5, 0, 2)
      report = await recommend(page)
      assert.equal(report.statusCounts.correct, 2)
      await navigate(page, 3, 1, 0)
      await page.locator('lia-resetter-host input[type=button]').click()
      await expect(page.locator('input.lia-quiz__input')).toHaveValue('')
      await navigate(page, 5, 0, 2)
      report = await recommend(page)
      assert.equal(report.statusCounts.correct, 1)
      assert.equal(topic(report, 'Bruchrechnung').weaknessCount, 3)
      assert.equal(topic(report, 'Transfer').unavailableCount, 0)
      check('Reset updates recommendations without visiting unrelated tasks', report)
      await recommend(page)
      await recommend(page, 1)
      assert.equal(await page.locator(hostSelector + ' section[data-offer]').count(), 6)
      check('Repeated rendering and recommendation requests stay idempotent')
      if (name === 'mathpath-first') await createAndReview(browser, page, name, result, check)
    }
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
    assert.ok(!result.consoleErrors.some(value => /created_by_elm|virtualdom|virtual-dom/i.test(value)))
    check('No JavaScript or Elm ownership errors')
    result.ok = true
  } catch (error) {
    result.failure = { message: error.message, stack: error.stack }
    try { result.lastReport = await page.evaluate(() => window.__LIA_MATHPATH__?.getLastLearningRecommendations?.()) } catch { /* page unavailable */ }
  } finally { await context.close() }
  return result
}

const executablePath = await chromePath()
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const report = { ok: false, interpreter: viewer, browser: browser.version(), scenarios: [] }
try {
  for (const name of scenarios) {
    const result = await runScenario(browser, name)
    report.scenarios.push(result)
    process.stderr.write(name + ': ' + (result.ok ? 'PASS' : result.failure.message) + '\n')
  }
  report.ok = report.scenarios.every(result => result.ok)
} finally { await browser.close() }
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
process.exitCode = report.ok ? 0 : 1
