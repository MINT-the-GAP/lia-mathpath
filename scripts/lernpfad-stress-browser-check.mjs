#!/usr/bin/env node

// Real-browser stress test for Example.md. Unpublished local assets are routed
// under the exact production URLs used by the courses.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { bundleFilenameForVersion } from './version-bundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mathPathBundleFilename = bundleFilenameForVersion(
  JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
)
const freezeRoot = process.env.MATHPATH_FREEZE_ROOT ||
  path.resolve(root, '../Freeze/lia-freeze-v2')
const resetterRoot = process.env.MATHPATH_RESETTER_ROOT ||
  path.resolve(root, '../Resetter')
const sharedCandidates = [
  path.resolve(root, '..', 'Aufgabensammlung'),
  path.join(os.homedir(), 'Desktop', 'Aufgabensammlung')
]
const sharedRoot = process.env.MATHPATH_AUFGABENSAMMLUNG_ROOT ||
  sharedCandidates.find(candidate => existsSync(candidate)) ||
  sharedCandidates[0]

const viewer = process.env.MATHPATH_VIEWER_URL ||
  'https://liascript.github.io/course/'
const timeout = Number(process.env.MATHPATH_BROWSER_TIMEOUT || 120_000)
const cyclesPerOffer = Math.max(4,
  Number(process.env.MATHPATH_STRESS_OPEN_CYCLES || 4))
const parallelPerOffer = Math.max(10,
  Number(process.env.MATHPATH_STRESS_PARALLEL || 10))
const selected = process.argv.find(value => value.startsWith('--scenario='))
  ?.slice(11)
const allScenarios = [
  'standalone', 'freeze-first', 'mathpath-first',
  'freeze-delayed', 'freeze-send'
]
const scenarios = allScenarios.filter(name => !selected || name === selected)
assert.ok(scenarios.length, 'Unknown scenario: ' + selected)

const rawBase = 'https://raw.githubusercontent.com/MINT-the-GAP/'
const pagesBase = 'https://mint-the-gap.github.io/Aufgabensammlung/'
const mathPathUrl = rawBase +
  'lia-mathpath/refs/heads/master/README.md'
const mathPathDistUrl = rawBase +
  'lia-mathpath/refs/heads/master/dist/' + mathPathBundleFilename
const freezeUrl = rawBase + 'lia-freeze-v2/main/README.md'
const freezeDistUrl = rawBase + 'lia-freeze-v2/main/dist/index.js'
const resetterUrl = rawBase + 'lia-resetter/main/README.md'
const resetterDistUrl = rawBase + 'lia-resetter/main/dist/index.js'
const hostSelector = 'lia-mathpath-lernpfad'
const dataCoursePrefix =
  'data:text/plain;charset=utf-8;Content-Encoding=gzip;base64,'
const courseUrlFor = name => rawBase +
  'lia-mathpath/refs/heads/master/test/stress/Example-' + name + '.md'
const { chromium, expect: baseExpect } =
  createRequire(path.join(root, 'package.json'))('@playwright/test')
const expect = baseExpect.configure({ timeout })

const offerExpectations = {
  weakness: {
    manifestOffer: 'schwaechen-ueben',
    manifestLevel: 'einsteiger',
    targetLevel: 'Einsteiger',
    comment: 'Wiederhole wichtige Grundlagen zum Thema „Grundrechenarten“ und festige Inhalte, bei denen du noch unsicher bist.'
  },
  practice: {
    manifestOffer: 'weitere-uebungen',
    manifestLevel: 'einsteiger',
    targetLevel: 'Einsteiger',
    comment: 'Übe das Thema „Grundrechenarten“ auf deinem bisherigen Niveau weiter und gewinne mehr Sicherheit.'
  },
  deepen: {
    manifestOffer: 'vertiefungen',
    manifestLevel: 'fortgeschrittene',
    targetLevel: 'Fortgeschritten',
    comment: 'Stelle dich neuen Herausforderungen und vertiefe das Thema „Grundrechenarten“ auf der nächsten Schwierigkeitsstufe.'
  }
}

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:/Program Files',
          'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] ||
          'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe')
      ]
    : [
        '/usr/bin/google-chrome', '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      ]
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next installed browser.
    }
  }
}

