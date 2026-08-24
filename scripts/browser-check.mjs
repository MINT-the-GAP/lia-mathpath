#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_URL =
  'https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md'
const IMPORT_CONSUMER_URL =
  'https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/test/fixtures/import-consumer.md'
const DEFAULT_TIMEOUT_MS = 45_000
const TUTORIAL_URL =
  'https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/Aufgabensammlung/refs/heads/main/Repetitorium/Erklaerungen/00_00_00_Tutorial.md'
const TUTORIAL_TEXT =
  'Das Tutorial zeigt dir die wichtigsten LiaScript-Funktionen mit kurzen Erklärungen und GIFs.'
const EXPECTED_TERMS = [
  { display: 'Bruch', canonical: 'Bruch' },
  { display: 'Zähler', canonical: 'Zähler' },
  { display: 'Nenner', canonical: 'Nenner' },
  { display: 'Brüche', canonical: 'Bruch' }
]
const PLAIN_TERM = {
  display: 'Division',
  canonical: 'Division',
  fixtureText: 'Die Division ist hier absichtlich normal und nicht kursiv geschrieben.'
}
const TOOLTIP_OFF_HEADING = 'Automatische Tooltips ausschalten'
const TOOLTIP_ON_HEADING = 'Automatische Tooltips wieder einschalten'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')

const result = {
  ok: false,
  mode: 'local-overrides',
  url: DEFAULT_URL,
  startedAt: new Date().toISOString(),
  durationMs: 0,
  environment: {
    node: process.version,
    platform: process.platform,
    chromePath: null,
    browser: null,
    protocolVersion: null
  },
  overrides: {
    enabled: true,
    files: {},
    served: {
      'README.md': 0,
      'dist/index.js': 0,
      'Glossar.md': 0,
      'Explain.md': 0
    },
    requests: [],
    errors: []
  },
  slidesVisited: [],
  checks: [],
  diagnostics: {
    runtimeExceptions: [],
    consoleErrors: [],
    consoleWarnings: [],
    logErrors: [],
    logWarnings: [],
    networkFailures: [],
    httpErrors: [],
    pageCrashes: [],
    cdpHandlerErrors: []
  },
  cleanup: {
    browserStopped: false,
    profileRemoved: false
  },
  fatalError: null
}

let chromeProcess = null
let cdp = null
let profileDirectory = null
let cleanupPromise = null
let outputWritten = false
const chromeStderr = []

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorDetails(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null
    }
  }
  return { name: 'Error', message: String(error), stack: null }
}

function pushLimited(target, value, limit = 100) {
  if (target.length < limit) target.push(value)
}

function addCheck(name, ok, details = {}) {
  const check = { name, ok: Boolean(ok), details }
  result.checks.push(check)
  return check.ok
}

function rgbChannels(value) {
  const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number) || []
  return channels.length === 3 && channels.every(Number.isFinite) ? channels : null
}

function relativeLuminance(channels) {
  const linear = channels.map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function colorContrast(first, second) {
  const firstChannels = rgbChannels(first)
  const secondChannels = rgbChannels(second)
  if (!firstChannels || !secondChannels) return 0
  const firstLuminance = relativeLuminance(firstChannels)
  const secondLuminance = relativeLuminance(secondChannels)
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
}

function sameRgb(first, second) {
  const firstChannels = rgbChannels(first)
  const secondChannels = rgbChannels(second)
  return Boolean(firstChannels && secondChannels &&
    firstChannels.every((channel, index) => channel === secondChannels[index]))
}

function explainThemeFailures(snapshot) {
  const failures = []
  if (!snapshot?.overlayOpen) failures.push('overlay is not open')
  if (!snapshot?.close) return [...failures, 'close button is missing']
  if (snapshot.close.text !== 'Schlie\u00dfen') failures.push(`close text is ${snapshot.close.text || 'empty'}`)
  if (snapshot.close.width <= 0 || snapshot.close.height <= 0) failures.push('close button has no rendered size')
  if (!snapshot.close.hitTarget) failures.push('close button is not hit-testable')
  const contrast = colorContrast(snapshot.close.color, snapshot.close.backgroundColor)
  if (contrast < 4.5) failures.push(`close button contrast is ${contrast.toFixed(2)}`)
  if (!sameRgb(snapshot.dialog?.backgroundColor, snapshot.variables.surface)) {
    failures.push('dialog does not use the synchronized course surface')
  }
  if (!sameRgb(snapshot.header?.backgroundColor, snapshot.variables.surface)) {
    failures.push('header does not use the synchronized course surface')
  }
  if (!sameRgb(snapshot.frame?.backgroundColor, snapshot.variables.surface)) {
    failures.push('frame does not use the synchronized course surface')
  }
  return failures
}

function parseArguments(argv) {
  const options = {
    remote: false,
    consumerImport: false,
    url: null,
    chromePath: process.env.CHROME_PATH || null,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--remote') {
      options.remote = true
      continue
    }
    if (argument === '--consumer-import') {
      options.consumerImport = true
      continue
    }
    if (argument === '--url' || argument === '--chrome' || argument === '--timeout-ms') {
      const value = argv[index + 1]
      if (!value) throw new Error(`Missing value for ${argument}`)
      index += 1
      if (argument === '--url') options.url = value
      if (argument === '--chrome') options.chromePath = value
      if (argument === '--timeout-ms') options.timeoutMs = Number(value)
      continue
    }
    if (argument.startsWith('--url=')) {
      options.url = argument.slice('--url='.length)
      continue
    }
    if (argument.startsWith('--chrome=')) {
      options.chromePath = argument.slice('--chrome='.length)
      continue
    }
    if (argument.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(argument.slice('--timeout-ms='.length))
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 5_000) {
    throw new Error('--timeout-ms must be a number of at least 5000')
  }
  if (!options.url) {
    options.url = options.consumerImport ? IMPORT_CONSUMER_URL : DEFAULT_URL
  }
  new URL(options.url)
  return options
}

async function isExecutable(candidate) {
  if (!candidate) return false
  try {
    await access(candidate, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function executableFromPath(names) {
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : ['']

  for (const entry of pathEntries) {
    for (const name of names) {
      for (const extension of extensions) {
        const candidate = path.join(entry, name.endsWith(extension) ? name : `${name}${extension}`)
        if (await isExecutable(candidate)) return candidate
      }
    }
  }
  return null
}

async function findChrome(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath)
    if (!(await isExecutable(resolved))) {
      throw new Error(`Chrome executable does not exist: ${resolved}`)
    }
    return resolved
  }

  const candidates = []
  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    )
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  } else {
    const fromPath = await executableFromPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'])
    if (fromPath) candidates.push(fromPath)
  }

  for (const candidate of candidates) {
    if (candidate && await isExecutable(candidate)) return candidate
  }
  throw new Error('Google Chrome was not found. Set CHROME_PATH or pass --chrome <path>.')
}

function assertSafeTemporaryPath(directory) {
  const temporaryRoot = path.resolve(os.tmpdir())
  const resolvedDirectory = path.resolve(directory)
  const relative = path.relative(temporaryRoot, resolvedDirectory)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to use unsafe profile directory: ${resolvedDirectory}`)
  }
}

function appendChromeStderr(chunk) {
  const text = String(chunk)
  chromeStderr.push(text)
  let total = chromeStderr.reduce((sum, item) => sum + item.length, 0)
  while (total > 50_000 && chromeStderr.length > 1) {
    total -= chromeStderr.shift().length
  }
}

async function waitForDevTools(directory, child, timeoutMs) {
  const activePortFile = path.join(directory, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready (exit ${child.exitCode})`)
    }
    try {
      const contents = await readFile(activePortFile, 'utf8')
      const [portLine] = contents.trim().split(/\r?\n/)
      const port = Number(portLine)
      if (Number.isInteger(port) && port > 0) {
        const endpoint = `http://127.0.0.1:${port}`
        const response = await fetch(`${endpoint}/json/version`, {
          signal: AbortSignal.timeout(2_000)
        })
        if (response.ok) return { endpoint, version: await response.json() }
      }
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }

  const suffix = lastError ? `: ${lastError.message}` : ''
  throw new Error(`Timed out waiting for Chrome DevTools${suffix}`)
}

