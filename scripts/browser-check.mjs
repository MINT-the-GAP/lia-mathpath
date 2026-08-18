#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_URL =
  'https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md'
const DEFAULT_TIMEOUT_MS = 45_000
const EXPECTED_TERMS = [
  { display: 'Bruch', canonical: 'Bruch' },
  { display: 'Zähler', canonical: 'Zähler' },
  { display: 'Nenner', canonical: 'Nenner' },
  { display: 'Brüche', canonical: 'Bruch' }
]

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
      'Glossar.md': 0
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

function parseArguments(argv) {
  const options = {
    remote: false,
    url: DEFAULT_URL,
    chromePath: process.env.CHROME_PATH || null,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--remote') {
      options.remote = true
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

async function loadOverrideFiles() {
  const definitions = [
    ['README.md', path.join(repositoryRoot, 'README.md'), 'text/markdown; charset=utf-8'],
    ['dist/index.js', path.join(repositoryRoot, 'dist', 'index.js'), 'application/javascript; charset=utf-8'],
    ['Glossar.md', path.join(repositoryRoot, 'Glossar.md'), 'text/markdown; charset=utf-8']
  ]
  const overrides = new Map()

  for (const [name, filename, contentType] of definitions) {
    const body = await readFile(filename)
    overrides.set(name, { name, filename, contentType, body })
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
  if (/\/readme\.md$/i.test(pathname)) return 'README.md'
  if (/\/dist\/index\.js$/i.test(pathname)) return 'dist/index.js'
  if (/\/glossar\.md$/i.test(pathname)) return 'Glossar.md'
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

async function termPoint(displayText) {
  const expression = `(${locateTermInPage.toString()})(${JSON.stringify(displayText)})`
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

async function checkHover(displayText, expectedTerm) {
  await moveMouse(2, 2)
  const point = await termPoint(displayText)
  if (!point) throw new Error(`Could not locate ${displayText}`)
  if (!point.hitTarget) throw new Error(`${displayText} is covered at its center point`)
  await moveMouse(point.x, point.y)
  const tooltip = await waitForValue(
    () => tooltipState(expectedTerm),
    value => value?.open && value.titleMatches && value.bodyMatches,
    4_000,
    100
  )
  return { point, tooltip }
}

async function checkClick(displayText, expectedTerm) {
  await moveMouse(2, 2)
  await delay(150)
  const point = await termPoint(displayText)
  if (!point) throw new Error(`Could not locate ${displayText}`)
  if (!point.hitTarget) throw new Error(`${displayText} is covered at its center point`)
  await clickMouse(point.x, point.y)
  const tooltip = await waitForValue(
    () => tooltipState(expectedTerm),
    value => value?.open && value.titleMatches && value.bodyMatches,
    4_000,
    100
  )
  return { point, tooltip }
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
  result.mode = options.remote ? 'remote' : 'local-overrides'
  result.url = options.url
  result.overrides.enabled = !options.remote

  const overrideFiles = options.remote ? new Map() : await loadOverrideFiles()
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

  if (!options.remote) {
    const missingOverrides = Object.entries(result.overrides.served)
      .filter(([, count]) => count < 1)
      .map(([name]) => name)
    addCheck('Local README, bundle, and glossary overrides were served', missingOverrides.length === 0, {
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
