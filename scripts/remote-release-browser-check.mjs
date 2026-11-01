#!/usr/bin/env node

// Post-deployment smoke test. Unlike the local browser regressions this file
// deliberately installs no Playwright routes and serves no repository files.
// It therefore succeeds only after the complete release is available remotely.
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'fflate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = process.env.MATHPATH_RELEASE_VERSION || '0.0.21'
const viewer = process.env.MATHPATH_VIEWER_URL ||
  'https://liascript.github.io/course/'
const timeout = Number(process.env.MATHPATH_BROWSER_TIMEOUT || 90_000)
const readmeUrl = process.env.MATHPATH_REMOTE_README_URL ||
  `https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md?v=${release}`
const versionToken = release.replaceAll('.', 'x')
const expectedBundleReference = `./dist/index.v${versionToken}.js`
const expectedBundleUrl = new URL(expectedBundleReference, readmeUrl).toString()
const expectedBundleRequestUrl = new URL(expectedBundleUrl)
expectedBundleRequestUrl.searchParams.set('v', release)
const dataCoursePrefix =
  'data:text/plain;charset=utf-8;Content-Encoding=gzip;base64,'
const { chromium, expect: baseExpect } =
  createRequire(path.join(root, 'package.json'))('@playwright/test')
const expect = baseExpect.configure({ timeout })

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:/Program Files',
          'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)',
          'Google/Chrome/Application/chrome.exe')
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

