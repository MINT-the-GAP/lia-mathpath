#!/usr/bin/env node
// Compare an unchanged LiaScript course with two MathPath bundles in real Chrome.
// No dependencies beyond Node 24 and Chrome. All measurements include the same hooks.
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = {
  baseline: '.parcel-cache/browser-performance/baseline-index.js',
  fixed: 'dist/index.js',
  course: '../Fortbildung/Erkunden.md',
  url: 'https://liascript.github.io/course/?https://raw.githubusercontent.com/MLomma/Fortbildung26/main/Erkunden.md',
  slide: '3', timingOnly: 'false', repeats: '3', moves: '120',
  output: '.parcel-cache/browser-performance/comparison.json',
  chrome: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '')
  if (!(key in options) || process.argv[i + 1] === undefined) throw new Error(`Unknown/missing option: ${process.argv[i]}`)
  options[key] = process.argv[i + 1]
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
let activeChrome = null
process.once('exit', () => { if (activeChrome?.exitCode === null) activeChrome.kill() })
const report = { startedAt: new Date().toISOString(), options, viewport: { width: 1440, height: 1000 }, cpuRate: 4, runs: [], checks: [], errors: [] }
const courseBody = await readFile(path.resolve(root, options.course))
report.courseSha256 = sha256(courseBody)
const resourceBodies = new Map()
for (const name of ['README.md', 'Glossar.md', 'Explain.md']) resourceBodies.set(name, await readFile(path.join(root, name)))
const variants = new Map()
for (const name of ['baseline', 'fixed']) variants.set(name, await readFile(path.resolve(root, options[name])))
report.bundles = Object.fromEntries([...variants].map(([name, bytes]) => [name, { path: options[name], sha256: sha256(bytes), bytes: bytes.length }]))
await mkdir(path.dirname(path.resolve(root, options.output)), { recursive: true })

class Cdp {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.handlers = new Map()
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id); clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      } else for (const handler of this.handlers.get(message.method) || []) {
        Promise.resolve(handler(message.params)).catch(error => report.errors.push({ method: message.method, message: error.message }))
      }
    })
  }
  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    return new Cdp(socket)
  }
  on(method, handler) { this.handlers.set(method, [...this.handlers.get(method) || [], handler]) }
  send(method, params = {}, timeout = 45_000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, timeout)
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
}

