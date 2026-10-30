import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

test('course source resolution supports live and encoded Freeze URLs without submission fragments', async () => {
  const dom = new JSDOM('', { url: 'https://example.test/course/' })
  const names = ['window', 'document', 'location']
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] })
    const { getCourseMarkdownUrl } = await import('../src/store.ts')
    const course = 'https://raw.githubusercontent.com/org/repo/main/course.md'
    const cases = [
      [`https://liascript.github.io/course/?${course}#2`, course],
      [`https://liascript.github.io/course/?${encodeURIComponent(course + '#submission=gz:abc')}#4`, course],
      [`https://liascript.github.io/course/?${encodeURIComponent(course + '?v=2&mode=1#submission=gz:abc')}#4`, course + '?v=2&mode=1'],
      [`https://liascript.github.io/course/?${course}?v=2&mode=1#4`, course + '?v=2&mode=1'],
      ['https://liascript.github.io/course/?https://example.test/with%20space.md#2', 'https://example.test/with%20space.md'],
      ['https://liascript.github.io/course/?' + encodeURIComponent('https://example.test/with%20space.md#submission=gz:x'), 'https://example.test/with%20space.md'],
      ['https://mint-the-gap.github.io/Aufgabensammlung/course-frame.html?parent:schullia-0123456789abcdef', 'parent:schullia-0123456789abcdef'],
      ['https://mint-the-gap.github.io/Aufgabensammlung/course-frame.html?' + encodeURIComponent('parent:schullia-0123456789abcdef#submission=gz:x'), 'parent:schullia-0123456789abcdef'],
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
