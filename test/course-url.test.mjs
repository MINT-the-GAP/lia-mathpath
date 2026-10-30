import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'fflate'
import { JSDOM } from 'jsdom'

const canonicalGzipOptions = { level: 6, mem: 8, mtime: 0 }
const gzipCourse = markdown => 'data:text/plain;charset=utf-8;Content-Encoding=gzip;base64,' +
  Buffer.from(gzipSync(Buffer.from(markdown), canonicalGzipOptions)).toString('base64')

test('course source resolution supports live and encoded Freeze URLs without submission fragments', async () => {
  const dom = new JSDOM('', { url: 'https://example.test/course/' })
  const names = ['window', 'document', 'location']
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] })
    const { getCourseMarkdownUrl } = await import('../src/store.ts')
    const course = 'https://raw.githubusercontent.com/org/repo/main/course.md'
    const dataCourse = gzipCourse('<!--\nversion: 1.0.0\n-->\n\n# Kurs')
    const cases = [
      [`https://liascript.github.io/course/?${course}#2`, course],
      [`https://liascript.github.io/course/?${encodeURIComponent(course + '#submission=gz:abc')}#4`, course],
      [`https://liascript.github.io/course/?${encodeURIComponent(course + '?v=2&mode=1#submission=gz:abc')}#4`, course + '?v=2&mode=1'],
      [`https://liascript.github.io/course/?${course}?v=2&mode=1#4`, course + '?v=2&mode=1'],
      ['https://liascript.github.io/course/?https://example.test/with%20space.md#2', 'https://example.test/with%20space.md'],
      ['https://liascript.github.io/course/?' + encodeURIComponent('https://example.test/with%20space.md#submission=gz:x'), 'https://example.test/with%20space.md'],
      ['https://mint-the-gap.github.io/Aufgabensammlung/course-frame.html?parent:schullia-0123456789abcdef', 'parent:schullia-0123456789abcdef'],
      ['https://mint-the-gap.github.io/Aufgabensammlung/course-frame.html?' + encodeURIComponent('parent:schullia-0123456789abcdef#submission=gz:x'), 'parent:schullia-0123456789abcdef'],
      ['https://liascript.github.io/course/?' + dataCourse + '#2', dataCourse],
      ['https://liascript.github.io/course/?' + encodeURIComponent(dataCourse + '#submission=gz:x'), dataCourse],
      ['https://example.test/course/?parent:other-0123456789abcdef', null],
      ['https://example.test/course/?parent:schullia-short', null],
      ['https://example.test/course/?invalid', null],
      ['https://example.test/course/?javascript%3Aalert(1)', null]
    ]
    for (const [url, expected] of cases) {
      dom.reconfigure({ url })
      assert.equal(getCourseMarkdownUrl(), expected, url)
    }
  } finally {
    dom.window.close()
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})

test('reads only the exact bounded LiaScript gzip data-course format', async () => {
  const { normalizeCourseSourceUri, readCourseMarkdown } = await import('../src/store.ts')
  const markdown = '<!--\nversion: 1.0.0\nmode: Presentation\n-->\n\n# Kurs'
  const uri = gzipCourse(markdown)
  assert.equal(normalizeCourseSourceUri(uri), uri)
  assert.equal(await readCourseMarkdown(uri), markdown)

  const prefix = 'data:text/plain;charset=utf-8;Content-Encoding=gzip;base64,'
  const variants = [
    'data:text/plain;charset=utf-8;base64,' + Buffer.from(markdown).toString('base64'),
    'data:text/html;charset=utf-8;Content-Encoding=gzip;base64,' + uri.slice(prefix.length),
    'data:text/plain;charset=utf-8;content-encoding=gzip;base64,' + uri.slice(prefix.length),
    ' ' + uri,
    uri + ' ',
    prefix + 'AAAA=',
    prefix + 'AAAA====',
    prefix + 'A'.repeat(64 * 1024),
  ]
  for (const value of variants) assert.equal(normalizeCourseSourceUri(value), null, value.slice(0, 90))

  const paddedUri = Array.from({ length: 20 }, (_, index) => gzipCourse('x'.repeat(index + 1)))
    .find(value => value.endsWith('='))
  assert.ok(paddedUri)
  const paddedPayload = paddedUri.slice(prefix.length)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const significantIndex = paddedPayload.endsWith('==')
    ? paddedPayload.length - 3
    : paddedPayload.length - 2
  const padMask = paddedPayload.endsWith('==') ? 0x0f : 0x03
  const canonicalValue = alphabet.indexOf(paddedPayload[significantIndex])
  const nonCanonicalValue = (canonicalValue & ~padMask) | 1
  const nonCanonicalPayload = paddedPayload.slice(0, significantIndex) +
    alphabet[nonCanonicalValue] + paddedPayload.slice(significantIndex + 1)
  assert.deepEqual(Buffer.from(nonCanonicalPayload, 'base64'), Buffer.from(paddedPayload, 'base64'))
  assert.equal(normalizeCourseSourceUri(prefix + nonCanonicalPayload), null)

  const corrupt = Buffer.from(gzipSync(Buffer.from(markdown), canonicalGzipOptions))
  corrupt[corrupt.length - 8] ^= 0xff
  await assert.rejects(readCourseMarkdown(prefix + corrupt.toString('base64')), /Prüfsumme/)
  await assert.rejects(readCourseMarkdown(gzipCourse(Buffer.from([0xff, 0xfe]))), /UTF-8/)
  await assert.rejects(readCourseMarkdown(gzipCourse(Buffer.alloc(2 * 1024 * 1024 + 1, 65))), /zu groß/)
  const forgedBomb = Buffer.from(gzipSync(
    Buffer.alloc(2 * 1024 * 1024 + 1, 65), canonicalGzipOptions))
  forgedBomb.writeUInt32LE(1, forgedBomb.length - 4)
  await assert.rejects(readCourseMarkdown(prefix + forgedBomb.toString('base64')), /zu groß/)
  const twoMembers = Buffer.concat([
    gzipSync(Buffer.from('a'), canonicalGzipOptions),
    gzipSync(Buffer.from('b'), canonicalGzipOptions)
  ])
  await assert.rejects(readCourseMarkdown(prefix + twoMembers.toString('base64')), /einen gzip-Datenblock/)
  const validHello = Buffer.from(gzipSync(Buffer.from('hello'), canonicalGzipOptions))
  const trailerShift = Buffer.concat([validHello, validHello.subarray(validHello.length - 8)])
  await assert.rejects(readCourseMarkdown(prefix + trailerShift.toString('base64')))
  const shiftedByOne = Buffer.alloc(validHello.length + 1)
  validHello.copy(shiftedByOne)
  const crc = validHello.subarray(validHello.length - 8, validHello.length - 4)
  const size = validHello.subarray(validHello.length - 4)
  const end = validHello.length
  shiftedByOne.set(crc, end - 7)
  shiftedByOne.set(size, end - 3)
  await assert.rejects(
    readCourseMarkdown(prefix + shiftedByOne.toString('base64')),
    /kanonischen gzip-Daten/)
  const changedHeader = Buffer.from(gzipSync(Buffer.from(markdown), canonicalGzipOptions))
  changedHeader[9] ^= 1
  await assert.rejects(readCourseMarkdown(prefix + changedHeader.toString('base64')), /kanonischen gzip-Daten/)
})
