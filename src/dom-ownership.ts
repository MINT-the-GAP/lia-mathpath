type ElmMarkedNode = Node & {
  created_by_elm?: boolean
}

/**
 * LiaScript's virtual DOM marks every light-DOM node it owns. Replacing one
 * of those nodes outside Elm breaks the next reconciliation pass.
 *
 * ShadowRoot.parentNode is null, so a component's own shadow tree remains
 * independent even when its authored host belongs to Elm.
 */
export function isElmManagedNode(node: Node): boolean {
  let current: Node | null = node
  while (current) {
    if ((current as ElmMarkedNode).created_by_elm === true) return true
    current = current.parentNode
  }
  return false
}