function installMeasurements(timingOnly) {
  let currentPointer = false, currentCanvasPointer = false
  const state = window.__mathpathPerformance = {
    active: false, pointerCallbacks: 0, pointerMs: 0, maxPointerMs: 0,
    caretCalls: 0, canvasCaretCalls: 0, pointerRangeReads: 0, canvasPointerRangeReads: 0, bodyTextWalks: 0, scopedTextWalks: 0,
    mutationCallbacks: 0, mutationMs: 0, longTasks: [], registrations: [], canvasMoves: 0,
    reset() {
      for (const key of ['pointerCallbacks', 'pointerMs', 'maxPointerMs', 'caretCalls', 'canvasCaretCalls', 'pointerRangeReads', 'canvasPointerRangeReads', 'bodyTextWalks', 'scopedTextWalks', 'mutationCallbacks', 'mutationMs', 'canvasMoves']) this[key] = 0
      this.longTasks = []; this.active = true
    },
    snapshot() {
      this.active = false
      const { reset, snapshot, ...values } = this
      return values
    }
  }
  const isMathPath = stack => /lia-mathpath[^\n]*\/dist\/index[^\n]*\.js/i.test(stack)
  const add = EventTarget.prototype.addEventListener
  new PerformanceObserver(list => {
    if (state.active) state.longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration })))
  }).observe({ type: 'longtask', buffered: false })
  add.call(document, 'pointermove', event => { if (state.active && event.target instanceof HTMLCanvasElement) state.canvasMoves += 1 }, true)
  if (timingOnly) return
  EventTarget.prototype.addEventListener = function(type, handler, ...args) {
    if (type === 'pointermove' && typeof handler === 'function' && isMathPath(new Error().stack)) {
      state.registrations.push({ type, target: this === document ? 'document' : this.nodeName })
      const original = handler
      handler = function(event) {
        if (!state.active) return original.call(this, event)
        const started = performance.now(); currentPointer = true; currentCanvasPointer = event.target instanceof HTMLCanvasElement
        state.pointerCallbacks += 1
        try { return original.call(this, event) } finally {
          currentPointer = false; currentCanvasPointer = false
          const elapsed = performance.now() - started
          state.pointerMs += elapsed; state.maxPointerMs = Math.max(state.maxPointerMs, elapsed)
        }
      }
    }
    return add.call(this, type, handler, ...args)
  }
  const NativeObserver = MutationObserver
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      const own = isMathPath(new Error().stack)
      super(function(records, observer) {
        if (!state.active || !own) return callback.call(this, records, observer)
        state.mutationCallbacks += 1
        const start = performance.now()
        try { return callback.call(this, records, observer) } finally { state.mutationMs += performance.now() - start }
      })
    }
  }
  for (const name of ['caretPositionFromPoint', 'caretRangeFromPoint']) {
    const original = Document.prototype[name]
    if (original) Document.prototype[name] = function(...args) {
      if (state.active && currentPointer) { state.caretCalls += 1; if (currentCanvasPointer) state.canvasCaretCalls += 1 }
      return original.apply(this, args)
    }
  }
  for (const name of ['getClientRects', 'getBoundingClientRect']) {
    const original = Range.prototype[name]
    Range.prototype[name] = function(...args) {
      if (state.active && currentPointer) { state.pointerRangeReads += 1; if (currentCanvasPointer) state.canvasPointerRangeReads += 1 }
      return original.apply(this, args)
    }
  }
  const createWalker = Document.prototype.createTreeWalker
  Document.prototype.createTreeWalker = function(scope, whatToShow, ...args) {
    // Attribute only MathPath text walks; other imported templates also use TreeWalker.
    if (state.active && (whatToShow & NodeFilter.SHOW_TEXT) !== 0 && isMathPath(new Error().stack)) {
      if (scope === document.body) state.bodyTextWalks += 1
      else state.scopedTextWalks += 1
    }
    return createWalker.call(this, scope, whatToShow, ...args)
  }

}