function scenarioSource(example, name) {
  const imports = name === 'standalone'
    ? [mathPathUrl, resetterUrl]
    : name === 'mathpath-first'
      ? [mathPathUrl, freezeUrl, resetterUrl]
      : [freezeUrl, mathPathUrl, resetterUrl]
  const removed = new Set([mathPathUrl, freezeUrl, resetterUrl]
    .map(url => 'import: ' + url))
  const lines = example.replace(/\r\n/g, '\n').split('\n')
    .filter(line => !removed.has(line.trim()))
  const end = lines.indexOf('-->')
  assert.ok(end > 0, 'Example.md header is not closed')
  lines.splice(end, 0, ...imports.map(url => 'import: ' + url))
  let source = lines.join('\n').trimEnd()
  if (name === 'standalone') {
    const marker = source.lastIndexOf('\n@Lernpfad')
    assert.ok(marker >= 0, 'Example.md has no closing @Lernpfad')
    source = source.slice(0, marker) +
      '\n@Lernpfad\n\n@Lernpfad' + source.slice(marker + 11)
  }
  if (name === 'freeze-send') {
    source += '\n\n# Abgabe\n\n@Abgabe\n\n@Auswertung(Send)'
  }
  return source + '\n'
}

function stressTaskSource(index) {
  return [
    '<!--',
    'author: Browser Stress ' + index,
    'version: 1.0.0',
    'language: de',
    'mode: Presentation',
    'import: ' + mathPathUrl,
    '-->',
    '',
    '# STRESS_TASK_' + index,
    '',
    'Berechne: [[ stress-' + index + ' ]]',
    '[[?]] @Explain',
    '',
    '@ADetails(1=BE;Grundrechenarten, Addition)',
    ''
  ].join('\n')
}

async function addFile(resources, url, filename) {
  await access(filename)
  resources.set(url, {
    body: await readFile(filename),
    contentType: filename.endsWith('.js')
      ? 'application/javascript; charset=utf-8'
      : filename.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'text/markdown; charset=utf-8'
  })
}

async function installRoutes(context, name, result) {
  const resources = new Map()
  const example = await readFile(path.join(root, 'Example.md'), 'utf8')
  resources.set(courseUrlFor(name), {
    body: scenarioSource(example, name),
    contentType: 'text/markdown; charset=utf-8'
  })
  const definitions = [
    [mathPathUrl, path.join(root, 'README.md')],
    [mathPathDistUrl, path.join(root, 'dist', mathPathBundleFilename)],
    [rawBase + 'lia-mathpath/refs/heads/master/Explain.md',
      path.join(root, 'Explain.md')],
    [rawBase + 'lia-mathpath/refs/heads/master/Glossar.md',
      path.join(root, 'Glossar.md')],
    [rawBase + 'lia-mathpath/master/README.md',
      path.join(root, 'README.md')],
    [rawBase + 'lia-mathpath/master/dist/' + mathPathBundleFilename,
      path.join(root, 'dist', mathPathBundleFilename)],
    [rawBase + 'lia-mathpath/master/Explain.md',
      path.join(root, 'Explain.md')],
    [rawBase + 'lia-mathpath/master/Glossar.md',
      path.join(root, 'Glossar.md')],
    [resetterUrl, path.join(resetterRoot, 'README.md')],
    [resetterDistUrl, path.join(resetterRoot, 'dist/index.js')],
    [freezeUrl, path.join(freezeRoot, 'README.md')],
    [freezeDistUrl, path.join(freezeRoot, 'dist/index.js')],
    [pagesBase + 'course.html', path.join(sharedRoot, 'course.html')],
    [pagesBase + 'course-frame.html',
      path.join(sharedRoot, 'course-frame.html')],
    [pagesBase + 'assets/course-source.js',
      path.join(sharedRoot, 'assets/course-source.js')],
    [pagesBase + 'assets/course-generator.js',
      path.join(sharedRoot, 'assets/course-generator.js')],
    [pagesBase + 'assets/course-catalog.js',
      path.join(sharedRoot, 'assets/course-catalog.js')],
    [pagesBase + 'assets/course-player.js',
      path.join(sharedRoot, 'assets/course-player.js')],
    [pagesBase + 'assets/vendor/fflate-0.8.2.min.js',
      path.join(sharedRoot, 'assets/vendor/fflate-0.8.2.min.js')]
  ]
  for (const [url, filename] of definitions) {
    await addFile(resources, url, filename)
  }

  const taskNumbers = new Map()
  await context.route('**/*', async route => {
    const request = route.request()
    const parsed = new URL(request.url())
    parsed.search = ''
    parsed.hash = ''
    const key = parsed.href
    let resource = resources.get(key)
    if (!resource && parsed.hostname === 'raw.githubusercontent.com' &&
        /^\/MINT-the-GAP\/Aufgabensammlung\/.+\/Aufgabe_[^/]+\.md$/i
          .test(parsed.pathname)) {
      if (!taskNumbers.has(key)) {
        taskNumbers.set(key, taskNumbers.size + 1)
      }
      resource = {
        body: stressTaskSource(taskNumbers.get(key)),
        contentType: 'text/markdown; charset=utf-8'
      }
      result.taskFetches[key] = (result.taskFetches[key] || 0) + 1
    }
    if (!resource) {
      return route.continue()
    }
    result.served[key] = (result.served[key] || 0) + 1
    if (key.startsWith(pagesBase + 'assets/course-') ||
        key === pagesBase + 'assets/vendor/fflate-0.8.2.min.js') {
      result.sharedRequests[key] =
        (result.sharedRequests[key] || 0) + 1
    }
    const delayedFreeze = name === 'freeze-delayed' &&
      key === freezeDistUrl
    await route.fulfill({
      status: request.method() === 'OPTIONS' ? 204 : 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'cache-control': 'no-store'
      },
      contentType: resource.contentType,
      body: request.method() === 'OPTIONS' || delayedFreeze
        ? ''
        : resource.body
    })
  })
}

