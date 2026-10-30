#!/usr/bin/env node

// Current public LiaScript interpreter with unpublished MathPath and
// Aufgabensammlung assets routed under their production URLs.
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
const sharedCandidates = [
  path.resolve(root, '..', 'Aufgabensammlung'),
  path.join(os.homedir(), 'Desktop', 'Aufgabensammlung')
]
const sharedRoot = process.env.MATHPATH_AUFGABENSAMMLUNG_ROOT ||
  sharedCandidates.find(candidate => existsSync(candidate)) ||
  sharedCandidates[0]
const viewer = process.env.MATHPATH_VIEWER_URL || 'https://liascript.github.io/course/'
const timeout = Number(process.env.MATHPATH_BROWSER_TIMEOUT || 90_000)
const rawBase = 'https://raw.githubusercontent.com/MINT-the-GAP/'
const pagesBase = 'https://mint-the-gap.github.io/Aufgabensammlung/'
const mathPathUrl = rawBase + 'lia-mathpath/refs/heads/master/README.md'
const originalCourseUrl = rawBase +
  'lia-mathpath/refs/heads/master/test/fixtures/lernpfad-generation-browser.md'
const hostSelector = 'lia-mathpath-lernpfad'
const dataCoursePrefix =
  'data:text/plain;charset=utf-8;Content-Encoding=gzip;base64,'
const { chromium, expect: baseExpect } =
  createRequire(path.join(root, 'package.json'))('@playwright/test')
const expect = baseExpect.configure({ timeout })

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* continue */ }
  }
}

function originalCourseSource() {
  const tasks = [
    ['Bruchrechnung A', 'bruch-a', 'Bruchrechnung'],
    ['Bruchrechnung B', 'bruch-b', 'Bruchrechnung'],
    ['Grundrechenarten A', 'grund-a', 'Grundrechenarten, Addition'],
    ['Grundrechenarten B', 'grund-b', 'Grundrechenarten, Addition']
  ]
  return [
    '<!--', 'author: Browser Regression', 'version: 1.0.0', 'language: de',
    'tags: Mathematik, Klasse 7, Gymnasium',
    'mode: Presentation', 'lernpfad-level: Einsteiger',
    'import: ' + mathPathUrl, '-->', '',
    '# Ausgangskurs zur Lernpfad-Generierung', '',
    ...tasks.flatMap(([title, answer, topic]) => [
      '## ' + title, '', 'Antwort: [[ ' + answer + ' ]]',
      '[[?]] @Explain', '', '@ADetails(1=BE; ' + topic + ')', ''
    ]),
    '## Empfehlungen', '', '@Lernpfad', ''
  ].join('\n')
}

function generatedTaskSource(index) {
  const header = [
    '<!--', 'author: Browser Task ' + index, 'version: 1.0.0',
    'language: de', 'mode: Presentation',
    'comment: Technische Browser-Aufgabe ' + index,
    'import: ' + mathPathUrl
  ]
  if (index === 1) {
    header.push('@canvas: <span data-browser-canvas-stub="1"></span>')
  }
  header.push('-->', '', '# BROWSER_TASK_' + index, '', '@Explain(Tutorial)', '')

  if (index === 1) {
    return header.concat([
      'Browserantwort 1: [[ browser-1 ]] @canvas',
      '[[?]] @Explain', '',
      '@ADetails(`points=0;tags=Grundrechenarten, Browser-Tag`)', ''
    ]).join('\n')
  }

  if (index === 2) {
    return header.concat(Array.from({ length: 8 }, (_, offset) => {
      const number = offset + 1
      const details = offset === 0
        ? '@ADetails(`points=1,5;tags=Grundrechenarten, Browser-Tag`)'
        : '@ADetails(1=BE; Grundrechenarten, Browser-Tag)'
      return [
        'Browserantwort 2-' + number + ': [[ browser-2-' + number + ' ]]',
        '[[?]] @Explain', '', details, ''
      ]
    }).flat()).join('\n')
  }

  return header.concat([1, 2].flatMap(number => [
    '``` ascii',
    '+------------------------+------------------------+',
    '| " [[ ascii-' + index + '-' + number + '-a ]] " | " [[ ascii-' +
      index + '-' + number + '-b ]] " |',
    '+------------------------+------------------------+',
    '```',
    '[[?]] @Explain', '', '@resetter', '',
    '@ADetails(1=BE; Grundrechenarten, Browser-Tag)', ''
  ])).join('\n')
}

