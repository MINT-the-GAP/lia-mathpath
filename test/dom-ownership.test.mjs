import assert from 'node:assert/strict'
import test from 'node:test'

import { isElmManagedNode } from '../src/dom-ownership.ts'

function node(createdByElm = false, parentNode = null) {
  return { created_by_elm: createdByElm, parentNode }
}

test('detects directly Elm-owned text nodes', () => {
  assert.equal(isElmManagedNode(node(true)), true)
})

test('detects nodes inside an Elm-owned light-DOM container', () => {
  const body = node(true)
  const paragraph = node(false, body)
  const text = node(false, paragraph)
  assert.equal(isElmManagedNode(text), true)
})

test('allows MathPath-owned and shadow-tree nodes', () => {
  const foreignBody = node(false)
  const tooltip = node(false, foreignBody)
  const tooltipText = node(false, tooltip)
  const detachedShadowRoot = node(false)
  const shadowText = node(false, detachedShadowRoot)

  assert.equal(isElmManagedNode(tooltipText), false)
  assert.equal(isElmManagedNode(shadowText), false)
})