async function navigate(page, slide) {
  await page.evaluate(value => {
    location.hash = '#' + value
  }, slide)
  await page.waitForFunction(value => location.hash === '#' + value, slide)
}

async function recommend(host) {
  await expect(host.locator('section[data-offer]')).toHaveCount(3)
  await expect.poll(() => host.evaluate(element => element.report)).not.toBe(null)
  const report = await host.evaluate(element => element.report)
  assert.ok(report && Array.isArray(report.recommendations))
  return report
}

async function selectStressTopic(host) {
  for (const type of Object.keys(offerExpectations)) {
    const section = host.locator('section[data-offer=' + type + ']')
    const select = section.locator('.topic-label:not(.secondary-label) select')
    if (await select.isDisabled()) {
      const report = await host.evaluate(element => element.report)
      throw new Error('Stress topic disabled for ' + type + ': ' +
        JSON.stringify(report))
    }
    await select.selectOption({ label: 'Grundrechenarten' })
    await expect(select).toHaveValue('Grundrechenarten')
  }
  await expect.poll(() => host.evaluate(element =>
    element.report?.recommendations?.every(item =>
      item.topic === 'Grundrechenarten'))).toBe(true)
}

function count(text, expression) {
  return (String(text).match(expression) || []).length
}

function decodeOfficialDataCourse(url) {
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://liascript.github.io')
  assert.equal(parsed.pathname, '/course/')
  const uri = parsed.search.slice(1)
  assert.ok(uri.startsWith(dataCoursePrefix))
  assert.ok(!/%(?:3A|2F|3B|2C)/i.test(uri))
  return {
    uri,
    body: gunzipSync(Buffer.from(uri.slice(dataCoursePrefix.length), 'base64'))
      .toString('utf8')
  }
}