async function loadResources() {
  const definitions = [
    [pagesBase + 'course.html', path.join(sharedRoot, 'course.html')],
    [pagesBase + 'course-frame.html', path.join(sharedRoot, 'course-frame.html')],
    [pagesBase + 'assets/course-source.js', path.join(sharedRoot, 'assets/course-source.js')],
    [pagesBase + 'assets/course-generator.js', path.join(sharedRoot, 'assets/course-generator.js')],
    [pagesBase + 'assets/course-catalog.js', path.join(sharedRoot, 'assets/course-catalog.js')],
    [pagesBase + 'assets/course-player.js', path.join(sharedRoot, 'assets/course-player.js')],
    [pagesBase + 'assets/vendor/fflate-0.8.2.min.js',
      path.join(sharedRoot, 'assets/vendor/fflate-0.8.2.min.js')],
    [mathPathUrl, path.join(root, 'README.md')],
    [rawBase + 'lia-mathpath/refs/heads/master/dist/' + mathPathBundleFilename,
      path.join(root, 'dist', mathPathBundleFilename)],
    [rawBase + 'lia-mathpath/refs/heads/master/Explain.md', path.join(root, 'Explain.md')],
    [rawBase + 'lia-mathpath/refs/heads/master/Glossar.md', path.join(root, 'Glossar.md')],
    [rawBase + 'lia-mathpath/master/README.md', path.join(root, 'README.md')],
    [rawBase + 'lia-mathpath/master/dist/' + mathPathBundleFilename,
      path.join(root, 'dist', mathPathBundleFilename)],
    [rawBase + 'lia-mathpath/master/Explain.md', path.join(root, 'Explain.md')],
    [rawBase + 'lia-mathpath/master/Glossar.md', path.join(root, 'Glossar.md')]
  ]
  const resources = new Map()
  for (const [url, filename] of definitions) {
    await access(filename)
    resources.set(url, {
      body: await readFile(filename),
      contentType: filename.endsWith('.js') ? 'application/javascript; charset=utf-8'
        : filename.endsWith('.html') ? 'text/html; charset=utf-8'
          : 'text/markdown; charset=utf-8'
    })
  }
  resources.set(originalCourseUrl, {
    body: originalCourseSource(),
    contentType: 'text/markdown; charset=utf-8'
  })
  return resources
}

async function installRoutes(context, result) {
  const resources = await loadResources()
  const taskNumbers = new Map()
  await context.route('**/*', async route => {
    const request = route.request()
    const parsed = new URL(request.url())
    parsed.search = ''
    parsed.hash = ''
    const key = parsed.href
    let resource = resources.get(key)
    if (!resource && parsed.hostname === 'raw.githubusercontent.com' &&
        /^\/MINT-the-GAP\/Aufgabensammlung\/.+\/Aufgabe_[^/]+\.md$/i.test(parsed.pathname)) {
      if (!taskNumbers.has(key)) taskNumbers.set(key, taskNumbers.size + 1)
      resource = {
        body: generatedTaskSource(taskNumbers.get(key)),
        contentType: 'text/markdown; charset=utf-8'
      }
      result.taskFetches[key] = (result.taskFetches[key] || 0) + 1
    }
    if (!resource) return route.continue()
    result.served[key] = (result.served[key] || 0) + 1
    await route.fulfill({
      status: request.method() === 'OPTIONS' ? 204 : 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'cache-control': 'no-store'
      },
      contentType: resource.contentType,
      body: request.method() === 'OPTIONS' ? '' : resource.body
    })
  })
}

async function navigate(target, slide) {
  await target.evaluate(value => { location.hash = '#' + value }, slide)
  await target.waitForFunction(value => location.hash === '#' + value, slide)
}