async function remoteText(url, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/plain,*/*;q=0.8' }
    })
    assert.equal(response.ok, true,
      `${label} is not deployed (${response.status} ${response.statusText}): ${url}`)
    return {
      body: await response.text(),
      contentType: response.headers.get('content-type') || '',
      finalUrl: response.url,
      status: response.status
    }
  } finally {
    clearTimeout(timer)
  }
}

function templateHeader(markdown) {
  const open = markdown.indexOf('<!--')
  const close = markdown.indexOf('\n-->')
  assert.equal(open, 0, 'The deployed README must start with its LiaScript header')
  assert.ok(close > open, 'The deployed README has no complete LiaScript header')
  return markdown.slice(open + 4, close)
}

function releaseCourseSource() {
  const ordinary = Array.from({ length: 8 }, (_, offset) => {
    const number = offset + 1
    return [
      `Aufgabe ${number}: [[ ${number} ]]`, '',
      '@ADetails(1=BE; Grundrechenarten, Native Aufgabe)', ''
    ]
  }).flat()
  const asciiTask = (value, label) => [
    '``` ascii',
    '+---------------------------+---------------------------+',
    `| " [[ ${value} ]] " | " [[ ${value + 1} ]] " |`,
    '+---------------------------+---------------------------+',
    '```', '',
    `@ADetails(1=BE; Grundrechenarten, ${label})`, ''
  ]

  return [
    '<!--',
    'author: MathPath Remote Release Smoke Test',
    'version: 1.0.0',
    'language: de',
    'mode: Presentation',
    'lernpfad-level: Einsteiger',
    `import: ${readmeUrl}`,
    '@canvas: <span data-remote-release-canvas="1"></span>',
    '-->', '',
    '# Remote-Release: Canvas und ADetails', '',
    'Das Stadion besitzt insgesamt [[ 10800 ]] Sitzplätze. @canvas', '',
    '@ADetails(1=BE; Grundrechenarten, Sachaufgabe)', '',
    '## Acht native Aufgaben', '',
    ...ordinary,
    '## Zwei ASCII-Aufgaben A', '',
    ...asciiTask(24, 'ASCII-A1'),
    ...asciiTask(30, 'ASCII-A2'),
    '## Zwei ASCII-Aufgaben B', '',
    ...asciiTask(12, 'ASCII-B1'),
    ...asciiTask(18, 'ASCII-B2'),
    '## Lernpfad', '',
    '@Lernpfad', ''
  ].join('\n')
}

function gzipCourse(markdown) {
  const bytes = gzipSync(Buffer.from(markdown, 'utf8'), {
    level: 6,
    mem: 8,
    mtime: 0
  })
  return dataCoursePrefix + Buffer.from(bytes).toString('base64')
}

function decodeOfficialDataCourse(url) {
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://liascript.github.io')
  assert.equal(parsed.pathname, '/course/')
  const uri = parsed.search.slice(1)
  assert.ok(uri.startsWith(dataCoursePrefix), 'Generated course is not a LiaScript gzip data URI')
  const bytes = Buffer.from(uri.slice(dataCoursePrefix.length), 'base64')
  return {
    uri,
    body: Buffer.from(gunzipSync(bytes)).toString('utf8')
  }
}

async function adetailsStyle(page) {
  await page.waitForFunction(() => {
    const walk = root => {
      const badge = root.querySelector?.('.lia-mathpath-adetails-points')
      if (badge && badge.getBoundingClientRect().width > 0) return badge
      for (const node of root.querySelectorAll?.('*') || []) {
        if (node.shadowRoot) {
          const nested = walk(node.shadowRoot)
          if (nested) return nested
        }
      }
      return null
    }
    return Boolean(walk(document))
  })
  return page.evaluate(() => {
    const walk = root => {
      const badge = root.querySelector?.('.lia-mathpath-adetails-points')
      if (badge && badge.getBoundingClientRect().width > 0) return badge
      for (const node of root.querySelectorAll?.('*') || []) {
        if (node.shadowRoot) {
          const nested = walk(node.shadowRoot)
          if (nested) return nested
        }
      }
      return null
    }
    const badge = walk(document)
    if (!badge) return null
    const style = getComputedStyle(badge)
    return {
      text: badge.textContent?.trim() || '',
      display: style.display,
      fontWeight: style.fontWeight,
      borderTopWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      backgroundColor: style.backgroundColor
    }
  })
}

async function navigate(page, slide) {
  await page.evaluate(value => { location.hash = '#' + value }, slide)
  await page.waitForFunction(value => location.hash === '#' + value, slide)
}

async function findLearningPathSlide(page, maximum = 30) {
  for (let slide = 1; slide <= maximum; slide++) {
    await navigate(page, slide)
    if (await page.locator('lia-mathpath-lernpfad').count()) return slide
  }
  throw new Error(`Generated course has no @Lernpfad slide within ${maximum} slides`)
}

async function run() {
  const report = {
    ok: false,
    release,
    readmeUrl,
    expectedBundleUrl,
    expectedBundleRequestUrl: expectedBundleRequestUrl.toString(),
    viewer,
    checks: [],
    requests: [],
    responses: [],
    pageErrors: []
  }
  const check = (label, details) => report.checks.push({ label, details })
  let browser
  let context
  try {
    const deployedReadme = await remoteText(readmeUrl, 'MathPath README')
    const header = templateHeader(deployedReadme.body)
    const versionLines = [...header.matchAll(/^version:\s*(\S+)\s*$/gm)]
      .map(match => match[1])
    const scriptLines = [...header.matchAll(/^script:\s*(\S+)\s*$/gm)]
      .map(match => match[1])
    assert.deepEqual(versionLines, [release],
      `The deployed template header must declare exactly version ${release}`)
    assert.deepEqual(scriptLines, [expectedBundleReference],
      `The deployed template must load ${expectedBundleReference}`)
    check('Remote README declares the release and versioned bundle', {
      status: deployedReadme.status,
      finalUrl: deployedReadme.finalUrl,
      version: versionLines[0],
      script: scriptLines[0]
    })

    const deployedBundle = await remoteText(expectedBundleUrl,
      'Versioned MathPath bundle')
    assert.match(deployedBundle.body, /__LIA_MATHPATH__/,
      'The deployed bundle does not contain the public MathPath API')
    check('Versioned bundle is independently reachable', {
      status: deployedBundle.status,
      finalUrl: deployedBundle.finalUrl,
      contentType: deployedBundle.contentType,
      bytes: Buffer.byteLength(deployedBundle.body)
    })

    const courseUri = gzipCourse(releaseCourseSource())
    assert.ok(courseUri.length < 64 * 1024,
      'The smoke-test course exceeds MathPath\'s supported data-URI limit')
    const executablePath = await chromePath()
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {})
    })
    report.browser = browser.version()
    // This is intentionally a normal remote context. In particular, there is
    // no page.route/context.route and no local response fulfillment.
    context = await browser.newContext({
      viewport: { width: 1360, height: 960 },
      locale: 'de-DE'
    })
    context.setDefaultTimeout(timeout)
    const page = await context.newPage()
    page.on('request', request => {
      const url = request.url()
      if (url.includes('/MINT-the-GAP/lia-mathpath/')) report.requests.push(url)
    })
    page.on('response', response => {
      const url = response.url()
      if (url.includes('/MINT-the-GAP/lia-mathpath/')) {
        report.responses.push({
          url,
          status: response.status(),
          fromServiceWorker: response.fromServiceWorker()
        })
      }
    })
    page.on('pageerror', error => report.pageErrors.push(String(error)))

    await page.goto(`${viewer}?${courseUri}#1`, {
      waitUntil: 'domcontentloaded',
      timeout
    })
    await page.waitForFunction(() =>
      typeof window.__LIA_MATHPATH__?.getLearningRecommendations === 'function')

    const style = await adetailsStyle(page)
    assert.ok(style, 'Standalone @ADetails did not render a visible points label')
    assert.equal(style.text, '1 BE')
    assert.equal(style.display, 'inline-flex')
    assert.match(style.fontWeight, /^(?:700|bold)$/)
    assert.equal(style.borderTopWidth, '0px')
    assert.equal(style.borderRadius, '0px')
    assert.equal(style.paddingTop, '0px')
    assert.equal(style.paddingRight, '0px')
    assert.equal(style.paddingBottom, '0px')
    assert.equal(style.paddingLeft, '0px')
    assert.ok(['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor),
      `Standalone @ADetails has a pill background: ${style.backgroundColor}`)
    check('Standalone @ADetails uses text-only LiaScript styling', style)

    await navigate(page, 5)
    const host = page.locator('lia-mathpath-lernpfad')
    await expect(host).toHaveCount(1)
    await expect(host.locator('section[data-offer]')).toHaveCount(3)
    await expect.poll(() => host.evaluate(element => element.report)).not.toBe(null)
    const learningReport = await host.evaluate(element => element.report)
    assert.ok(learningReport, '@Lernpfad did not expose its structured report')
    assert.equal(learningReport.courseUrl, courseUri)
    assert.deepEqual(learningReport.statusCounts, {
      correct: 0,
      wrong: 0,
      partial: 0,
      unanswered: 13,
      unavailable: 0
    })
    assert.deepEqual(learningReport.warnings, [])
    assert.equal(learningReport.topics.find(item =>
      item.topic === 'Grundrechenarten')?.taskCount, 13)
    assert.equal((await host.locator('.warnings').textContent())?.trim(), '')
    check('Remote @Lernpfad maps all 13 tasks without warnings', {
      phase: learningReport.phase,
      statusCounts: learningReport.statusCounts,
      warnings: learningReport.warnings,
      topicTaskCount: 13
    })

    const practice = host.locator('section[data-offer=practice]')
    const openCourse = practice.locator('button.open-course')
    await expect(openCourse).toBeEnabled()
    const popupPromise = context.waitForEvent('page')
    await openCourse.click()
    const generatedPage = await popupPromise
    generatedPage.setDefaultTimeout(timeout)
    generatedPage.on('pageerror', error => report.pageErrors.push(String(error)))
    await generatedPage.waitForURL(url =>
      url.origin === 'https://liascript.github.io' &&
      url.pathname === '/course/' &&
      url.search.startsWith(`?${dataCoursePrefix}`), { timeout })
    assert.equal(await generatedPage.evaluate(() => window.opener === null), true)
    await generatedPage.waitForFunction(() =>
      typeof window.__LIA_MATHPATH__?.getLearningRecommendations === 'function' &&
      typeof customElements.get('lia-mathpath-lernpfad') === 'function')

    const generated = decodeOfficialDataCourse(generatedPage.url())
    const generatedImports = generated.body.split(/\r?\n/)
      .filter(line => /^import: .*lia-mathpath.*README\.md/i.test(line))
    assert.deepEqual(generatedImports, [`import: ${readmeUrl}`])
    assert.equal((generated.body.match(/^mode:\s*Presentation$/gm) || []).length, 1)
    assert.doesNotMatch(generated.body, /^mode:\s*Textbook$/m)
    assert.doesNotMatch(generated.body, /lia-freeze|FreezeREADME|@Abgabe|@Auswertung/i)
    assert.equal((generated.body.match(/^@Lernpfad$/gm) || []).length, 1)

    const generatedSlide = await findLearningPathSlide(generatedPage)
    const generatedHost = generatedPage.locator('lia-mathpath-lernpfad')
    await expect(generatedHost.locator('section[data-offer]')).toHaveCount(3)
    await expect.poll(() => generatedHost.evaluate(element => element.report)).not.toBe(null)
    const generatedState = await generatedHost.evaluate(element => ({
      report: element.report,
      summary: element.shadowRoot?.querySelector('.summary')?.textContent?.trim() || '',
      summaryState: element.shadowRoot?.querySelector('.summary')?.getAttribute('data-state') || ''
    }))
    assert.ok(generatedState.report,
      `Generated @Lernpfad failed: ${JSON.stringify(generatedState)}`)
    await expect(generatedHost.locator('section[data-offer]')).toHaveCount(3)
    const generatedReport = generatedState.report
    assert.equal(generatedReport.statusCounts.unavailable, 0)
    assert.deepEqual(generatedReport.warnings, [])
    assert.ok(generatedReport.statusCounts.unanswered >= 4)
    assert.equal((await generatedHost.locator('.warnings').textContent())?.trim(), '')
    check('Public generator opens a Presentation course with one pinned import and no warnings', {
      slide: generatedSlide,
      characters: generated.body.length,
      imports: generatedImports,
      statusCounts: generatedReport.statusCounts,
      warnings: generatedReport.warnings
    })
    await generatedPage.close()

    const bundleResponses = report.responses.filter(response =>
      response.url === expectedBundleRequestUrl.toString())
    assert.ok(report.requests.includes(readmeUrl),
      `The browser did not request the versioned README URL: ${readmeUrl}`)
    assert.ok(bundleResponses.some(response => response.status >= 200 &&
      response.status < 300),
      `The browser did not load the deployed versioned bundle: ${expectedBundleRequestUrl}`)
    assert.equal(report.requests.some(url =>
      /\/dist\/index\.js(?:[?#]|$)/.test(url)), false,
      'The browser unexpectedly requested the mutable unversioned dist/index.js')
    check('Official viewer loaded only the versioned MathPath release asset', {
      readmeRequest: readmeUrl,
      bundleResponses
    })

    assert.deepEqual(report.pageErrors, [])
    report.ok = true
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack }
  } finally {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.ok ? 0 : 1
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/remote-release-browser-check.mjs',
    '',
    'Runs a post-deployment browser check without local request overrides.',
    'Environment: MATHPATH_RELEASE_VERSION, MATHPATH_REMOTE_README_URL,',
    '             MATHPATH_VIEWER_URL, MATHPATH_BROWSER_TIMEOUT, CHROME_PATH',
    ''
  ].join('\n'))
} else {
  await run()
}