async function waitFor(probe, predicate = Boolean, timeout = 60_000) {
  const end = Date.now() + timeout; let value
  while (Date.now() < end) { value = await probe(); if (predicate(value)) return value; await delay(200) }
  throw new Error(`Page condition timed out; last value ${JSON.stringify(value)}`)
}
function tooltipState() {
  const tip = document.querySelector('.lia-mathpath-tooltip[data-open="1"]')
  return { open: !!tip, text: tip?.textContent || '', pinned: tip?.getAttribute('data-pinned') }
}
function layoutState() {
  const selectors = ['.lia-slide__container', '.lia-slide', '.dynFlex', '.flex-child', '.lia-canvas-pair', '.lia-canvas-mount', 'canvas', 'h1', 'h2']
  return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getBoundingClientRect().width > 0).map(element => {
    const rect = element.getBoundingClientRect()
    return { selector, text: ['h1', 'h2'].includes(selector) ? element.textContent : undefined, x: +rect.x.toFixed(2), y: +rect.y.toFixed(2), width: +rect.width.toFixed(2), height: +rect.height.toFixed(2) }
  }))
}
function courseWordPoint(word) {
  const root = document.querySelector('.dynFlex')
  if (!root) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node
  while(node=walker.nextNode()) {
    const offset=node.textContent.indexOf(word)
    if(offset<0 || node.parentElement.closest('button,input,textarea,code,pre,.katex')) continue
    node.parentElement.scrollIntoView({block:'center'})
    const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+word.length)
    const r=range.getBoundingClientRect()
    if(r.width>0 && r.height>0) return {x:r.x+r.width/2,y:r.y+r.height/2}
  }
  return null
}
function ocrState() {
  const state = window.__LIA_CANVAS_OCR__ || {}
  return { pairMode: document.querySelector('.lia-canvas-mount canvas')?.closest('.lia-canvas-pair')?.getAttribute('data-canvas-mode'), tfjsLoaded: !!state.tfjs, plusTfjsLoaded: !!state.canvasPlusTfjs, activeLoadEngine: state.activeOcrLoadEngine || null, ocrKeys: state.ocr ? Object.keys(state.ocr) : [] }
}
function canvasPixels() {
  const canvas = [...document.querySelectorAll('.lia-canvas-mount canvas')].find(e => e.getBoundingClientRect().width > 50)
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let hash = 2166136261
  for (const value of pixels) hash = Math.imul(hash ^ value, 16777619)
  return (hash >>> 0).toString(16)
}
async function move(cdp, point, buttons = 0) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, buttons, pointerType: 'pen', force: buttons ? 0.6 : 0 })
}
async function click(cdp, point) {
  await move(cdp, point)
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
}
async function measure(cdp, action) {
  await delay(350)
  await cdp.evaluate('window.__mathpathPerformance.reset()')
  const start = Date.now()
  await action()
  await delay(350)
  const values = await cdp.evaluate('window.__mathpathPerformance.snapshot()')
  values.wallMs = Date.now() - start
  values.longTaskCount = values.longTasks.length
  values.maxLongTaskMs = Math.max(0, ...values.longTasks.map(task => task.duration))
  values.longTaskTotalMs = values.longTasks.reduce((sum, task) => sum + task.duration, 0)
  return values
}
async function termPoint(cdp, selector) {
  return cdp.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)})
    if (!root) return null
    root.scrollIntoView({ block: 'center' })
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node; while (node = walker.nextNode()) {
      if (!node.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(node)
      const r = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
      if (r) return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2 }
    }
    return null
  })()`)
}

async function runVariant(name, bundle) {
  const run = { name, checks: [], measurements: [], errors: [], served: {}, networkDuringWriting: [] }
  let writing = false
  report.runs.push(run)
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lia-mathpath-performance-'))
  const child = spawn(options.chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  activeChrome = child
  let cdp
  try {
    const endpoint = await waitFor(async () => {
      try { const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return `http://127.0.0.1:${port}` } catch { return null }
    })
    const version = await (await fetch(`${endpoint}/json/version`)).json(); report.browser = version.Browser
    const target = (await (await fetch(`${endpoint}/json/list`)).json()).find(item => item.type === 'page')
    cdp = await Cdp.connect(target.webSocketDebuggerUrl)
    cdp.on('Network.requestWillBeSent', event => { if (writing) run.networkDuringWriting.push({ url: event.request.url, method: event.request.method }) })
    cdp.on('Runtime.exceptionThrown', event => run.errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text))
    const courseUrl = options.url.split('?').slice(1).join('?').split('#')[0]
    cdp.on('Fetch.requestPaused', async event => {
      const url = event.request.url
      let body, contentType = 'text/markdown; charset=utf-8', label
      if (url.split('#')[0] === courseUrl) { body = courseBody; label = 'course' }
      else if (/\/mint-the-gap\/lia-mathpath(?:@|\/)/i.test(url)) {
        const filename = new URL(url).pathname.split('/').at(-1)
        if (/\/dist\/index\.js(?:[?#]|$)/i.test(url)) { body = Buffer.concat([bundle, Buffer.from(`\n//# sourceURL=https://mathpath-benchmark.invalid/lia-mathpath/${name}/dist/index.js\n`)]); contentType = 'application/javascript'; label = 'bundle' }
        else { body = resourceBodies.get(filename); label = filename }
      }
      if (body) {
        run.served[label] = (run.served[label] || 0) + 1
        await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: contentType }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'no-store' }], body: body.toString('base64') })
      } else await cdp.send('Fetch.continueRequest', { requestId: event.requestId })
    })
    for (const domain of ['Page', 'Runtime', 'Network']) await cdp.send(`${domain}.enable`)
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installMeasurements.toString()})(${options.timingOnly === 'true'})` })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
    await cdp.send('Page.navigate', { url: `${options.url.split('#')[0]}#${options.slide}` })
    await waitFor(() => cdp.evaluate('!!window.__LIA_MATHPATH__ && document.readyState === "complete" && document.querySelectorAll(".lia-canvas-launch").length > 0'), Boolean, 90_000)
    // Let six 1200ms initialization retries finish before measuring steady-state writing.
    await delay(10_000)
    run.initialState = await cdp.evaluate(`({ hash: location.hash, title: document.title, canvasLaunches: document.querySelectorAll('.lia-canvas-launch').length, registrations: window.__mathpathPerformance.registrations, headings: [...document.querySelectorAll('h1,h2')].map(e => e.textContent) })`)
    await cdp.evaluate(`(() => { const button = [...document.querySelectorAll('.lia-canvas-launch')].find(e => e.getBoundingClientRect().width > 0); button?.scrollIntoView({block:'center'}); button?.click(); return !!button })()`)
    await waitFor(() => cdp.evaluate(`(() => { const canvas = [...document.querySelectorAll('.lia-canvas-mount canvas')].find(e => e.getBoundingClientRect().width > 50); return !!canvas })()`))
    await cdp.evaluate(`(() => { const canvas = [...document.querySelectorAll('.lia-canvas-mount canvas')].find(e => e.getBoundingClientRect().width > 50); canvas.scrollIntoView({block:'center'}); return true })()`)
    await delay(1500)
    run.layout = await cdp.evaluate(`(${layoutState.toString()})()`)
    const point = await cdp.evaluate(`(() => { const canvas = [...document.querySelectorAll('.lia-canvas-mount canvas')].find(e => e.getBoundingClientRect().width > 50); const r = canvas.getBoundingClientRect(); return { x:r.x+Math.min(80,r.width/3), y:r.y+Math.min(100,r.height/2), width:r.width, height:r.height, canvasClass:canvas.className, parent:canvas.parentElement.className } })()`)
    run.canvas = point
    run.canvas.hitTarget = await cdp.evaluate(`document.elementFromPoint(${point.x},${point.y})?.matches('.lia-canvas-mount canvas')`)
    if (!run.canvas.hitTarget) throw new Error('Stroke start is covered by canvas controls')
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const screenshotFile = path.resolve(root, path.dirname(options.output), `${name}.png`)
    await writeFile(screenshotFile, Buffer.from(shot.data, 'base64')); run.screenshot = screenshotFile
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    run.ocrBefore = await cdp.evaluate(`(${ocrState.toString()})()`)
    writing = true
    for (let repeat = 0; repeat < Number(options.repeats); repeat++) {
      const strokePoint = { ...point, y: point.y + repeat * 25 }
      const pixelsBefore = await cdp.evaluate(`(${canvasPixels.toString()})()`)
      const metrics = await measure(cdp, async () => {
        await move(cdp, strokePoint)
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: strokePoint.x, y: strokePoint.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 })
        for (let i = 0; i < Number(options.moves); i++) {
          await move(cdp, { x: strokePoint.x + (i % 80) * Math.min(2, (point.width - 110) / 80), y: strokePoint.y + 15 * Math.sin(i / 5) }, 1)
          await delay(8)
        }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: strokePoint.x, y: strokePoint.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
      })
      const pixelsAfter = await cdp.evaluate(`(${canvasPixels.toString()})()`)
      run.measurements.push({ kind: 'canvas-writing', repeat, pixelsBefore, pixelsAfter, ...metrics })
      run.checks.push({ name: `Pen stroke ${repeat + 1} changes actual canvas pixels`, ok: pixelsBefore !== pixelsAfter })
      process.stderr.write(`${name} writing ${repeat + 1}: caret=${metrics.caretCalls}, body=${metrics.bodyTextWalks}, long=${metrics.longTaskCount}, max=${metrics.maxLongTaskMs}\n`)
    }
    writing = false
    run.ocrAfter = await cdp.evaluate(`(${ocrState.toString()})()`)
    const drawnShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    run.drawnScreenshot = path.resolve(root, path.dirname(options.output), `${name}-drawn.png`)
    await writeFile(run.drawnScreenshot, Buffer.from(drawnShot.data, 'base64'))
    run.toolbar = await cdp.evaluate(`(() => { const row = document.querySelector('.bm-row') || document.querySelector('.lia-canvas-mount'); const button = row.querySelector('button') || document.querySelector('.lia-canvas-launch'); window.__performanceToolbar = {row, button}; return { row:row.className, button:button.className } })()`)
    const toolbarMetrics = await measure(cdp, () => cdp.evaluate(`(async () => {
      const {row,button}=window.__performanceToolbar
      for (let i=0;i<30;i++) {
        row.classList.toggle('performance-toolbar-active', i%2===0)
        button.classList.toggle('performance-button-active', i%2===0)
        button.id='performance-toolbar-'+i
        await new Promise(resolve=>setTimeout(resolve,40))
      }
    })()`))
    run.measurements.push({ kind: 'toolbar-mutations', ...toolbarMetrics })
    if (options.timingOnly !== 'true') run.checks.push({ name: 'Instrumentation identified the MathPath document pointer handler', ok: run.initialState.registrations.some(entry => entry.target === 'document') })
    if (name === 'fixed' && options.timingOnly !== 'true') {
      run.checks.push({ name: 'Canvas writing avoids caret and range hit tests', ok: run.measurements.filter(m => m.kind === 'canvas-writing').every(m => m.canvasMoves >= Number(options.moves) * 0.95 && m.canvasCaretCalls === 0 && m.canvasPointerRangeReads === 0) })
      run.checks.push({ name: 'Repeated irrelevant toolbar mutations avoid full body text scans', ok: toolbarMetrics.bodyTextWalks === 0 })
    }
    // Functional probes run after performance measurements; they do not alter either measured layout.
    await cdp.evaluate(`(() => { const host = document.createElement('p'); host.id='performance-dynamic-content'; host.textContent='Bruch'; document.querySelector('.lia-canvas-mount canvas').closest('.flex-child').prepend(host); return true })()`)
    await delay(700)
    let term = await termPoint(cdp, '#performance-dynamic-content')
    await move(cdp, term); await delay(400)
    let tooltip = await cdp.evaluate(`(${tooltipState.toString()})()`)
    run.checks.push({ name: 'New plain-text glossary content supports hover', ok: tooltip.open && tooltip.text.includes('Bruch'), tooltip })
    const canvasPoint = await cdp.evaluate(`(() => { const canvas = [...document.querySelectorAll('.lia-canvas-mount canvas')].find(e=>e.getBoundingClientRect().width>50); canvas.scrollIntoView({block:'center'}); const r=canvas.getBoundingClientRect(); return {x:r.x+Math.min(80,r.width/3),y:r.y+Math.min(100,r.height/2)} })()`)
    await move(cdp, canvasPoint); await delay(500)
    tooltip = await cdp.evaluate(`(${tooltipState.toString()})()`)
    run.checks.push({ name: 'Leaving glossary text for canvas clears an unpinned tooltip', ok: !tooltip.open, tooltip })
    term = await termPoint(cdp, '#performance-dynamic-content'); await click(cdp, term); await delay(400)
    const pinnedBefore = await cdp.evaluate(`(${tooltipState.toString()})()`)
    await cdp.evaluate(`document.querySelector('.lia-canvas-mount canvas').scrollIntoView({block:'center'})`)
    await move(cdp, canvasPoint); await delay(400)
    tooltip = await cdp.evaluate(`(${tooltipState.toString()})()`)
    run.checks.push({ name: 'Pinned tooltip stays open when pointer moves to canvas', ok: pinnedBefore.open && tooltip.open, before: pinnedBefore, tooltip })
    await click(cdp, canvasPoint)
    await cdp.evaluate(`(() => { const text = document.querySelector('#performance-dynamic-content').firstChild; if(text.nodeType !== Node.TEXT_NODE) throw new Error('Glossary probe was wrapped'); text.data='Division' })()`)
    await delay(700); term = await termPoint(cdp, '#performance-dynamic-content'); await move(cdp, term); await delay(400)
    tooltip = await cdp.evaluate(`(${tooltipState.toString()})()`)
    run.checks.push({ name: 'Changed plain-text glossary content supports hover', ok: tooltip.open && tooltip.text.includes('Division'), tooltip })
    // Pin the changed live text, then verify the tooltip tracks its exact Range after reflow.
    await click(cdp, term)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
    await delay(1000)
    const geometry = await cdp.evaluate(`(() => {
      const host = document.querySelector('#performance-dynamic-content')
      const tip = document.querySelector('.lia-mathpath-tooltip[data-open="1"]')
      if (!host || !tip) return { ok:false, reason:'Target or pinned tooltip missing' }
      const range = document.createRange(); range.selectNodeContents(host)
      const r = range.getBoundingClientRect(), t = tip.getBoundingClientRect()
      const expectedTop = Math.round(Math.max(8, r.top-tip.offsetHeight-10))
      const expectedLeft = Math.round(Math.max(8, Math.min(r.left, innerWidth-tip.offsetWidth-8)))
      return { ok: Math.abs(t.top-expectedTop)<=1 && Math.abs(t.left-expectedLeft)<=1 && t.left>=0 && t.right<=innerWidth && t.top>=0 && t.bottom<=innerHeight,
        target:{x:r.x,y:r.y,width:r.width,height:r.height}, tooltip:{x:t.x,y:t.y,width:t.width,height:t.height}, expectedTop, expectedLeft }
    })()`)
    run.checks.push({ name:'Pinned tooltip tracks its live text Range after viewport resize', ok:geometry.ok, geometry })
    await move(cdp, {x:2,y:2})
    await cdp.evaluate(`location.hash=${JSON.stringify(String(Number(options.slide) + 1))}`)
    await delay(1800)
    const away = await cdp.evaluate('location.hash')
    tooltip = await cdp.evaluate(`(${tooltipState.toString()})()`)
    run.checks.push({name:'Changing slides closes the previous pinned tooltip',ok:!tooltip.open,tooltip})
    const nextTerm = await cdp.evaluate(`(${courseWordPoint.toString()})('Bruch')`)
    if (nextTerm) await move(cdp,nextTerm)
    await delay(400)
    tooltip = await cdp.evaluate(`(${tooltipState.toString()})()`)
    run.checks.push({name:'Actual glossary text on the next slide supports hover',ok:!!nextTerm && tooltip.open && tooltip.text.includes('Bruch'),tooltip})
    await move(cdp,{x:2,y:2})
    await cdp.evaluate(`location.hash=${JSON.stringify(options.slide)}`)
    await delay(1800)
    const returnTerm = await cdp.evaluate(`(${courseWordPoint.toString()})('Terms')`)
    if (returnTerm) await move(cdp,returnTerm)
    await delay(400)
    tooltip = await cdp.evaluate(`(${tooltipState.toString()})()`)
    run.checks.push({name:'Actual glossary text supports hover after returning to the canvas slide',ok:!!returnTerm && tooltip.open && tooltip.text.includes('Term'),away,tooltip})
    run.resizedLayout = await cdp.evaluate(`(${layoutState.toString()})()`)
  } catch (error) { run.fatalError = error.stack } finally {
    if (cdp) { try { await cdp.send('Browser.close', {}, 5000) } catch {} cdp.socket.close() }
    if (child.exitCode === null) child.kill()
    await delay(500)
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(profile))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe Chrome profile cleanup path')
    try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); run.profileRemoved = true } catch (error) { run.cleanupError = error.message }
  }
}