async function findLearningPathSlide(frame) {
  for (let slide = 1; slide <= 9; slide++) {
    await navigate(frame, slide)
    if (await frame.locator(hostSelector).count()) return slide
  }
  throw new Error('Generated closing @Lernpfad slide not found')
}

async function recommend(host) {
  const button = host.getByRole('button', { name: /Empfehlungen.*Lernpfad/i })
  await expect(button).toBeVisible()
  await button.click()
  await expect(host.locator('section[data-offer]')).toHaveCount(3)
  return host.evaluate(element => element.report)
}

async function adetailsSnapshot(frame) {
  return frame.evaluate(() => {
    const deep = (root, selector) => {
      const result = [...root.querySelectorAll(selector)]
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) result.push(...deep(node.shadowRoot, selector))
      }
      return result
    }
    return {
      markers: document.querySelectorAll('lia-adetails,.lia-assignment-details').length,
      badges: deep(document,
        '.lia-adetails-points,.lia-mathpath-adetails-points,[data-lia-mathpath-adetails-points]')
        .filter(node => !node.hidden).map(node => node.textContent.trim())
    }
  })
}

const count = (text, expression) => (String(text).match(expression) || []).length

function decodeOfficialDataCourse(url) {
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://liascript.github.io')
  assert.equal(parsed.pathname, '/course/')
  const uri = parsed.search.slice(1)
  assert.ok(uri.startsWith(dataCoursePrefix))
  assert.ok(!/%(?:3A|2F|3B|2C)/i.test(uri),
    'The official LiaScript data URI must not be encoded as one URL component')
  return {
    uri,
    body: gunzipSync(Buffer.from(uri.slice(dataCoursePrefix.length), 'base64'))
      .toString('utf8')
  }
}