async function waitForPageTarget(endpoint, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/list`, {
        signal: AbortSignal.timeout(2_000)
      })
      const targets = await response.json()
      const page = targets.find(target => target.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }

  const suffix = lastError ? `: ${lastError.message}` : ''
  throw new Error(`Timed out waiting for a Chrome page target${suffix}`)
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.closed = false

    socket.addEventListener('message', event => this.handleMessage(event.data))
    socket.addEventListener('close', () => this.handleClose(new Error('CDP WebSocket closed')))
    socket.addEventListener('error', () => this.handleClose(new Error('CDP WebSocket failed')))
  }

  static async connect(webSocketUrl, timeoutMs = 10_000) {
    if (typeof WebSocket !== 'function') {
      throw new Error('This checker requires Node 24 with the global WebSocket API.')
    }
    const socket = new WebSocket(webSocketUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out opening CDP WebSocket')), timeoutMs)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Could not open CDP WebSocket'))
      }, { once: true })
    })
    return new CdpConnection(socket)
  }

  handleMessage(data) {
    let text
    if (typeof data === 'string') text = data
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString('utf8')
    else if (ArrayBuffer.isView(data)) text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
    else text = String(data)

    let message
    try {
      message = JSON.parse(text)
    } catch (error) {
      pushLimited(result.diagnostics.cdpHandlerErrors, errorDetails(error))
      return
    }

    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`))
      else pending.resolve(message.result)
      return
    }

    const handlers = this.handlers.get(message.method) || []
    for (const handler of handlers) {
      Promise.resolve(handler(message.params || {})).catch(error => {
        pushLimited(result.diagnostics.cdpHandlerErrors, {
          method: message.method,
          ...errorDetails(error)
        })
      })
    }
  }

  handleClose(error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
  }

  send(method, params = {}, timeoutMs = 15_000) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}: CDP connection is closed`))
    }
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP command timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    if (!this.closed) {
      this.closed = true
      try {
        this.socket.close()
      } catch {
        // Chrome may already have closed the socket.
      }
    }
  }
}

function remoteObjectValue(object) {
  if (!object) return null
  if (Object.prototype.hasOwnProperty.call(object, 'value')) return object.value
  return object.description || object.unserializableValue || object.type || null
}

function installDiagnosticHandlers(connection) {
  connection.on('Runtime.exceptionThrown', params => {
    const details = params.exceptionDetails || {}
    pushLimited(result.diagnostics.runtimeExceptions, {
      text: details.text || null,
      description: details.exception?.description || null,
      url: details.url || null,
      lineNumber: details.lineNumber ?? null,
      columnNumber: details.columnNumber ?? null
    })
  })

  connection.on('Runtime.consoleAPICalled', params => {
    const entry = {
      type: params.type,
      values: (params.args || []).map(remoteObjectValue),
      timestamp: params.timestamp || null
    }
    if (params.type === 'error' || params.type === 'assert') {
      pushLimited(result.diagnostics.consoleErrors, entry)
    } else if (params.type === 'warning') {
      pushLimited(result.diagnostics.consoleWarnings, entry)
    }
  })

  connection.on('Log.entryAdded', params => {
    const entry = params.entry || {}
    const value = {
      source: entry.source || null,
      level: entry.level || null,
      text: entry.text || null,
      url: entry.url || null,
      lineNumber: entry.lineNumber ?? null
    }
    if (entry.level === 'error') pushLimited(result.diagnostics.logErrors, value)
    if (entry.level === 'warning') pushLimited(result.diagnostics.logWarnings, value)
  })

  connection.on('Network.loadingFailed', params => {
    pushLimited(result.diagnostics.networkFailures, {
      requestId: params.requestId,
      errorText: params.errorText || null,
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason || null,
      type: params.type || null
    })
  })

  connection.on('Network.responseReceived', params => {
    const response = params.response || {}
    if (Number(response.status) >= 400) {
      pushLimited(result.diagnostics.httpErrors, {
        status: response.status,
        statusText: response.statusText || null,
        url: response.url || null,
        type: params.type || null
      })
    }
  })

  connection.on('Inspector.targetCrashed', params => {
    pushLimited(result.diagnostics.pageCrashes, params)
  })
}

async function loadOverrideFiles(includeImportConsumer = false) {
  const definitions = [
    ['README.md', path.join(repositoryRoot, 'README.md'), 'text/markdown; charset=utf-8'],
    ['dist/index.js', path.join(repositoryRoot, 'dist', 'index.js'), 'application/javascript; charset=utf-8'],
    ['Glossar.md', path.join(repositoryRoot, 'Glossar.md'), 'text/markdown; charset=utf-8'],
    ['Explain.md', path.join(repositoryRoot, 'Explain.md'), 'text/markdown; charset=utf-8']
  ]
  if (includeImportConsumer) {
    definitions.push([
      'import-consumer.md',
      path.join(repositoryRoot, 'test', 'fixtures', 'import-consumer.md'),
      'text/markdown; charset=utf-8'
    ])
  }
  const overrides = new Map()

  for (const [name, filename, contentType] of definitions) {
    const body = await readFile(filename)
    overrides.set(name, { name, filename, contentType, body })
    result.overrides.served[name] ??= 0
    result.overrides.files[name] = { path: filename, bytes: body.byteLength }
  }
  return overrides
}

function overrideNameForUrl(requestUrl) {
  let parsed
  try {
    parsed = new URL(requestUrl)
  } catch {
    return null
  }

  let pathname = parsed.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // Keep the original pathname if percent decoding fails.
  }
  const lower = pathname.toLowerCase()
  if (!lower.includes('/mint-the-gap/lia-mathpath')) return null
  if (/\/test\/fixtures\/import-consumer\.md$/i.test(pathname)) return 'import-consumer.md'
  if (/\/readme\.md$/i.test(pathname)) return 'README.md'
  if (/\/dist\/index\.js$/i.test(pathname)) return 'dist/index.js'
  if (/\/glossar\.md$/i.test(pathname)) return 'Glossar.md'
  if (/\/explain\.md$/i.test(pathname)) return 'Explain.md'
  return null
}

function installFetchOverrides(connection, overrides) {
  connection.on('Fetch.requestPaused', async params => {
    const request = params.request || {}
    const name = overrideNameForUrl(request.url || '')
    const override = name ? overrides.get(name) : null

    if (!override) {
      await connection.send('Fetch.continueRequest', { requestId: params.requestId })
      return
    }

    try {
      const isPreflight = request.method === 'OPTIONS'
      const headers = [
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Access-Control-Allow-Headers', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' },
        { name: 'Cache-Control', value: 'no-store' },
        { name: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        { name: 'Content-Type', value: override.contentType }
      ]
      const body = isPreflight || request.method === 'HEAD'
        ? ''
        : override.body.toString('base64')

      await connection.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: isPreflight ? 204 : 200,
        responsePhrase: isPreflight ? 'No Content' : 'OK',
        responseHeaders: headers,
        body
      })

      result.overrides.served[name] += 1
      pushLimited(result.overrides.requests, {
        name,
        method: request.method,
        resourceType: params.resourceType || null,
        url: request.url
      }, 30)
    } catch (error) {
      pushLimited(result.overrides.errors, {
        name,
        url: request.url,
        ...errorDetails(error)
      })
      try {
        await connection.send('Fetch.continueRequest', { requestId: params.requestId })
      } catch {
        // The request may already have been resolved or Chrome may be closing.
      }
    }
  })
}

async function evaluate(expression, timeoutMs = 15_000) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, timeoutMs)

  if (response.exceptionDetails) {
    const details = response.exceptionDetails
    throw new Error(details.exception?.description || details.text || 'Runtime.evaluate failed')
  }
  return response.result?.value
}

async function waitForValue(probe, predicate, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs
  let lastValue = null
  let lastError = null

  while (Date.now() < deadline) {
    try {
      lastValue = await probe()
      if (predicate(lastValue)) return lastValue
    } catch (error) {
      lastError = error
    }
    await delay(intervalMs)
  }

  const error = new Error(lastError
    ? `Condition timed out: ${lastError.message}`
    : 'Condition timed out')
  error.lastValue = lastValue
  throw error
}

function inspectExampleInPage() {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
  const isRendered = element => {
    if (!(element instanceof Element)) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (Number(style.opacity) === 0) return false
    return element.getClientRects().length > 0
  }
  const isExcluded = element => Boolean(element.closest(
    'div.notip, pre, code, kbd, samp, script, style, textarea, svg, canvas, .katex, .lia-mathpath-tooltip, .lia-mathpath-no-glossary'
  ))
  const describe = element => {
    if (!element) return null
    return {
      tagName: element.tagName,
      text: normalize(element.textContent),
      dataTerm: element.getAttribute('data-lia-term'),
      classes: Array.from(element.classList),
      bound: element.getAttribute('data-lia-mathpath-bound'),
      attributes: Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]),
      childNodes: Array.from(element.childNodes).map(child => ({
        type: child.nodeType,
        name: child.nodeName,
        text: child.textContent
      }))
    }
  }

  const expected = [
    ['Bruch', 'Bruch'],
    ['Zähler', 'Zähler'],
    ['Nenner', 'Nenner'],
    ['Brüche', 'Bruch']
  ]
  const terms = {}
  for (const [display, canonical] of expected) {
    const candidates = Array.from(document.querySelectorAll('em')).filter(element =>
      isRendered(element) && !isExcluded(element) && normalize(element.textContent) === display
    )
    const selected = candidates.find(element =>
      element.getAttribute('data-lia-term') === canonical &&
      element.classList.contains('lia-mathpath-glossary-highlight')
    ) || candidates[0] || null
    terms[display] = {
      canonical,
      candidateCount: candidates.length,
      element: describe(selected)
    }
  }

  const notipCandidates = Array.from(document.querySelectorAll('div.notip em')).filter(element =>
    isRendered(element) && normalize(element.textContent) === 'Bruch'
  )
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isRendered)
    .map(element => normalize(element.textContent))
  const visibleTooltipCount = Array.from(document.querySelectorAll('.lia-mathpath-tooltip[data-open="1"]'))
    .filter(isRendered).length

  return {
    href: location.href,
    hash: location.hash,
    headings,
    found: expected.every(([display]) => terms[display].candidateCount > 0) && notipCandidates.length > 0,
    fingerprint: `${location.hash}|${headings.join('|')}|${normalize(document.body?.innerText).slice(0, 240)}`,
    terms,
    notip: {
      candidateCount: notipCandidates.length,
      element: describe(notipCandidates[0] || null),
      decoratedDescendants: notipCandidates[0]
        ? notipCandidates[0].querySelectorAll('[data-lia-term], .lia-mathpath-glossary-highlight, .lia-mathpath-term').length
        : null
    },
    nestedHighlights: document.querySelectorAll(
      '.lia-mathpath-glossary-highlight .lia-mathpath-glossary-highlight'
    ).length,
    tooltipElements: document.querySelectorAll('.lia-mathpath-tooltip').length,
    visibleTooltipCount
  }
}

function inspectManualExplainInPage() {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
  const isRendered = element => {
    if (!(element instanceof Element)) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (Number(style.opacity) === 0) return false
    return element.getClientRects().length > 0
  }
  const hosts = Array.from(document.querySelectorAll(
    'lia-mathpath-explain[data-lia-explain-topic="Tutorial"]'
  ))
  const host = hosts.find(isRendered) || null
  const link = host?.shadowRoot?.querySelector('.lia-mathpath-explain-link') || null
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isRendered)
    .map(element => normalize(element.textContent))
  const visibleText = normalize(document.body?.innerText)

  return {
    href: location.href,
    hash: location.hash,
    headings,
    fingerprint: `${location.hash}|${headings.join('|')}|${normalize(document.body?.innerText).slice(0, 240)}`,
    found: Boolean(host && link && isRendered(link)),
    topic: host?.getAttribute('data-lia-explain-topic') || null,
    outsideHintContext: host
      ? !host.closest('.lia-quiz, [data-hint], [data-hint-button]')
      : null,
    linkText: link ? normalize(link.textContent) : null,
    itemText: link ? normalize(link.closest('li')?.textContent) : null,
    linkHref: link?.getAttribute('data-lia-explain-href') || link?.getAttribute('href') || null,
    literalMacroVisible: visibleText.includes('@Explain(Tutorial)'),
    hostCount: hosts.length
  }
}

function inspectTooltipMacroSlideInPage(expectedHeading) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
  const isRendered = element => {
    if (!(element instanceof Element)) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (Number(style.opacity) === 0) return false
    return element.getClientRects().length > 0
  }
  const describe = element => {
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      tagName: element.tagName,
      text: normalize(element.textContent),
      dataTerm: element.getAttribute('data-lia-term'),
      automaticMarker: element.getAttribute('data-lia-mathpath-auto-term'),
      bound: element.getAttribute('data-lia-mathpath-bound'),
      classes: Array.from(element.classList),
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      cursor: style.cursor
    }
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isRendered)
    .map(element => normalize(element.textContent))
  const probes = Array.from(document.querySelectorAll('[data-tooltip-probe]')).filter(isRendered)
  const automatic = probes.find(element =>
    element.getAttribute('data-tooltip-probe') === 'automatic'
  ) || null
  const manual = probes.find(element =>
    element.getAttribute('data-tooltip-probe') === 'manual'
  ) || null

  const literalMacroTexts = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode()) !== null) {
    const parent = node.parentElement
    if (!parent || parent.closest(
      'pre, code, script, style, textarea, .lia-code, .lia-code-wrapper, .ace_editor, .ace_content, .ace_line, .ace_text-layer'
    )) continue
    if (!isRendered(parent)) continue
    const text = normalize(node.data)
    if (/@tooltip\s*\(\s*(?:off|on)\s*\)/i.test(text)) literalMacroTexts.push(text)
  }

  const api = window.__LIA_MATHPATH__
  let apiEnabled = null
  try {
    apiEnabled = typeof api?.tooltipsEnabled === 'function'
      ? api.tooltipsEnabled()
      : null
  } catch {
    apiEnabled = null
  }

  const registry = globalThis.CSS?.highlights
  const registryHas = name => Boolean(
    registry && typeof registry.has === 'function' && registry.has(name)
  )

  return {
    href: location.href,
    hash: location.hash,
    headings,
    found: headings.includes(expectedHeading) && Boolean(automatic),
    fingerprint: `${location.hash}|${headings.join('|')}|${normalize(document.body?.innerText).slice(0, 240)}`,
    apiEnabled,
    rootMode: document.documentElement.getAttribute('data-lia-mathpath-tooltips'),
    automatic: describe(automatic),
    manual: describe(manual),
    literalMacroTexts,
    glossaryRangeRegistered: registryHas('lia-mathpath-glossary'),
    hoverRangeRegistered: registryHas('lia-mathpath-glossary-hover'),
    rangeLayerCount: document.querySelectorAll('.lia-mathpath-range-layer').length,
    openTooltipCount: document.querySelectorAll('.lia-mathpath-tooltip[data-open="1"]').length
  }
}

function locateTooltipProbeInPage(kind) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
  const isRendered = element => {
    if (!(element instanceof Element)) return false
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' && Number(style.opacity) !== 0 &&
      element.getClientRects().length > 0
  }
  const element = Array.from(document.querySelectorAll('[data-tooltip-probe]')).find(candidate =>
    isRendered(candidate) && candidate.getAttribute('data-tooltip-probe') === kind
  )
  if (!element) return null

  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const rect = element.getBoundingClientRect()
  const x = Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2))
  const y = Math.max(1, Math.min(innerHeight - 2, rect.top + rect.height / 2))
  const hit = document.elementFromPoint(x, y)
  return {
    x,
    y,
    width: rect.width,
    height: rect.height,
    text: normalize(element.textContent),
    dataTerm: element.getAttribute('data-lia-term'),
    automaticMarker: element.getAttribute('data-lia-mathpath-auto-term'),
    hitTarget: hit === element || element.contains(hit),
    hitTag: hit?.tagName || null,
    hitText: normalize(hit?.textContent)
  }
}

function clickManualExplainInPage() {
  const host = Array.from(document.querySelectorAll(
    'lia-mathpath-explain[data-lia-explain-topic="Tutorial"]'
  )).find(element => element.getClientRects().length > 0)
  const link = host?.shadowRoot?.querySelector('.lia-mathpath-explain-link')
  if (!link) return { clicked: false }

  link.click()
  const overlay = document.querySelector('.lia-mathpath-explain-overlay')
  const frame = overlay?.querySelector('.lia-mathpath-explain-frame')
  return {
    clicked: true,
    open: overlay?.getAttribute('data-open') === '1',
    frameSrc: frame?.getAttribute('src') || null,
    bodyLocked: document.body.classList.contains('lia-mathpath-overlay-open')
  }
}

function inspectTutorialDynFlexInPage() {
  const frame = document.querySelector('.lia-mathpath-explain-frame')
  if (!(frame instanceof HTMLIFrameElement)) {
    return { frameFound: false, accessible: false }
  }

  try {
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) {
      return { frameFound: true, accessible: false }
    }

    const containers = Array.from(doc.querySelectorAll('.dynFlex'))
    const items = Array.from(doc.querySelectorAll('.dynFlex > .dynFlexItem'))
    const resizers = Array.from(doc.querySelectorAll(
      '.dynFlex > .dynFlexItem > .dynFlexResizer'
    ))
    const visibleContainers = containers.filter(container => {
      const style = win.getComputedStyle(container)
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 && container.getClientRects().length > 0
    })

    return {
      frameFound: true,
      accessible: true,
      href: win.location.href,
      readyState: doc.readyState,
      title: doc.title,
      containerCount: containers.length,
      visibleContainerCount: visibleContainers.length,
      flexDisplayCount: containers.filter(container =>
        win.getComputedStyle(container).display === 'flex'
      ).length,
      initializedContainerCount: containers.filter(container =>
        container.querySelector(':scope > .dynFlexItem')
      ).length,
      itemCount: items.length,
      resizerCount: resizers.length,
      boundResizerCount: resizers.filter(resizer =>
        resizer.getAttribute('data-bound') === '1'
      ).length,
      styleCount: doc.querySelectorAll('#lia-dynflex-style-v1-0').length,
      dynFlexDocumentKey: doc.documentElement.getAttribute('data-dynflex-doc')
    }
  } catch (error) {
    return {
      frameFound: true,
      accessible: false,
      error: String(error)
    }
  }
}

function installThemeRegressionButtonInPage() {
  const id = 'lia-mathpath-theme-regression-foreign-button'
  let button = document.getElementById(id)
  if (!button) {
    button = document.createElement('button')
    button.id = id
    button.type = 'button'
    button.textContent = 'Fremder Kursbutton'
    button.style.cssText = 'position:fixed;left:-10000px;top:-10000px;color:inherit;'
    document.body.prepend(button)
  }
  return {
    installed: true,
    firstButtonId: document.querySelector('button')?.id || null,
    color: getComputedStyle(button).color
  }
}

function inspectExplainThemeInPage() {
  const describe = element => {
    if (!element) return null
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const x = Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2))
    const y = Math.max(1, Math.min(innerHeight - 2, rect.top + rect.height / 2))
    const hit = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(x, y) : null
    return {
      text: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      webkitTextFillColor: style.webkitTextFillColor || null,
      width: rect.width,
      height: rect.height,
      hitTarget: hit === element || element.contains(hit)
    }
  }
  const root = document.documentElement
  const rootStyle = getComputedStyle(root)
  const bodyStyle = getComputedStyle(document.body)
  const overlay = document.querySelector('.lia-mathpath-explain-overlay')

  return {
    rootClass: root.className,
    variables: {
      accent: rootStyle.getPropertyValue('--lia-mathpath-accent-rgb').trim(),
      accentContrast: rootStyle.getPropertyValue('--lia-mathpath-accent-contrast-rgb').trim(),
      surface: rootStyle.getPropertyValue('--lia-mathpath-surface-rgb').trim(),
      text: rootStyle.getPropertyValue('--lia-mathpath-text-rgb').trim()
    },
    body: {
      backgroundColor: bodyStyle.backgroundColor,
      color: bodyStyle.color
    },
    overlayOpen: overlay?.getAttribute('data-open') === '1',
    dialog: describe(overlay?.querySelector('.lia-mathpath-explain-dialog')),
    header: describe(overlay?.querySelector('.lia-mathpath-explain-header')),
    close: describe(overlay?.querySelector('.lia-mathpath-explain-close')),
    frame: describe(overlay?.querySelector('.lia-mathpath-explain-frame')),
    toggleFound: Boolean(document.getElementById('lia-btn-light-mode'))
  }
}

function toggleLiaThemeInPage() {
  const button = document.getElementById('lia-btn-light-mode')
  if (!(button instanceof HTMLElement)) return false
  button.click()
  return true
}

function removeThemeRegressionButtonInPage() {
  document.getElementById('lia-mathpath-theme-regression-foreign-button')?.remove()
  return true
}

function inspectApiInPage() {
  const api = window.__LIA_MATHPATH__
  const terms = ['Bruch', 'Zähler', 'Nenner', 'Brüche']
  const entries = {}
  for (const term of terms) {
    try {
      entries[term] = api?.getGlossary?.(term) || null
    } catch (error) {
      entries[term] = { error: String(error) }
    }
  }
  return {
    href: location.href,
    readyState: document.readyState,
    apiLoaded: Boolean(api),
    entries
  }
}

function locateTermInPage(displayText) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
  const isRendered = element => {
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity) !== 0 && element.getClientRects().length > 0
  }
  const candidates = Array.from(document.querySelectorAll('em')).filter(element =>
    isRendered(element) &&
    !element.closest('div.notip, pre, code, .katex, .lia-mathpath-tooltip, .lia-mathpath-no-glossary') &&
    normalize(element.textContent) === displayText
  )
  const element = candidates.find(candidate =>
    candidate.hasAttribute('data-lia-term') &&
    candidate.classList.contains('lia-mathpath-glossary-highlight')
  ) || candidates[0]
  if (!element) return null
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const rect = element.getBoundingClientRect()
  const x = Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2))
  const y = Math.max(1, Math.min(innerHeight - 2, rect.top + rect.height / 2))
  const hit = document.elementFromPoint(x, y)
  return {
    x,
    y,
    width: rect.width,
    height: rect.height,
    dataTerm: element.getAttribute('data-lia-term'),
    hitTarget: hit === element || element.contains(hit),
    hitTag: hit?.tagName || null,
    hitText: normalize(hit?.textContent)
  }
}

function locatePlainTermInPage(fixtureText, displayText) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
  const excludedSelector =
    'div.notip, pre, code, kbd, samp, script, style, textarea, svg, canvas, .katex, .lia-mathpath-tooltip, .lia-mathpath-range-layer, .lia-mathpath-no-glossary'
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest(excludedSelector)) return NodeFilter.FILTER_REJECT
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden' ||
          Number(style.opacity) === 0 || parent.getClientRects().length === 0) {
        return NodeFilter.FILTER_SKIP
      }
      return node.data.includes(fixtureText)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP
    }
  })
  const textNode = walker.nextNode()
  if (!textNode) return null

  const fixtureStart = textNode.data.indexOf(fixtureText)
  const termOffset = fixtureText.indexOf(displayText)
  if (fixtureStart < 0 || termOffset < 0) return null

  const termStart = fixtureStart + termOffset
  const range = document.createRange()
  range.setStart(textNode, termStart)
  range.setEnd(textNode, termStart + displayText.length)

  const parent = textNode.parentElement
  parent.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const rect = Array.from(range.getClientRects()).find(candidate =>
    candidate.width > 0 && candidate.height > 0
  )
  if (!rect) return null

  const x = Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2))
  const y = Math.max(1, Math.min(innerHeight - 2, rect.top + rect.height / 2))
  const hit = document.elementFromPoint(x, y)
  const exactTermElements = Array.from(parent.querySelectorAll('*')).filter(element =>
    normalize(element.textContent) === displayText
  )

  return {
    x,
    y,
    width: rect.width,
    height: rect.height,
    rangeText: range.toString(),
    startContainerType: range.startContainer.nodeType,
    endContainerType: range.endContainer.nodeType,
    sameTextNode: range.startContainer === textNode && range.endContainer === textNode,
    textNode: textNode.data,
    parentTag: parent.tagName,
    parentText: normalize(parent.textContent),
    parentChildNodes: Array.from(parent.childNodes, child => ({
      type: child.nodeType,
      name: child.nodeName,
      text: child.nodeType === Node.TEXT_NODE ? child.data : normalize(child.textContent)
    })),
    elementChildCount: parent.children.length,
    exactTermElements: exactTermElements.map(element => element.tagName),
    decoratedDescendants: parent.querySelectorAll(
      '[data-lia-term], .lia-mathpath-glossary-highlight, .lia-mathpath-term'
    ).length,
    hitTarget: hit === parent || parent.contains(hit),
    hitTag: hit?.tagName || null,
    hitText: normalize(hit?.textContent)
  }
}

function inspectTooltipInPage(expectedTerm) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
  const rendered = element => element.getClientRects().length > 0 &&
    getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
  const tooltips = Array.from(document.querySelectorAll('.lia-mathpath-tooltip[data-open="1"]')).filter(rendered)
  const tooltip = tooltips.find(element => !element.classList.contains('lia-mathpath-tooltip--nested')) || tooltips[0]
  const entry = window.__LIA_MATHPATH__?.getGlossary?.(expectedTerm) || null
  const title = normalize(tooltip?.querySelector('.lia-mathpath-tooltip-title')?.textContent)
  const body = normalize(tooltip?.querySelector('.lia-mathpath-tooltip-body')?.textContent)
  const expectedExplanation = normalize(entry?.explanation)
  return {
    open: Boolean(tooltip),
    openCount: tooltips.length,
    title,
    body,
    expectedTerm: entry?.term || null,
    expectedExplanation,
    titleMatches: Boolean(entry) && title === normalize(entry.term),
    bodyMatches: Boolean(entry) && Boolean(expectedExplanation) && body.includes(expectedExplanation)
  }
}

async function pressKey(key) {
  const keyDefinitions = {
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    End: { code: 'End', keyCode: 35 },
    Home: { code: 'Home', keyCode: 36 }
  }
  const definition = keyDefinitions[key]
  if (!definition) throw new Error(`Unsupported key: ${key}`)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code: definition.code,
    windowsVirtualKeyCode: definition.keyCode,
    nativeVirtualKeyCode: definition.keyCode
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: definition.code,
    windowsVirtualKeyCode: definition.keyCode,
    nativeVirtualKeyCode: definition.keyCode
  })
}

async function inspectExample() {
  return evaluate(`(${inspectExampleInPage.toString()})()`)
}

async function inspectManualExplain() {
  return evaluate(`(${inspectManualExplainInPage.toString()})()`)
}

async function inspectTooltipMacroSlide(expectedHeading) {
  return evaluate(
    `(${inspectTooltipMacroSlideInPage.toString()})(${JSON.stringify(expectedHeading)})`
  )
}

function recordSlide(label, snapshot) {
  result.slidesVisited.push({
    label,
    href: snapshot?.href || null,
    hash: snapshot?.hash || null,
    headings: snapshot?.headings || [],
    exampleFound: Boolean(snapshot?.found)
  })
}

async function snapshotAfterKey(key, previousFingerprint, label) {
  await pressKey(key)
  let snapshot
  try {
    snapshot = await waitForValue(
      inspectExample,
      value => Boolean(value?.found) || value?.fingerprint !== previousFingerprint,
      2_500,
      100
    )
  } catch (error) {
    snapshot = error.lastValue || await inspectExample()
  }
  await delay(250)
  snapshot = await inspectExample()
  recordSlide(label, snapshot)
  return snapshot
}

async function navigateToExample() {
  await evaluate('window.focus(); document.body?.focus(); true')
  let snapshot = await inspectExample()
  recordSlide('initial', snapshot)
  if (snapshot.found) return snapshot

  snapshot = await snapshotAfterKey('End', snapshot.fingerprint, 'after-End')
  if (snapshot.found) return snapshot

  snapshot = await snapshotAfterKey('Home', snapshot.fingerprint, 'after-Home')
  if (snapshot.found) return snapshot

  let unchangedSteps = 0
  for (let step = 1; step <= 30; step += 1) {
    const previousFingerprint = snapshot.fingerprint
    snapshot = await snapshotAfterKey('ArrowRight', previousFingerprint, `ArrowRight-${step}`)
    if (snapshot.found) return snapshot
    unchangedSteps = snapshot.fingerprint === previousFingerprint ? unchangedSteps + 1 : 0
    if (unchangedSteps >= 2) break
  }
  return snapshot
}

async function manualExplainSnapshotAfterKey(key, previousFingerprint) {
  await pressKey(key)
  let snapshot
  try {
    snapshot = await waitForValue(
      inspectManualExplain,
      value => Boolean(value?.found) || value?.fingerprint !== previousFingerprint,
      2_500,
      100
    )
  } catch (error) {
    snapshot = error.lastValue || await inspectManualExplain()
  }
  await delay(250)
  return inspectManualExplain()
}

async function navigateToManualExplain() {
  await evaluate('window.focus(); document.body?.focus(); true')
  let snapshot = await inspectManualExplain()
  if (snapshot.found) return snapshot

  snapshot = await manualExplainSnapshotAfterKey('Home', snapshot.fingerprint)
  if (snapshot.found) return snapshot

  let unchangedSteps = 0
  for (let step = 1; step <= 30; step += 1) {
    const previousFingerprint = snapshot.fingerprint
    snapshot = await manualExplainSnapshotAfterKey('ArrowRight', previousFingerprint)
    if (snapshot.found) return snapshot
    unchangedSteps = snapshot.fingerprint === previousFingerprint ? unchangedSteps + 1 : 0
    if (unchangedSteps >= 2) break
  }
  return snapshot
}

async function tooltipMacroSnapshotAfterKey(key, previousFingerprint, expectedHeading, label) {
  await pressKey(key)
  let snapshot
  try {
    snapshot = await waitForValue(
      () => inspectTooltipMacroSlide(expectedHeading),
      value => Boolean(value?.found) || value?.fingerprint !== previousFingerprint,
      2_500,
      100
    )
  } catch (error) {
    snapshot = error.lastValue || await inspectTooltipMacroSlide(expectedHeading)
  }
  await delay(250)
  snapshot = await inspectTooltipMacroSlide(expectedHeading)
  recordSlide(label, snapshot)
  return snapshot
}

async function navigateToTooltipMacroSlide(expectedHeading) {
  await evaluate('window.focus(); document.body?.focus(); true')
  let snapshot = await inspectTooltipMacroSlide(expectedHeading)
  recordSlide(`tooltip-${expectedHeading}-initial`, snapshot)
  if (snapshot.found) return snapshot

  snapshot = await tooltipMacroSnapshotAfterKey(
    'Home',
    snapshot.fingerprint,
    expectedHeading,
    `tooltip-${expectedHeading}-after-Home`
  )
  if (snapshot.found) return snapshot

  let unchangedSteps = 0
  for (let step = 1; step <= 40; step += 1) {
    const previousFingerprint = snapshot.fingerprint
    snapshot = await tooltipMacroSnapshotAfterKey(
      'ArrowRight',
      previousFingerprint,
      expectedHeading,
      `tooltip-${expectedHeading}-ArrowRight-${step}`
    )
    if (snapshot.found) return snapshot
    unchangedSteps = snapshot.fingerprint === previousFingerprint ? unchangedSteps + 1 : 0
    if (unchangedSteps >= 2) break
  }
  return snapshot
}

function validateSemanticTerms(snapshot) {
  const failures = []
  for (const { display, canonical } of EXPECTED_TERMS) {
    const term = snapshot?.terms?.[display]
    const element = term?.element
    if (!term || term.candidateCount < 1 || !element) {
      failures.push(`${display}: no rendered <em> element`)
      continue
    }
    if (element.tagName !== 'EM') failures.push(`${display}: tag changed to ${element.tagName}`)
    if (element.dataTerm !== canonical) failures.push(`${display}: data-lia-term is ${element.dataTerm}`)
    if (!element.classes.includes('lia-mathpath-glossary-highlight')) {
      failures.push(`${display}: highlight class is missing`)
    }
    if (element.bound !== '1') failures.push(`${display}: interactions are not marked as bound`)
    if (element.childNodes.length !== 1 || element.childNodes[0].type !== NodeTextType ||
        element.childNodes[0].text !== display) {
      failures.push(`${display}: authored text child was replaced or wrapped`)
    }
  }
  return failures
}

const NodeTextType = 3

function validateNotip(snapshot) {
  const notip = snapshot?.notip
  const element = notip?.element
  const failures = []
  if (!notip || notip.candidateCount < 1 || !element) return ['notip <em>Bruch</em> was not rendered']
  if (element.tagName !== 'EM' || element.text !== 'Bruch') failures.push('notip semantic element changed')
  if (element.dataTerm !== null) failures.push('notip element received data-lia-term')
  if (element.bound !== null) failures.push('notip element received a bound marker')
  if (element.classes.includes('lia-mathpath-glossary-highlight') ||
      element.classes.includes('lia-mathpath-term')) {
    failures.push('notip element received MathPath classes')
  }
  if (element.childNodes.length !== 1 || element.childNodes[0].type !== NodeTextType ||
      element.childNodes[0].text !== 'Bruch') {
    failures.push('notip text child was replaced or wrapped')
  }
  if (notip.decoratedDescendants !== 0) failures.push('notip element has decorated descendants')
  return failures
}

function validatePlainTerm(point) {
  const failures = []
  if (!point) return [`normal ${PLAIN_TERM.display} text node was not rendered`]
  if (point.rangeText !== PLAIN_TERM.display) failures.push(`range contains ${point.rangeText}`)
  if (point.startContainerType !== NodeTextType || point.endContainerType !== NodeTextType ||
      !point.sameTextNode) {
    failures.push('range does not start and end in the original text node')
  }
  if (point.textNode !== PLAIN_TERM.fixtureText) failures.push('authored sentence text node was split or replaced')
  if (point.parentTag !== 'P' || point.parentText !== PLAIN_TERM.fixtureText) {
    failures.push('authored paragraph changed')
  }
  if (point.parentChildNodes.length !== 1 || point.parentChildNodes[0].type !== NodeTextType ||
      point.parentChildNodes[0].text !== PLAIN_TERM.fixtureText) {
    failures.push('an element or additional node was inserted into the authored paragraph')
  }
  if (point.elementChildCount !== 0 || point.exactTermElements.length !== 0) {
    failures.push(`normal term was wrapped by ${point.exactTermElements.join(', ') || 'an element'}`)
  }
  if (point.decoratedDescendants !== 0) failures.push('authored paragraph contains decorated descendants')
  return failures
}

async function termPoint(displayText) {
  const expression = `(${locateTermInPage.toString()})(${JSON.stringify(displayText)})`
  await evaluate(expression)
  await delay(100)
  return evaluate(expression)
}

async function plainTermPoint() {
  const expression = `(${locatePlainTermInPage.toString()})(${JSON.stringify(PLAIN_TERM.fixtureText)}, ${JSON.stringify(PLAIN_TERM.display)})`
  await evaluate(expression)
  await delay(100)
  return evaluate(expression)
}

async function moveMouse(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

async function clickMouse(x, y) {
  await moveMouse(x, y)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}

async function tooltipState(expectedTerm) {
  return evaluate(`(${inspectTooltipInPage.toString()})(${JSON.stringify(expectedTerm)})`)
}

async function tooltipProbePoint(kind) {
  const expression = `(${locateTooltipProbeInPage.toString()})(${JSON.stringify(kind)})`
  await evaluate(expression)
  await delay(100)
  return evaluate(expression)
}

async function checkInertTooltipProbe(kind) {
  await moveMouse(2, 2)
  await delay(100)
  const point = await tooltipProbePoint(kind)
  if (!point) throw new Error(`Could not locate ${kind} tooltip probe`)
  if (!point.hitTarget) throw new Error(`${kind} tooltip probe is covered at its center point`)

  await moveMouse(point.x, point.y)
  await delay(500)
  const tooltip = await tooltipState('Bruch')
  await moveMouse(2, 2)
  return { point, tooltip }
}

async function checkHover(displayText, expectedTerm, locatePoint = termPoint) {
  await moveMouse(2, 2)
  const point = await locatePoint(displayText)
  if (!point) throw new Error(`Could not locate ${displayText}`)
  if (!point.hitTarget) throw new Error(`${displayText} is covered at its center point`)
  await moveMouse(point.x, point.y)
  const tooltip = await waitForValue(
    () => tooltipState(expectedTerm),
    value => value?.open && value.titleMatches && value.bodyMatches,
    4_000,
    100
  )
  await moveMouse(2, 2)
  await waitForValue(
    () => evaluate(`document.querySelectorAll('.lia-mathpath-tooltip[data-open="1"]').length`),
    count => count === 0,
    2_000,
    100
  )
  return { point, tooltip, closedAfterPointerLeaves: true }
}

async function checkClick(displayText, expectedTerm, locatePoint = termPoint) {
  await moveMouse(2, 2)
  await delay(150)
  const point = await locatePoint(displayText)
  if (!point) throw new Error(`Could not locate ${displayText}`)
  if (!point.hitTarget) throw new Error(`${displayText} is covered at its center point`)
  await clickMouse(point.x, point.y)
  const tooltip = await waitForValue(
    () => tooltipState(expectedTerm),
    value => value?.open && value.titleMatches && value.bodyMatches,
    4_000,
    100
  )
  await moveMouse(2, 2)
  await delay(100)
  const pinnedTooltip = await waitForValue(
    () => tooltipState(expectedTerm),
    value => value?.open && value.titleMatches && value.bodyMatches,
    2_000,
    100
  )
  return { point, tooltip: pinnedTooltip, openedTooltip: tooltip, pinnedAfterPointerLeaves: true }
}

async function closeTooltip() {
  await clickMouse(2, 2)
  try {
    await waitForValue(
      () => evaluate("document.querySelectorAll('.lia-mathpath-tooltip[data-open=\"1\"]').length"),
      count => count === 0,
      2_000,
      100
    )
  } catch {
    // A later interaction check reports a tooltip that could not be closed.
  }
}

function semanticSignature(snapshot) {
  const signature = {}
  for (const { display } of EXPECTED_TERMS) {
    const term = snapshot?.terms?.[display]
    signature[display] = {
      candidateCount: term?.candidateCount ?? 0,
      tagName: term?.element?.tagName || null,
      dataTerm: term?.element?.dataTerm || null,
      childNodes: term?.element?.childNodes || []
    }
  }
  return signature
}

async function runRerenderCycles(exampleSnapshot) {
  const cycles = []
  let current = exampleSnapshot

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await closeTooltip()
    const before = current
    const away = await snapshotAfterKey('ArrowLeft', before.fingerprint, `rerender-${cycle}-away`)
    const changed = away.fingerprint !== before.fingerprint
    const returned = await snapshotAfterKey('ArrowRight', away.fingerprint, `rerender-${cycle}-return`)
    let settled = returned
    if (returned.found) {
      try {
        settled = await waitForValue(
          inspectExample,
          value => validateSemanticTerms(value).length === 0,
          5_000,
          150
        )
      } catch (error) {
        settled = error.lastValue || returned
      }
    }
    cycles.push({
      cycle,
      navigatedAway: changed,
      returnedToExample: Boolean(settled?.found),
      hashAway: away.hash,
      hashReturned: settled?.hash || null,
      semanticFailures: validateSemanticTerms(settled)
    })
    current = settled
  }
  return { cycles, finalSnapshot: current }
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    if (cdp && !cdp.closed) {
      try {
        await cdp.send('Browser.close', {}, 3_000)
      } catch {
        // Closing the browser commonly closes CDP before the response arrives.
      }
    }

    if (chromeProcess) {
      let stopped = await waitForChildExit(chromeProcess, 3_000)
      if (!stopped && chromeProcess.exitCode === null) {
        try {
          chromeProcess.kill('SIGTERM')
        } catch {
          // The process may have exited between the check and kill call.
        }
        stopped = await waitForChildExit(chromeProcess, 2_000)
      }
      if (!stopped && chromeProcess.exitCode === null) {
        try {
          chromeProcess.kill('SIGKILL')
        } catch {
          // The process may already be gone.
        }
        stopped = await waitForChildExit(chromeProcess, 2_000)
      }
      result.cleanup.browserStopped = stopped || chromeProcess.exitCode !== null
    } else {
      result.cleanup.browserStopped = true
    }

    cdp?.close()

    if (profileDirectory) {
      try {
        assertSafeTemporaryPath(profileDirectory)
        await rm(profileDirectory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200
        })
        result.cleanup.profileRemoved = true
      } catch (error) {
        result.cleanup.profileRemoved = false
        result.cleanup.profileError = errorDetails(error)
      }
    } else {
      result.cleanup.profileRemoved = true
    }
  })()
  return cleanupPromise
}

async function run() {
  const options = parseArguments(process.argv.slice(2))
  result.mode = options.remote
    ? (options.consumerImport ? 'remote-consumer-import' : 'remote')
    : (options.consumerImport ? 'consumer-import' : 'local-overrides')
  result.url = options.url
  result.overrides.enabled = !options.remote

  const overrideFiles = options.remote
    ? new Map()
    : await loadOverrideFiles(options.consumerImport)
  const chromePath = await findChrome(options.chromePath)
  result.environment.chromePath = chromePath

  profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'lia-mathpath-browser-check-'))
  assertSafeTemporaryPath(profileDirectory)

  const chromeArguments = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--window-size=1440,1000',
    'about:blank'
  ]
  chromeProcess = spawn(chromePath, chromeArguments, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
  chromeProcess.stderr.setEncoding('utf8')
  chromeProcess.stderr.on('data', appendChromeStderr)

  const devTools = await waitForDevTools(profileDirectory, chromeProcess, Math.min(options.timeoutMs, 15_000))
  result.environment.browser = devTools.version.Browser || null
  result.environment.protocolVersion = devTools.version['Protocol-Version'] || null
  const target = await waitForPageTarget(devTools.endpoint, 10_000)
  cdp = await CdpConnection.connect(target.webSocketDebuggerUrl)
  installDiagnosticHandlers(cdp)
  if (!options.remote) installFetchOverrides(cdp, overrideFiles)

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Inspector.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  })
  if (!options.remote) {
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }]
    })
  }

  const navigation = await cdp.send('Page.navigate', { url: options.url }, options.timeoutMs)
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`)

  let apiState = null
  try {
    apiState = await waitForValue(
      () => evaluate(`(${inspectApiInPage.toString()})()`),
      value => value?.readyState === 'complete' && value.apiLoaded && value.entries?.Bruch,
      options.timeoutMs,
      200
    )
    addCheck('MathPath API is loaded', apiState.apiLoaded, apiState)
    const glossaryOk = ['Bruch', 'Zähler', 'Nenner'].every(term => apiState.entries?.[term]?.term === term)
    addCheck('Glossary entries are loaded', glossaryOk, apiState.entries)
    addCheck(
      'Alias Brüche resolves to Bruch',
      apiState.entries?.['Brüche']?.term === 'Bruch',
      { entry: apiState.entries?.['Brüche'] || null }
    )
  } catch (error) {
    addCheck('MathPath API and glossary become ready', false, {
      error: errorDetails(error),
      lastValue: error.lastValue || apiState
    })
  }

  let manualExplain = null
  try {
    manualExplain = await navigateToManualExplain()
    const rendersFreely = manualExplain.found &&
      manualExplain.topic === 'Tutorial' &&
      manualExplain.outsideHintContext === true &&
      manualExplain.linkText === 'Tutorial' &&
      manualExplain.itemText === TUTORIAL_TEXT &&
      manualExplain.linkHref === TUTORIAL_URL &&
      manualExplain.literalMacroVisible === false
    addCheck('@Explain(Tutorial) renders outside quiz and hint contexts', rendersFreely, {
      expectedHref: TUTORIAL_URL,
      expectedText: TUTORIAL_TEXT,
      snapshot: manualExplain
    })

    if (rendersFreely) {
      const overlay = await evaluate(`(${clickManualExplainInPage.toString()})()`)
      const overlayWorks = overlay.clicked &&
        overlay.open &&
        overlay.bodyLocked &&
        overlay.frameSrc === TUTORIAL_URL
      addCheck('@Explain(Tutorial) opens the Tutorial course in the overlay', overlayWorks, {
        expectedHref: TUTORIAL_URL,
        overlay
      })

      if (overlayWorks) {
        let dynFlex = null
        try {
          dynFlex = await waitForValue(
            () => evaluate(`(${inspectTutorialDynFlexInPage.toString()})()`),
            value => value?.accessible === true &&
              value.readyState === 'complete' &&
              value.containerCount > 0 &&
              value.visibleContainerCount > 0 &&
              value.flexDisplayCount === value.containerCount &&
              value.initializedContainerCount === value.containerCount &&
              value.itemCount > 0 &&
              value.resizerCount === value.itemCount &&
              value.boundResizerCount === value.resizerCount &&
              value.styleCount === 1,
            20_000,
            250
          )
          addCheck('@Explain(Tutorial) initializes DynFlex inside the course iframe', true, {
            snapshot: dynFlex
          })
        } catch (error) {
          addCheck('@Explain(Tutorial) initializes DynFlex inside the course iframe', false, {
            error: errorDetails(error),
            snapshot: error.lastValue || dynFlex
          })
        }

        let themeBefore = null
        let themeAfter = null
        let themeToggled = false
        let foreignButton = null
        try {
          foreignButton = await evaluate(`(${installThemeRegressionButtonInPage.toString()})()`)
          themeBefore = await evaluate(`(${inspectExplainThemeInPage.toString()})()`)
          const toggled = await evaluate(`(${toggleLiaThemeInPage.toString()})()`)
          themeToggled = Boolean(toggled)
          if (!toggled) throw new Error('The LiaScript light/dark toggle was not found.')

          const beforeFingerprint = [
            themeBefore.rootClass,
            themeBefore.body?.backgroundColor,
            themeBefore.variables?.surface,
            themeBefore.variables?.text
          ].join('|')
          themeAfter = await waitForValue(
            () => evaluate(`(${inspectExplainThemeInPage.toString()})()`),
            value => [
              value?.rootClass,
              value?.body?.backgroundColor,
              value?.variables?.surface,
              value?.variables?.text
            ].join('|') !== beforeFingerprint,
            5_000,
            100
          )
          await delay(150)
          themeAfter = await evaluate(`(${inspectExplainThemeInPage.toString()})()`)

          const failures = [
            ...explainThemeFailures(themeBefore).map(message => `before toggle: ${message}`),
            ...explainThemeFailures(themeAfter).map(message => `after toggle: ${message}`)
          ]
          if (foreignButton?.firstButtonId !== 'lia-mathpath-theme-regression-foreign-button') {
            failures.push('foreign regression button was not the first page button')
          }
          if (themeBefore.variables?.surface === themeAfter.variables?.surface &&
              themeBefore.variables?.text === themeAfter.variables?.text) {
            failures.push('synchronized course colors did not change with the LiaScript theme')
          }

          addCheck('Explain overlay remains readable across the LiaScript light/dark switch', failures.length === 0, {
            failures,
            foreignButton,
            beforeContrast: colorContrast(themeBefore.close?.color, themeBefore.close?.backgroundColor),
            afterContrast: colorContrast(themeAfter.close?.color, themeAfter.close?.backgroundColor),
            before: themeBefore,
            after: themeAfter
          })
        } catch (error) {
          addCheck('Explain overlay remains readable across the LiaScript light/dark switch', false, {
            error: errorDetails(error),
            foreignButton,
            before: themeBefore,
            after: themeAfter || error.lastValue || null
          })
        } finally {
          if (themeToggled) {
            await evaluate(`(${toggleLiaThemeInPage.toString()})()`)
            if (themeBefore) {
              try {
                await waitForValue(
                  () => evaluate(`(${inspectExplainThemeInPage.toString()})()`),
                  value => value?.variables?.surface === themeBefore.variables?.surface &&
                    value?.variables?.text === themeBefore.variables?.text,
                  5_000,
                  100
                )
              } catch {
                // The remaining checks do not depend on the restored visual theme.
              }
            }
          }
          await evaluate(`(${removeThemeRegressionButtonInPage.toString()})()`)
        }
      } else {
        addCheck('@Explain(Tutorial) initializes DynFlex inside the course iframe', false, {
          skipped: true,
          reason: 'The explanation overlay did not open correctly.'
        })
        addCheck('Explain overlay remains readable across the LiaScript light/dark switch', false, {
          skipped: true,
          reason: 'The explanation overlay did not open correctly.'
        })
      }
      await evaluate(
        "document.querySelector('.lia-mathpath-explain-close')?.click(); true"
      )
    } else {
      addCheck('@Explain(Tutorial) opens the Tutorial course in the overlay', false, {
        skipped: true,
        reason: 'The freely placed Tutorial link was not rendered correctly.'
      })
      addCheck('@Explain(Tutorial) initializes DynFlex inside the course iframe', false, {
        skipped: true,
        reason: 'The freely placed Tutorial link was not rendered correctly.'
      })
      addCheck('Explain overlay remains readable across the LiaScript light/dark switch', false, {
        skipped: true,
        reason: 'The freely placed Tutorial link was not rendered correctly.'
      })
    }
  } catch (error) {
    addCheck('@Explain(Tutorial) renders outside quiz and hint contexts', false, {
      error: errorDetails(error),
      lastValue: error.lastValue || manualExplain
    })
    addCheck('@Explain(Tutorial) opens the Tutorial course in the overlay', false, {
      skipped: true,
      reason: 'The freely placed Tutorial link could not be reached.'
    })
    addCheck('@Explain(Tutorial) initializes DynFlex inside the course iframe', false, {
      error: errorDetails(error),
      skipped: true
    })
    addCheck('Explain overlay remains readable across the LiaScript light/dark switch', false, {
      skipped: true,
      reason: 'The freely placed Tutorial link could not be reached.'
    })
  }

  if (!options.remote) {
    const missingOverrides = Object.entries(result.overrides.served)
      .filter(([, count]) => count < 1)
      .map(([name]) => name)
    addCheck('Local README, bundle, glossary, and explanation overrides were served', missingOverrides.length === 0, {
      served: result.overrides.served,
      missing: missingOverrides,
      errors: result.overrides.errors
    })
  }

  let exampleSnapshot = null
  try {
    exampleSnapshot = await navigateToExample()
    addCheck('Visible README browser example was reached', exampleSnapshot.found, {
      hash: exampleSnapshot.hash,
      headings: exampleSnapshot.headings,
      terms: exampleSnapshot.terms,
      notip: exampleSnapshot.notip
    })
  } catch (error) {
    addCheck('Visible README browser example was reached', false, { error: errorDetails(error) })
  }

  if (exampleSnapshot?.found) {
    try {
      exampleSnapshot = await waitForValue(
        inspectExample,
        value => validateSemanticTerms(value).length === 0,
        8_000,
        150
      )
    } catch (error) {
      exampleSnapshot = error.lastValue || exampleSnapshot
    }

    const semanticFailures = validateSemanticTerms(exampleSnapshot)
    addCheck('Italic glossary terms reuse their authored semantic elements', semanticFailures.length === 0, {
      failures: semanticFailures,
      terms: exampleSnapshot.terms
    })

    const notipFailures = validateNotip(exampleSnapshot)
    addCheck('notip term remains unchanged', notipFailures.length === 0, {
      failures: notipFailures,
      notip: exampleSnapshot.notip
    })

    let plainPoint = null
    try {
      plainPoint = await plainTermPoint()
    } catch {
      // The invariant check below records the missing or malformed range.
    }
    const plainFailures = validatePlainTerm(plainPoint)
    addCheck('Normal glossary term starts in its authored text node', plainFailures.length === 0, {
      failures: plainFailures,
      point: plainPoint
    })

    try {
      const hover = await checkHover('Brüche', 'Bruch')
      addCheck('Real hover opens the canonical Bruch tooltip for Brüche', true, hover)
    } catch (error) {
      addCheck('Real hover opens the canonical Bruch tooltip for Brüche', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }

    await closeTooltip()

    try {
      const hover = await checkHover(PLAIN_TERM.display, PLAIN_TERM.canonical, plainTermPoint)
      addCheck('Real hover opens the Division tooltip for normal text', true, hover)
    } catch (error) {
      addCheck('Real hover opens the Division tooltip for normal text', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }

    await closeTooltip()

    try {
      const click = await checkClick(PLAIN_TERM.display, PLAIN_TERM.canonical, plainTermPoint)
      addCheck('Real click opens the Division tooltip for normal text', true, click)
    } catch (error) {
      addCheck('Real click opens the Division tooltip for normal text', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }

    await closeTooltip()

    let interactedPlainPoint = null
    try {
      interactedPlainPoint = await plainTermPoint()
    } catch {
      // The invariant check below records an interaction-time DOM rewrite.
    }
    const interactedPlainFailures = validatePlainTerm(interactedPlainPoint)
    addCheck(
      'Normal glossary term remains unwrapped after real hover and click',
      interactedPlainFailures.length === 0,
      { failures: interactedPlainFailures, point: interactedPlainPoint }
    )

    try {
      const click = await checkClick('Zähler', 'Zähler')
      addCheck('Real click opens the correct Zähler tooltip', true, click)
    } catch (error) {
      addCheck('Real click opens the correct Zähler tooltip', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }

    await closeTooltip()

    try {
      const baselineSignature = semanticSignature(exampleSnapshot)
      const rerender = await runRerenderCycles(exampleSnapshot)
      const finalSnapshot = rerender.finalSnapshot
      const finalSemanticFailures = validateSemanticTerms(finalSnapshot)
      const finalNotipFailures = validateNotip(finalSnapshot)
      const signatureUnchanged = JSON.stringify(semanticSignature(finalSnapshot)) === JSON.stringify(baselineSignature)
      const navigationOk = rerender.cycles.every(cycle =>
        cycle.navigatedAway && cycle.returnedToExample && cycle.semanticFailures.length === 0
      )
      const idempotent = navigationOk && signatureUnchanged &&
        finalSemanticFailures.length === 0 && finalNotipFailures.length === 0 &&
        finalSnapshot.nestedHighlights === 0 && finalSnapshot.tooltipElements <= 1
      addCheck('Slide changes and rerendering remain idempotent', idempotent, {
        cycles: rerender.cycles,
        signatureUnchanged,
        baselineSignature,
        finalSignature: semanticSignature(finalSnapshot),
        finalSemanticFailures,
        finalNotipFailures,
        nestedHighlights: finalSnapshot.nestedHighlights,
        tooltipElements: finalSnapshot.tooltipElements
      })
    } catch (error) {
      addCheck('Slide changes and rerendering remain idempotent', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }
  } else {
    addCheck('Semantic highlight, notip, interaction, and rerender checks', false, {
      skipped: true,
      reason: 'The visible README browser example was not reached.'
    })
  }

  if (!options.remote) {
    let offSnapshot = null
    try {
      await moveMouse(2, 2)
      offSnapshot = await navigateToTooltipMacroSlide(TOOLTIP_OFF_HEADING)
      offSnapshot = await waitForValue(
        () => inspectTooltipMacroSlide(TOOLTIP_OFF_HEADING),
        value => value?.found &&
          value.apiEnabled === false &&
          value.rootMode === 'off' &&
          value.glossaryRangeRegistered === false &&
          value.hoverRangeRegistered === false &&
          value.rangeLayerCount === 0 &&
          value.openTooltipCount === 0,
        8_000,
        150
      )
      const offStateWorks = offSnapshot.found &&
        offSnapshot.apiEnabled === false &&
        offSnapshot.rootMode === 'off' &&
        offSnapshot.glossaryRangeRegistered === false &&
        offSnapshot.hoverRangeRegistered === false &&
        offSnapshot.rangeLayerCount === 0 &&
        offSnapshot.openTooltipCount === 0 &&
        offSnapshot.automatic?.text === 'Bruch' &&
        ['rgba(0, 0, 0, 0)', 'transparent'].includes(offSnapshot.automatic?.backgroundColor) &&
        offSnapshot.automatic?.boxShadow === 'none' &&
        offSnapshot.manual?.dataTerm === 'Bruch'
      addCheck('@tooltip(off) disables automatic tooltip state and painting', offStateWorks, {
        heading: TOOLTIP_OFF_HEADING,
        snapshot: offSnapshot
      })
      addCheck(
        '@tooltip(off) is not visible as non-code text',
        offSnapshot.literalMacroTexts.length === 0,
        { literalMacroTexts: offSnapshot.literalMacroTexts }
      )
    } catch (error) {
      offSnapshot = error.lastValue || offSnapshot
      addCheck('@tooltip(off) disables automatic tooltip state and painting', false, {
        error: errorDetails(error),
        lastValue: offSnapshot
      })
      addCheck('@tooltip(off) is not visible as non-code text', false, {
        skipped: true,
        reason: 'The tooltip-off slide did not become ready.'
      })
    }

    try {
      if (!offSnapshot?.found) throw new Error('The tooltip-off slide was not reached.')
      const inert = await checkInertTooltipProbe('automatic')
      const remainsInert = inert.tooltip?.open === false && inert.tooltip?.openCount === 0
      addCheck('Real hover keeps the automatic tooltip probe inert while off', remainsInert, inert)
    } catch (error) {
      addCheck('Real hover keeps the automatic tooltip probe inert while off', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }

    try {
      if (!offSnapshot?.found) throw new Error('The tooltip-off slide was not reached.')
      const hover = await checkHover('Bruch', 'Bruch', () => tooltipProbePoint('manual'))
      addCheck('Manual data-lia-term remains interactive while automatic tooltips are off', true, hover)
    } catch (error) {
      addCheck('Manual data-lia-term remains interactive while automatic tooltips are off', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }

    let onSnapshot = null
    try {
      onSnapshot = await navigateToTooltipMacroSlide(TOOLTIP_ON_HEADING)
      onSnapshot = await waitForValue(
        () => inspectTooltipMacroSlide(TOOLTIP_ON_HEADING),
        value => value?.found && value.apiEnabled === true && value.rootMode === null,
        8_000,
        150
      )
      const onStateWorks = onSnapshot.found &&
        onSnapshot.apiEnabled === true &&
        onSnapshot.rootMode === null &&
        onSnapshot.automatic?.text === 'Bruch'
      addCheck('@tooltip(on) restores automatic tooltip state', onStateWorks, {
        heading: TOOLTIP_ON_HEADING,
        snapshot: onSnapshot
      })
      addCheck(
        '@tooltip(on) is not visible as non-code text',
        onSnapshot.literalMacroTexts.length === 0,
        { literalMacroTexts: onSnapshot.literalMacroTexts }
      )
    } catch (error) {
      onSnapshot = error.lastValue || onSnapshot
      addCheck('@tooltip(on) restores automatic tooltip state', false, {
        error: errorDetails(error),
        lastValue: onSnapshot
      })
      addCheck('@tooltip(on) is not visible as non-code text', false, {
        skipped: true,
        reason: 'The tooltip-on slide did not become ready.'
      })
    }

    try {
      if (!onSnapshot?.found) throw new Error('The tooltip-on slide was not reached.')
      const hover = await checkHover('Bruch', 'Bruch', () => tooltipProbePoint('automatic'))
      addCheck('Real hover opens Bruch for the automatic tooltip probe while on', true, hover)
    } catch (error) {
      addCheck('Real hover opens Bruch for the automatic tooltip probe while on', false, {
        error: errorDetails(error),
        lastValue: error.lastValue || null
      })
    }
  }

  await delay(500)
  const diagnosticErrors = [
    ...result.diagnostics.runtimeExceptions,
    ...result.diagnostics.consoleErrors,
    ...result.diagnostics.logErrors,
    ...result.diagnostics.pageCrashes,
    ...result.diagnostics.cdpHandlerErrors
  ]
  addCheck('No runtime or console errors occurred', diagnosticErrors.length === 0, {
    runtimeExceptions: result.diagnostics.runtimeExceptions,
    consoleErrors: result.diagnostics.consoleErrors,
    logErrors: result.diagnostics.logErrors,
    pageCrashes: result.diagnostics.pageCrashes,
    cdpHandlerErrors: result.diagnostics.cdpHandlerErrors
  })
}

function finalizeOutput() {
  if (outputWritten) return
  outputWritten = true
  result.durationMs = Date.now() - Date.parse(result.startedAt)
  result.ok = !result.fatalError &&
    result.checks.length > 0 &&
    result.checks.every(check => check.ok) &&
    result.cleanup.browserStopped &&
    result.cleanup.profileRemoved
  if (!result.ok && chromeStderr.length > 0) {
    result.chromeStderrTail = chromeStderr.join('').split(/\r?\n/).filter(Boolean).slice(-20)
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.ok ? 0 : 1
}

async function handleSignal(signal) {
  if (!result.fatalError) {
    result.fatalError = { name: signal, message: `Interrupted by ${signal}`, stack: null }
  }
  await cleanup()
  finalizeOutput()
  process.exit(process.exitCode || 1)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void handleSignal(signal)
  })
}

process.once('exit', () => {
  if (chromeProcess?.exitCode === null) {
    try {
      chromeProcess.kill('SIGKILL')
    } catch {
      // Best-effort synchronous fallback for abnormal Node termination.
    }
  }
})

try {
  await run()
} catch (error) {
  result.fatalError = errorDetails(error)
} finally {
  await cleanup()
  finalizeOutput()
}