async function stressPublicApi(page, host, perOffer) {
  const generated = await page.evaluate(async ({ selector, perOffer }) => {
    const element = document.querySelector(selector)
    const report = element?.report
    const api = window.__LIA_MATHPATH__
    if (!report || typeof api?.generateLearningCourse !== 'function') {
      throw new Error('Structured report or public generation API missing')
    }
    const calls = []
    for (const recommendation of report.recommendations) {
      for (let index = 0; index < perOffer; index++) {
        calls.push(api.generateLearningCourse({
          courseUrl: report.courseUrl,
          recommendation
        }, {
          seed: recommendation.type + '-' + index
        }))
      }
    }
    return Promise.all(calls)
  }, { selector: hostSelector, perOffer })

  assert.equal(generated.length, perOffer * 3)
  for (const course of generated) {
    const expected = offerExpectations[course.type]
    assert.ok(expected, 'Unexpected generated offer: ' + course.type)
    assert.equal(course.topic, 'Grundrechenarten')
    assert.equal(course.targetLevel, expected.targetLevel)
    assert.equal(course.taskCount, 4)
    assert.equal(course.taskIds.length, 4)
    assert.equal(new Set(course.taskIds).size, 4)
    assert.doesNotMatch(course.markdown,
      /lia-freeze|FreezeREADME|@Abgabe|@Auswertung/i)
    assert.equal(count(course.markdown,
      /^import:\s+https:\/\/raw\.githubusercontent\.com\/MINT-the-GAP\/lia-mathpath\/refs\/heads\/master\/README\.md\?v=0\.0\.24$/gm), 1)
    assert.deepEqual(
      course.markdown.match(/^comment:.*$/gm),
      ['comment: ' + expected.comment]
    )
    assert.equal(count(course.markdown, /^@Lernpfad$/gm), 1)
    assert.match(course.openingTarget,
      /^https:\/\/mint-the-gap\.github\.io\/Aufgabensammlung\/course\.html\?v=1\.0\.10#course=/)
  }

  const sharedScripts = await page.evaluate(prefix =>
    [...document.scripts].map(script => script.src)
      .filter(src => src.startsWith(prefix) &&
        /\/assets\/course-(?:source|generator|catalog)\.js\?v=1\.0\.10$/.test(src)),
  pagesBase)
  assert.equal(sharedScripts.length, 3)
  assert.equal(new Set(sharedScripts).size, 3)
  return { calls: generated.length, sharedScripts }
}

async function inspectOpenedCourse(popup) {
  await popup.waitForURL(url =>
    url.origin === 'https://liascript.github.io' &&
    url.pathname === '/course/' &&
    url.search.startsWith('?' + dataCoursePrefix), { timeout })
  const frame = popup
  await navigate(frame, 2)
  await expect(frame.locator('.lia-quiz').first()).toBeVisible()
  assert.match(await frame.locator('.lia-canvas').first().getAttribute('class') || '',
    /\blia-mode--presentation\b/)
  assert.doesNotMatch(await frame.locator('.lia-canvas').first().getAttribute('class') || '',
    /\blia-mode--textbook\b/)
  assert.equal(await frame.locator('.monaco-editor,#liascript-preview').count(),
    0)
  const source = decodeOfficialDataCourse(frame.url())
  assert.doesNotMatch(source.body,
    /lia-freeze|FreezeREADME|@Abgabe|@Auswertung/i)
  assert.equal(count(source.body,
    /^import:\s+https:\/\/raw\.githubusercontent\.com\/MINT-the-GAP\/lia-mathpath\/refs\/heads\/master\/README\.md\?v=0\.0\.24$/gm), 1)
  assert.equal(count(source.body, /^@Lernpfad$/gm), 1)
  assert.equal(count(source.body, /^# STRESS_TASK_\d+$/gm), 4)
  assert.equal(count(source.body, /^mode:\s*Presentation$/gm), 1)
  assert.doesNotMatch(source.body, /^mode:\s*Textbook$/m)
  return { uri: source.uri, characters: source.body.length }
}

async function openOffer(context, page, host, type, inspectCourse) {
  const expected = offerExpectations[type]
  const button = host.locator(
    'section[data-offer=' + type + '] button.open-course')
  await expect(button).toBeEnabled()
  const pagesBefore = context.pages().filter(value => !value.isClosed()).length
  const callsBefore = await page.evaluate(() =>
    window.__MATHPATH_STRESS_OPEN_CALLS__.length)
  await button.evaluate(element => {
    element.addEventListener('click', () => element.click(), { once: true })
  })
  const popupPromise = context.waitForEvent('page')
  await button.click()
  const popup = await popupPromise
  popup.setDefaultTimeout(timeout)
  await popup.waitForURL(url =>
    url.origin === 'https://mint-the-gap.github.io' &&
    url.pathname === '/Aufgabensammlung/course.html' &&
    url.hash.startsWith('#course='), { timeout })

  const openingUrl = new URL(popup.url())
  const encoded = new URLSearchParams(openingUrl.hash.slice(1)).get('course')
  assert.ok(encoded)
  const manifest = JSON.parse(encoded)
  assert.equal(manifest.kind, 'lernpfad')
  assert.equal(manifest.offer, expected.manifestOffer)
  assert.equal(manifest.topic, 'Grundrechenarten')
  assert.equal(manifest.level, expected.manifestLevel)
  assert.equal(manifest.urls.length, 4)
  assert.equal(new Set(manifest.urls).size, 4)
  assert.equal(openingUrl.search, '?v=1.0.10')

  await page.waitForTimeout(150)
  const calls = await page.evaluate(() =>
    window.__MATHPATH_STRESS_OPEN_CALLS__)
  assert.equal(calls.length, callsBefore + 1,
    'Rapid double click must reserve exactly one popup')
  assert.deepEqual(calls.at(-1), {
    url: 'about:blank',
    target: '_blank',
    userActivation: true
  })
  assert.equal(context.pages().filter(value => !value.isClosed()).length,
    pagesBefore + 1)

  // The launcher immediately replaces itself with the official LiaScript
  // viewer. Do not evaluate inside the transient launcher document: under
  // stress that context can disappear between Playwright scheduling and the
  // actual evaluation.
  await popup.waitForURL(url =>
    url.origin === 'https://liascript.github.io' &&
    url.pathname === '/course/' &&
    url.search.startsWith('?' + dataCoursePrefix), { timeout })
  assert.equal(await popup.evaluate(() => window.opener === null), true)

  const source = inspectCourse
    ? await inspectOpenedCourse(popup)
    : null
  await popup.close()
  await expect.poll(() =>
    context.pages().filter(value => !value.isClosed()).length)
    .toBe(pagesBefore)
  return {
    type,
    offer: manifest.offer,
    level: manifest.level,
    source
  }
}

async function runSendScenario(context, page, result) {
  await expect(page.locator('body')).toHaveClass(/lia-send-collect/)
  const input = page.locator('input.lia-quiz__input').first()
  await input.fill('0')
  await page.locator('.lia-quiz').first().locator('.lia-quiz__check').click()
  await navigate(page, 10)
  const host = page.locator(hostSelector)
  await expect(host).toHaveCount(1)
  const report = await recommend(host)
  assert.equal(report.phase, 'collect')
  const buttons = host.locator('button.open-course')
  await expect(buttons).toHaveCount(3)
  for (let index = 0; index < 3; index++) {
    await expect(buttons.nth(index)).toBeDisabled()
    await buttons.nth(index).evaluate(button => button.click())
  }
  assert.equal(await page.evaluate(() =>
    window.__MATHPATH_STRESS_OPEN_CALLS__.length), 0)
  assert.deepEqual(result.sharedRequests, {
    [pagesBase + 'assets/course-source.js']: 1,
    [pagesBase + 'assets/course-generator.js']: 1,
    [pagesBase + 'assets/course-catalog.js']: 1
  })
  assert.deepEqual(result.taskFetches, {})
  assert.equal(context.pages().filter(value => !value.isClosed()).length, 1)
  result.checks.push({
    label: 'Send collection blocks course generation and all task I/O',
    details: report.recommendations.map(item => ({
      type: item.type,
      available: item.available
    }))
  })
}

async function runGenerationScenario(context, page, name, result) {
  if (name === 'freeze-delayed') {
    await page.addScriptTag({
      content: await readFile(path.join(freezeRoot, 'dist/index.js'), 'utf8')
    })
    await page.waitForFunction(() =>
      Boolean(window.__liaFreezeLearningStateV1__))
  }

  const firstQuiz = page.locator('.lia-quiz').first()
  const firstInput = page.locator('input.lia-quiz__input').first()
  await firstInput.fill('0')
  await firstQuiz.locator('.lia-quiz__check').click()
  await expect(firstQuiz.locator('.text-error').first()).toBeVisible()
  await navigate(page, 10)

  const hosts = page.locator(hostSelector)
  const expectedHosts = name === 'standalone' ? 2 : 1
  await expect(hosts).toHaveCount(expectedHosts)
  for (let index = 0; index < expectedHosts; index++) {
    await recommend(hosts.nth(index))
    await selectStressTopic(hosts.nth(index))
  }

  const perOffer = name === 'standalone' ? parallelPerOffer : 2
  const apiStress = await stressPublicApi(page, hosts.first(), perOffer)
  result.checks.push({
    label: 'Concurrent public API generation',
    details: apiStress
  })

  const cycles = name === 'standalone' ? cyclesPerOffer : 1
  const openings = []
  for (const type of Object.keys(offerExpectations)) {
    for (let cycle = 0; cycle < cycles; cycle++) {
      const host = hosts.nth(cycle % expectedHosts)
      openings.push(await openOffer(
        context, page, host, type, cycle === 0))
    }
  }
  result.checks.push({
    label: 'All offers opened under rapid double clicks',
    details: { cyclesPerOffer: cycles, openings }
  })

  await navigate(page, 3)
  await expect(page.locator('input.lia-quiz__input').first()).toHaveValue('0')
  assert.equal(context.pages().filter(value => !value.isClosed()).length, 1)
  result.checks.push({
    label: 'Original course state and popup count remain stable'
  })
}

async function runScenario(browser, name) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 960 },
    locale: 'de-DE',
    serviceWorkers: 'block'
  })
  context.setDefaultTimeout(timeout)
  await context.addInitScript(() => {
    const nativeOpen = window.open.bind(window)
    const calls = []
    Object.defineProperty(window, '__MATHPATH_STRESS_OPEN_CALLS__', {
      configurable: false,
      enumerable: false,
      value: calls,
      writable: false
    })
    window.open = (...args) => {
      calls.push({
        url: String(args[0] ?? ''),
        target: String(args[1] ?? ''),
        userActivation: navigator.userActivation?.isActive ?? null
      })
      return nativeOpen(...args)
    }
  })

  const result = {
    name,
    ok: false,
    checks: [],
    served: {},
    sharedRequests: {},
    taskFetches: {},
    errors: [],
    consoleErrors: []
  }
  context.on('page', target => {
    target.on('pageerror', error => result.errors.push(String(error)))
    target.on('console', message => {
      if (message.type() === 'error') {
        result.consoleErrors.push(message.text())
      }
    })
  })

  try {
    await installRoutes(context, name, result)
    const page = await context.newPage()
    await page.goto(viewer + '?' + courseUrlFor(name) + '#3', {
      waitUntil: 'domcontentloaded',
      timeout
    })
    await expect(page.locator('.lia-quiz').first()).toBeVisible()
    await page.waitForFunction(() => Boolean(window.__LIA_MATHPATH__))

    if (name === 'freeze-send') {
      await runSendScenario(context, page, result)
    } else {
      await runGenerationScenario(context, page, name, result)
    }

    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.consoleErrors, [])
    assert.equal(context.pages().filter(value => !value.isClosed()).length, 1)
    result.checks.push({
      label: 'No JavaScript, console, Elm, or orphan-popup errors'
    })
    result.ok = true
  } catch (error) {
    result.failure = {
      message: error.message,
      stack: error.stack
    }
  } finally {
    await context.close()
  }
  result.requestSummary = {
    servedUrls: Object.keys(result.served).length,
    servedRequests: Object.values(result.served)
      .reduce((sum, count) => sum + count, 0),
    sharedScriptUrls: Object.keys(result.sharedRequests),
    sharedScriptRequests: Object.values(result.sharedRequests)
      .reduce((sum, count) => sum + count, 0),
    taskUrls: Object.keys(result.taskFetches).length,
    taskFetches: Object.values(result.taskFetches)
      .reduce((sum, count) => sum + count, 0)
  }
  if (result.ok) {
    delete result.served
    delete result.sharedRequests
    delete result.taskFetches
  }
  return result
}

async function run() {
  const executablePath = await chromePath()
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  })
  const report = {
    ok: false,
    browser: browser.version(),
    interpreter: viewer,
    sharedRoot,
    cyclesPerOffer,
    parallelPerOffer,
    scenarios: []
  }
  try {
    for (const name of scenarios) {
      const result = await runScenario(browser, name)
      report.scenarios.push(result)
      process.stderr.write(name + ': ' +
        (result.ok ? 'PASS' : result.failure.message) + '\n')
    }
    report.ok = report.scenarios.every(result => result.ok)
  } finally {
    await browser.close()
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.ok ? 0 : 1
}

await run()