async function run() {
  const executablePath = await chromePath()
  const browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {})
  })
  const result = {
    ok: false, browser: browser.version(), interpreter: viewer, sharedRoot,
    checks: [], served: {}, taskFetches: {}, errors: [], consoleErrors: []
  }
  const check = (label, details) => result.checks.push({ label, ok: true, details })
  const context = await browser.newContext({
    viewport: { width: 1360, height: 960 }, locale: 'de-DE', serviceWorkers: 'block'
  })
  context.setDefaultTimeout(timeout)
  await context.addInitScript(() => {
    const nativeOpen = window.open.bind(window)
    const calls = []
    Object.defineProperty(window, '__MATHPATH_OPEN_CALLS__', {
      configurable: false, enumerable: false, value: calls, writable: false
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
  context.on('page', page => {
    page.on('pageerror', error => result.errors.push(String(error)))
    page.on('console', message => {
      if (message.type() === 'error') result.consoleErrors.push(message.text())
    })
  })
  try {
    await installRoutes(context, result)
    const page = await context.newPage()
    await page.goto(viewer + '?' + originalCourseUrl + '#2', {
      waitUntil: 'domcontentloaded', timeout
    })
    await page.waitForFunction(() => Boolean(window.__LIA_MATHPATH__))
    const publicApi = await page.evaluate(() => Object.fromEntries([
      'generateLearningCourse', 'openGeneratedLearningCourse', 'openLearningCourse'
    ].map(name => [name, typeof window.__LIA_MATHPATH__?.[name]])))
    assert.deepEqual(publicApi, {
      generateLearningCourse: 'function',
      openGeneratedLearningCourse: 'function',
      openLearningCourse: 'function'
    })
    check('Public course-generation API', publicApi)

    const firstQuiz = page.locator('.lia-quiz').first()
    await expect(firstQuiz).toBeVisible()
    await page.locator('input.lia-quiz__input').first().fill('falsch')
    await firstQuiz.locator('.lia-quiz__check').click()
    await expect(firstQuiz.locator('.text-error').first()).toBeVisible()
    const originalQuizMarkup = await firstQuiz.evaluate(node => node.outerHTML)

    await navigate(page, 6)
    const originalHost = page.locator(hostSelector)
    await expect(originalHost).toHaveCount(1)
    const initialReport = await recommend(originalHost)
    assert.equal(Object.values(initialReport.statusCounts).reduce((sum, value) => sum + value, 0), 4)
    assert.equal(initialReport.statusCounts.wrong, 1)
    check('Original recommendation state', initialReport.statusCounts)

    const practice = originalHost.locator('section[data-offer=practice]')
    const topic = practice.locator('select')
    await topic.selectOption({ label: 'Grundrechenarten' })
    await expect(topic).toHaveValue('Grundrechenarten')
    await expect.poll(() => originalHost.evaluate(element =>
      element.report?.recommendations?.find(item => item.type === 'practice')?.topic
    )).toBe('Grundrechenarten')
    check('Dropdown changes structured recommendation')

    const popupPromise = context.waitForEvent('page')
    await practice.locator('button.open-course').click()
    const popup = await popupPromise
    popup.setDefaultTimeout(timeout)
    await popup.waitForURL(url =>
      url.origin === 'https://mint-the-gap.github.io' &&
      url.pathname === '/Aufgabensammlung/course.html' &&
      url.hash.startsWith('#course='), { timeout })
    const openingUrl = new URL(popup.url())
    const encodedManifest = new URLSearchParams(openingUrl.hash.slice(1)).get('course')
    assert.ok(encodedManifest)
    const manifest = JSON.parse(encodedManifest)
    assert.deepEqual(
      {
        kind: manifest.kind, offer: manifest.offer, topic: manifest.topic, level: manifest.level,
        grade: manifest.grade, schoolType: manifest.schoolType
      },
      {
        kind: 'lernpfad', offer: 'weitere-uebungen', topic: 'Grundrechenarten',
        level: 'einsteiger', grade: 7, schoolType: 'gymnasium'
      }
    )
    assert.equal(manifest.urls.length, 4)
    assert.equal(new Set(manifest.urls).size, 4)
    const sharedCatalog = JSON.parse(await readFile(
      path.join(sharedRoot, 'assets', 'course-catalog.json'),
      'utf8'
    ))
    const catalogByUrl = new Map(sharedCatalog.tasks.map(task => [task.url, task]))
    const evidencedTopics = new Set(initialReport.topics.map(item =>
      item.topic.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('de-DE')
    ))
    const sharedGenerator = createRequire(path.join(root, 'package.json'))(
      path.join(sharedRoot, 'assets', 'course-generator.js')
    )
    const curriculumContext = sharedGenerator.deriveCurriculumContext(sharedCatalog, {
      observedThemes: initialReport.topics.map(item => item.topic),
      grade: initialReport.context.grade,
      schoolType: initialReport.context.schoolType
    })
    const allowedTopics = new Set(curriculumContext.allowedThemes.map(item =>
      item.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('de-DE')
    ))
    assert.equal(initialReport.context.grade, 7)
    assert.equal(initialReport.context.schoolType, 'gymnasium')
    assert.equal(allowedTopics.has('dezimalzahlen'), true)
    assert.equal(evidencedTopics.has('dezimalzahlen'), false)
    assert.equal(allowedTopics.has('negative zahlen'), false)
    const selectedCatalogTasks = manifest.urls.map(url => catalogByUrl.get(url))
    assert.ok(selectedCatalogTasks.every(Boolean))
    assert.ok(selectedCatalogTasks.every(task => task.topics.every(topic =>
      allowedTopics.has(topic.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('de-DE'))
    )))
    check('Generated URLs stay inside observed plus earlier curriculum context', {
      evidencedTopics: [...evidencedTopics],
      allowedTopics: [...allowedTopics],
      selected: selectedCatalogTasks.map(task => ({ id: task.id, topics: task.topics }))
    })
    assert.equal(openingUrl.search, '?v=1.0.7')
    const openCalls = await page.evaluate(() => window.__MATHPATH_OPEN_CALLS__)
    assert.equal(openCalls.length, 1)
    assert.deepEqual(openCalls[0], {
      url: 'about:blank', target: '_blank', userActivation: true
    })
    check('Synchronous separated popup and four-source hash manifest', {
      openCall: openCalls[0], manifest
    })

    await expect(practice.locator('.course-status')).toContainText(/neuen Fenster.*ffnet/i)
    assert.equal(page.isClosed(), false)

    await popup.waitForURL(url =>
      url.origin === 'https://liascript.github.io' &&
      url.pathname === '/course/' &&
      url.search.startsWith('?' + dataCoursePrefix), { timeout })
    assert.equal(await popup.evaluate(() => window.opener === null), true)
    const frame = popup
    await navigate(frame, 2)
    await expect(frame.locator('.lia-quiz').first()).toBeVisible()
    assert.match(await frame.locator('.lia-canvas').first().getAttribute('class') || '',
      /\blia-mode--presentation\b/)
    assert.doesNotMatch(await frame.locator('.lia-canvas').first().getAttribute('class') || '',
      /\blia-mode--textbook\b/)
    assert.equal(await frame.locator('.monaco-editor,#liascript-preview').count(), 0)
    assert.ok(await frame.locator('#lia-toolbar-nav,header.lia-header').count() > 0)
    assert.ok(await frame.locator('lia-toc,.lia-toc').count() > 0)
    check('Official LiaScript Presentation course view', frame.url())

    const source = decodeOfficialDataCourse(frame.url())
    assert.equal(count(source.body, /# BROWSER_TASK_\d+/g), 4)
    assert.equal(count(source.body, /@ADetails\(/g), 13)
    assert.equal(count(source.body, /\[\[\?\]\] @Explain/g), 13)
    assert.equal(count(source.body, /^``` ascii$/gm), 4)
    assert.match(source.body, /\[\[\s*browser-1\s*\]\]\s+@canvas/)
    assert.equal(count(source.body, /@Lernpfad/g), 1)
    assert.match(source.body, /lernpfad-level:\s*Einsteiger/)
    assert.match(source.body, /^tags:\s*Mathematik, Klasse 7, Gymnasium$/m)
    assert.match(source.body, /points=0;tags=Grundrechenarten, Browser-Tag/)
    assert.match(source.body, /points=1,5;tags=Grundrechenarten, Browser-Tag/)
    assert.match(source.body, /# Dein weiterer Lernpfad/)
    assert.match(source.body, /^# Weitere Übungen: Grundrechenarten$/m)
    assert.match(source.body,
      /> Hier findest du vier weitere Aufgaben zum gleichen Thema auf deinem bisherigen Schwierigkeitsniveau\./)
    assert.match(source.body, /> \[!CAUTION\]\n> <h2>\[Tutorial öffnen\]\(https:\/\/liascript\.github\.io\/course\/\?https:\/\/raw\.githubusercontent\.com\/MINT-the-GAP\/Aufgabensammlung\/refs\/heads\/main\/Repetitorium\/Erklaerungen\/00_00_00_Tutorial\.md\)<\/h2>/)
    const intro = source.body.slice(0, source.body.indexOf('# BROWSER_TASK_'))
    assert.equal(count(intro, /^---$/gm), 8)
    assert.equal(count(source.body,
      /^import:\s+https:\/\/raw\.githubusercontent\.com\/MINT-the-GAP\/lia-mathpath\/refs\/heads\/master\/README\.md\?v=0\.0\.20$/gm), 1)
    assert.deepEqual(
      source.body.match(/^comment:.*$/gm),
      ['comment: Übe das Thema „Grundrechenarten“ auf deinem bisherigen Niveau weiter und gewinne mehr Sicherheit.']
    )
    assert.doesNotMatch(source.body, /Technische Browser-Aufgabe/)
    assert.doesNotMatch(source.body, /lia-freeze|FreezeREADME|@Abgabe|@Auswertung/i)
    assert.equal(count(source.body, /^mode:\s*Presentation$/gm), 1)
    assert.doesNotMatch(source.body, /^mode:\s*Textbook$/m)
    check('Complete generated Markdown through official gzip data URI', {
      uri: source.uri, characters: source.body.length
    })

    await expect.poll(async () =>
      (await adetailsSnapshot(frame)).badges.some(text => /0\s*BE/i.test(text))
    ).toBe(true)
    const details = await adetailsSnapshot(frame)
    assert.ok(details.markers >= 1)
    check('Standalone zero-point ADetails', details)

    const explain = frame.locator(
      'lia-mathpath-explain[data-lia-explain-topic=Tutorial]').first()
    await expect(explain.locator('.lia-mathpath-explain-link')).toBeVisible()
    await explain.locator('.lia-mathpath-explain-link').click()
    const overlay = frame.locator('.lia-mathpath-explain-overlay')
    await expect(overlay).toHaveAttribute('data-open', '1')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('.lia-mathpath-explain-frame'))
      .toHaveAttribute('src', /00_00_00_Tutorial\.md/)
    await overlay.locator('.lia-mathpath-explain-close').click()
    check('Explain opens from generated task')

    const generatedQuiz = frame.locator('.lia-quiz').first()
    await frame.locator('input.lia-quiz__input').first().fill('falsch')
    await generatedQuiz.locator('.lia-quiz__check').click()
    await expect(generatedQuiz.locator('.text-error').first()).toBeVisible()

    const closingSlide = await findLearningPathSlide(frame)
    const generatedHost = frame.locator(hostSelector)
    const generatedReport = await recommend(generatedHost)
    assert.equal(generatedReport.courseUrl, source.uri)
    assert.deepEqual(generatedReport.statusCounts, {
      correct: 0, wrong: 1, partial: 0, unanswered: 12, unavailable: 0
    })
    assert.deepEqual(generatedReport.warnings, [])
    assert.equal(generatedReport.topics.find(item =>
      item.topic === 'Grundrechenarten')?.taskCount, 13)
    const apiReport = await frame.evaluate(() =>
      window.__LIA_MATHPATH__.getLearningRecommendations())
    assert.equal(apiReport.courseUrl, source.uri)
    assert.deepEqual(apiReport.statusCounts, generatedReport.statusCounts)
    assert.deepEqual(apiReport.warnings, [])
    const databaseNames = await frame.evaluate(async () =>
      (await indexedDB.databases()).map(entry => entry.name))
    assert.ok(databaseNames.includes(source.uri))
    check('Closing @Lernpfad reads data source and IndexedDB', {
      slide: closingSlide, statusCounts: generatedReport.statusCounts, database: source.uri
    })

    await popup.reload({ waitUntil: 'domcontentloaded', timeout })
    await expect(frame.locator(hostSelector).first()).toBeVisible()
    const restoredSlide = await findLearningPathSlide(frame)
    const restoredReport = await recommend(frame.locator(hostSelector))
    assert.equal(restoredReport.courseUrl, source.uri)
    assert.deepEqual(restoredReport.statusCounts, generatedReport.statusCounts)
    assert.deepEqual(restoredReport.warnings, [])
    check('Generated result survives a full course reload', {
      slide: restoredSlide, statusCounts: restoredReport.statusCounts
    })

    await navigate(page, 2)
    await expect(page.locator('input.lia-quiz__input').first()).toHaveValue('falsch')
    assert.equal(await page.locator('.lia-quiz').first().evaluate(node => node.outerHTML),
      originalQuizMarkup)
    check('Origin course and native quiz remain intact')

    const shared = ['course.html', 'assets/course-source.js',
      'assets/course-generator.js', 'assets/course-catalog.js', 'assets/course-player.js',
      'assets/vendor/fflate-0.8.2.min.js']
      .map(name => pagesBase + name)
    assert.deepEqual(shared.filter(url => !result.served[url]), [])
    assert.equal(Object.keys(result.taskFetches).length, 4)
    assert.ok(Object.values(result.taskFetches).every(value => value >= 2))
    assert.equal(result.served[pagesBase + 'course-frame.html'] || 0, 0)
    check('Shared local assets exercised at production URLs')
    assert.deepEqual(result.errors, [])
    assert.ok(!result.consoleErrors.some(value =>
      /created_by_elm|virtualdom|virtual-dom/i.test(value)))
    check('No page or Elm ownership errors')
    result.ok = true
  } catch (error) {
    result.failure = { message: error.message, stack: error.stack }
  } finally {
    await context.close()
    await browser.close()
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exitCode = result.ok ? 0 : 1
}

await run()
