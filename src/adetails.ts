// Standalone metadata presentation. Freeze takes over rendering when loaded.

export interface AssignmentDetails {
  raw: string;
  pointsValue: number | null;
  pointsParts: number[];
  tags: string[];
  badge: string;
}

function normalizeSpace(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parsePoints(raw: string): { total: number | null; parts: number[] } {
  const chunks = normalizeSpace(raw).split(/\s*\|\s*/).filter(Boolean);
  if (!chunks.length) return { total: null, parts: [] };
  const parts = chunks.map(chunk => Number(chunk.replace(',', '.')));
  if (parts.some(value => !Number.isFinite(value) || value < 0)) return { total: null, parts: [] };
  return { total: parts.reduce((sum, value) => sum + value, 0), parts };
}

/** Same point/tag grammar as lia-freeze-v2/src/adetails-dom.ts. */
export function parseAssignmentDetails(raw: string): AssignmentDetails {
  const txt = normalizeSpace(raw);
  let pointsValue: number | null = null;
  let pointsParts: number[] = [];
  const tags: string[] = [];
  const parts = txt.split(/\s*;\s*/).filter(Boolean);
  const addTags = (value: string): void => {
    value.split(',').map(normalizeSpace).filter(Boolean).forEach(tag => {
      if (!tags.includes(tag)) tags.push(tag);
    });
  };
  parts.forEach((part, index) => {
    const value = normalizeSpace(part);
    const tagKey = value.match(/^tags?\s*[:=]\s*(.+)$/i);
    if (tagKey) { addTags(tagKey[1]); return; }
    const keyed = value.match(/^(?:points?|be|punkte?)\s*[:=]\s*([\d.,]+(?:\s*\|\s*[\d.,]+)*)$/i);
    const unit = value.match(/^([\d.,]+(?:\s*\|\s*[\d.,]+)*)\s*=\s*[A-Za-z%]+$/);
    const parsed = parsePoints(keyed?.[1] ?? unit?.[1] ?? value);
    if (keyed || unit || (parsed.total !== null && pointsValue === null)) {
      if (parsed.total !== null && pointsValue === null) {
        pointsValue = parsed.total;
        pointsParts = parsed.parts;
      }
      return;
    }
    if (index >= 1 || parts.length === 1) addTags(value);
  });
  const rounded = pointsValue === null ? null : Math.round(pointsValue * 100) / 100;
  return { raw: txt, pointsValue, pointsParts, tags, badge: rounded === null ? '' : rounded + ' BE' };
}

export function readAssignmentDetails(marker: Element): AssignmentDetails {
  return parseAssignmentDetails(marker.getAttribute('data-adetails-all') ||
    marker.getAttribute('data-adetails') || marker.getAttribute('data-adetails-raw') || '');
}

/** Bounded forward lookup: a hint in quiz B must not inherit quiz A's marker. */
export function findAssignmentDetailsForQuiz(quiz: Element): Element | null {
  const nested = quiz.querySelector('[data-adetails], [data-adetails-all], [data-adetails-raw], [data-adetail-tags]');
  if (nested) return nested;
  const scope = quiz.closest('.flex-child, .lia-slide__content, .lia-slide, main') || quiz.ownerDocument.body;
  const ordered = Array.from(scope.querySelectorAll('.lia-quiz, [data-adetails], [data-adetails-all], [data-adetails-raw], [data-adetail-tags]'));
  const index = ordered.indexOf(quiz);
  if (index < 0) return null;
  const following = ordered[index + 1];
  return following && !following.matches('.lia-quiz') ? following : null;
}

/** Existing runtime signals only: this function never initializes Freeze. */
export function freezeOwnsAssignmentDetails(doc: Document = document): boolean {
  const win = doc.defaultView as (Window & {
    __liaFreezeV2LifecycleV1__?: { bootScheduled?: boolean };
    __liaSubmissionDemo?: { createLink?: unknown };
  }) | null;
  return !!(win?.__liaFreezeV2LifecycleV1__?.bootScheduled ||
    typeof win?.__liaSubmissionDemo?.createLink === 'function' ||
    doc.getElementById('lia-submission-runtime-style'));
}

type Presentation = {
  root: HTMLSpanElement;
  style: HTMLStyleElement;
  display: string;
  priority: string;
};

/** One observer per initialization; the entry-point duplicate guard owns its lifetime. */
export function installAssignmentDetails(doc: Document = document): void {
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  const states = new Map<HTMLElement, Presentation>();
  let queued = false;
  let disposed = false;

  function release(marker: HTMLElement, state: Presentation): void {
    state.root.remove();
    state.style.remove();
    // Do not overwrite a newer display value already chosen by Freeze.
    if (marker.style.getPropertyValue('display') === 'inline-block' &&
        marker.style.getPropertyPriority('display') === 'important') {
      if (state.display) marker.style.setProperty('display', state.display, state.priority);
      else marker.style.removeProperty('display');
    }
    marker.removeAttribute('data-lia-mathpath-adetails-owner');
    states.delete(marker);
  }

  function refresh(): void {
    queued = false;
    if (disposed) return;
    const freeze = freezeOwnsAssignmentDetails(doc);
    for (const [marker, state] of states) {
      if (freeze || !marker.isConnected || !marker.matches('.lia-assignment-details[data-adetails]')) release(marker, state);
    }
    if (freeze) return;
    doc.querySelectorAll<HTMLElement>('.lia-assignment-details[data-adetails]').forEach(marker => {
      if (marker.closest('pre, code, #lia-print-slides')) return;
      const spec = readAssignmentDetails(marker);
      let state = states.get(marker);
      if (!spec.badge) { if (state) release(marker, state); return; }
      if (!state) {
        let shadow = marker.shadowRoot;
        try { shadow ??= marker.attachShadow({ mode: 'open' }); } catch { return; }
        if (shadow.querySelector('[data-lia-freeze-adetails-sidecar]')) return;
        const style = doc.createElement('style');
        style.setAttribute('data-lia-mathpath-adetails', 'style');
        style.textContent = ':host{visibility:visible!important;vertical-align:middle;max-width:100%;margin:.22rem 0 .42rem .7rem;pointer-events:none!important}.lia-mathpath-adetails-points{display:inline-flex;align-items:center;gap:.28rem;font-weight:700;white-space:nowrap;opacity:.92;color:inherit;pointer-events:none!important}';
        const root = doc.createElement('span');
        root.setAttribute('data-lia-mathpath-adetails', 'points');
        root.setAttribute('part', 'points');
        root.className = 'lia-mathpath-adetails-points';
        state = { root, style, display: marker.style.getPropertyValue('display'), priority: marker.style.getPropertyPriority('display') };
        shadow.append(style, root);
        marker.setAttribute('data-lia-mathpath-adetails-owner', 'mathpath');
        marker.style.setProperty('display', 'inline-block', 'important');
        states.set(marker, state);
      }
      if (state.root.textContent !== spec.badge) state.root.textContent = spec.badge;
    });
  }

  function schedule(): void {
    if (queued || disposed) return;
    queued = true;
    win!.queueMicrotask(refresh);
  }
  const observer = new win.MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' ||
      [...record.addedNodes, ...record.removedNodes].some(node => node instanceof win!.Element))) schedule();
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-adetails', 'data-adetails-all', 'data-adetails-raw'] });
  doc.addEventListener('load', schedule, true);
  function onPageHide(event: PageTransitionEvent): void {
    if (event.persisted) return;
    disposed = true;
    observer.disconnect();
    doc.removeEventListener('load', schedule, true);
    win!.removeEventListener('pagehide', onPageHide);
    for (const [marker, state] of states) release(marker, state);
  }
  win.addEventListener('pagehide', onPageHide);
  refresh();
}