try {
  await access(options.chrome)
  for (const [name, bundle] of variants) await runVariant(name, bundle)
  const [before, after] = report.runs
  report.checks.push({ name: 'Identical course bytes and measured layout with both bundles', ok: !!before.layout && JSON.stringify(before.layout) === JSON.stringify(after.layout), courseSha256: report.courseSha256 })
  report.checks.push({ name: 'Both requested bundles and unchanged course were served', ok: report.runs.every(run => run.served.bundle > 0 && run.served.course > 0) })
  report.ok = report.errors.length === 0 && report.checks.every(check => check.ok) && report.runs.every(run => !run.fatalError && run.errors.length === 0 && run.checks.every(check => check.ok))
} catch (error) { report.errors.push(error.stack); report.ok = false }
report.finishedAt = new Date().toISOString()
report.limits = [
  'Headless Chrome CDP pen input, no physical stylus hardware or original user Chrome trace.',
  'Same local course bytes and viewport in both runs; only MathPath bundle changes. Remote imported templates are fetched live.',
  'Long tasks include every imported template. Body text walks and pointer timing are attributed to MathPath by script URL; instrumentation overhead is included.',
  'Dynamic-content probes run after the unchanged-layout performance measurements.',
  'Default fallback course is Fortbildung/Erkunden.md, Erweiterte Quizarten (canvas Aufgabe 1), not an identified original Aufgabe 7.'
]
await writeFile(path.resolve(root, options.output), JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify({ ok: report.ok, output: options.output, checks: report.checks, runs: report.runs.map(({ name, fatalError, measurements, checks }) => ({ name, fatalError, measurements, checks })) }, null, 2) + '\n')
process.exitCode = report.ok ? 0 : 1
