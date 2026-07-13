// Binds hover/click glossary behavior for terms marked via data-lia-term.
// Also provides automatic glossary term highlighting in page text.

import katex from 'katex';
import { getCourseBaseUrl, getCourseMarkdownUrl, getGlossaryEntry, joinUrl, STORE } from './store';

let _tooltip: HTMLDivElement | null = null;
let _nestedTooltip: HTMLDivElement | null = null;
let _pinnedTarget: Element | null = null;
let _tooltipPinned = false;
let _observer: MutationObserver | null = null;
let _highlightObserver: MutationObserver | null = null;
let _explainLinks: Record<string, string> = {};
let _explainLoadPromise: Promise<void> | null = null;
let _adetailsTopicsByTaskIndex: Record<number, string[]> = {};
let _adetailsLoadPromise: Promise<void> | null = null;
let _explainOverlay: HTMLDivElement | null = null;
let _explainOverlayFrame: HTMLIFrameElement | null = null;

const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'PRE', 'CODE', 'NOSCRIPT', 'TEXTAREA',
  'INPUT', 'BUTTON', 'SVG', 'CANVAS'
]);
const CODE_CONTEXT_SELECTOR = [
  'code',
  'pre',
  '.ace_editor',
  '.ace_content',
  '.ace_line',
  '.ace_text-layer',
  '.ace_gutter',
  '.lia-code',
  '.lia-code-wrapper'
].join(', ');
const EXPLAIN_MARKER = 'LIAEXPLAIN';

function decodeTopicSeparators(value: string): string {
  return String(value || '')
    .replace(/&#44;|&comma;/gi, ',')
    .replace(/\\,/g, ',');
}

function normalizeTopicKey(topic: string): string {
  return decodeTopicSeparators(topic)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

function parseExplainMarkdown(markdown: string): Record<string, string> {
  const map: Record<string, string> = {};
  const lines = String(markdown || '').split(/\r?\n/g);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(v => v.trim());

    if (cells.length < 2) continue;
    const topic = cells[0];
    const link = cells[1];
    if (!topic || !link) continue;
    if (/^-{3,}$/.test(topic) || /^-{3,}$/.test(link)) continue;

    const key = normalizeTopicKey(topic);
    if (key && !map[key]) {
      map[key] = link;
    }
  }

  return map;
}

function extractTopicsFromADetailsCall(callValue: string): string[] {
  const content = decodeTopicSeparators(callValue).trim();
  if (!content) return [];

  const sepIndex = content.indexOf(';');
  if (sepIndex < 0) return [];
  const topicPart = content.slice(sepIndex + 1);

  return topicPart
    .split(/[;,]+/g)
    .map(v => v.trim())
    .filter(v => Boolean(v) && !/=\s*BE/i.test(v) && !/^\d+(?:\.\d+)?$/.test(v));
}

function parseADetailsTopicsByIndex(markdown: string): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  const regex = /@ADetails\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(markdown)) !== null) {
    index++;
    const topics = extractTopicsFromADetailsCall(match[1] || '');
    if (topics.length > 0) {
      map[index] = topics;
    }
  }

  return map;
}

function ensureADetailsTopicsLoaded(): Promise<void> {
  if (_adetailsLoadPromise) return _adetailsLoadPromise;

  _adetailsLoadPromise = (async () => {
    const markdownUrl = getCourseMarkdownUrl();
    if (!markdownUrl) return;

    try {
      const resp = await fetch(markdownUrl);
      if (!resp.ok) return;
      const markdown = await resp.text();
      _adetailsTopicsByTaskIndex = parseADetailsTopicsByIndex(markdown);
    } catch (_) {
      // Optional fallback only.
    }
  })();

  return _adetailsLoadPromise;
}

function ensureExplainLinksLoaded(): Promise<void> {
  if (_explainLoadPromise) return _explainLoadPromise;

  _explainLoadPromise = (async () => {
    const baseUrl = getCourseBaseUrl();
    const candidates = [joinUrl(baseUrl, 'Explain.md')];

    for (let i = 0; i < candidates.length; i++) {
      try {
        const resp = await fetch(candidates[i]);
        if (!resp.ok) continue;
        const markdown = await resp.text();
        const parsed = parseExplainMarkdown(markdown);
        if (Object.keys(parsed).length > 0) {
          _explainLinks = parsed;
          return;
        }
      } catch (_) {
        // Try next candidate.
      }
    }
  })();

  return _explainLoadPromise;
}

function extractTopicsFromADetails(attrValue: string): string[] {
  const raw = decodeTopicSeparators(attrValue).trim();
  if (!raw) return [];

  const parts = raw.split(';').map(v => v.trim()).filter(Boolean);
  if (parts.length < 2) return [];

  const topicPart = parts.slice(1).join(';');
  return topicPart
    .split(/[;,]+/g)
    .map(v => v.trim())
    .filter(v => Boolean(v) && !/=\s*BE/i.test(v) && !/^\d+(?:\.\d+)?$/.test(v));
}

function resolveTopicLink(topic: string): string | null {
  const normalized = normalizeTopicKey(topic);
  if (!normalized) return null;
  return _explainLinks[normalized] || null;
}

function findClosestADetails(anchor: Element): Element | null {
  const details = Array.from(document.querySelectorAll('[data-adetails], [data-adetails-all]'));
  if (details.length === 0) return null;

  let previous: Element | null = null;

  for (let i = 0; i < details.length; i++) {
    const rel = anchor.compareDocumentPosition(details[i]);
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) {
      if (previous) return previous;
      return details[i];
    }
    previous = details[i];
  }

  return previous || details[0] || null;
}

function findRelatedADetails(element: Element): Element | null {
  const local = element.closest('[data-adetails], [data-adetails-all], [data-adetails-raw], [data-adetail-tags]');
  if (local) return local;

  const quiz = element.closest('.lia-quiz');
  if (quiz) {
    const inQuiz = quiz.querySelector('[data-adetails], [data-adetails-all], [data-adetails-raw], [data-adetail-tags]');
    if (inQuiz) return inQuiz;
  }

  return findClosestADetails(element);
}

function extractTopicsFromDetailElement(details: Element): string[] {
  const jsonTags = details.getAttribute('data-adetail-tags');
  if (jsonTags) {
    try {
      const parsed = JSON.parse(jsonTags);
      if (Array.isArray(parsed)) {
        const topics = parsed.map(v => String(v).trim()).filter(Boolean);
        if (topics.length > 0) return topics;
      }
    } catch (_) {
      // Fall back to parsing adetails raw text.
    }
  }

  const adetails =
    details.getAttribute('data-adetails-all') ||
    details.getAttribute('data-adetails') ||
    details.getAttribute('data-adetails-raw') ||
    '';
  const parsed = extractTopicsFromADetails(adetails);

  let fallbackTopics: string[] = [];

  const taskIndex = Number(details.getAttribute('data-adetails-task-index') || details.getAttribute('data-adetails-seq') || '');
  if (Number.isFinite(taskIndex) && taskIndex > 0 && _adetailsTopicsByTaskIndex[taskIndex]) {
    fallbackTopics = _adetailsTopicsByTaskIndex[taskIndex];
  }

  const quiz = details.closest('.lia-quiz');
  if (quiz && fallbackTopics.length === 0) {
    const quizzes = Array.from(document.querySelectorAll('.lia-quiz'));
    const quizIndex = quizzes.indexOf(quiz) + 1;
    if (quizIndex > 0 && _adetailsTopicsByTaskIndex[quizIndex]) {
      fallbackTopics = _adetailsTopicsByTaskIndex[quizIndex];
    }
  }

  if (fallbackTopics.length === 0) {
    const allDetails = Array.from(document.querySelectorAll('[data-adetails], [data-adetails-all], [data-adetails-raw], [data-adetail-tags]'));
    const detailsIndex = allDetails.indexOf(details) + 1;
    if (detailsIndex > 0 && _adetailsTopicsByTaskIndex[detailsIndex]) {
      fallbackTopics = _adetailsTopicsByTaskIndex[detailsIndex];
    }
  }

  if (fallbackTopics.length > parsed.length) {
    return fallbackTopics;
  }

  if (parsed.length > 0) return parsed;

  return [];
}

function buildExplainItem(topic: string, link: string): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'lia-mathpath-no-glossary';

  const a = document.createElement('a');
  a.href = link;
  a.className = 'lia-mathpath-explain-link';
  a.setAttribute('data-lia-explain-href', link);
  a.textContent = topic;

  item.appendChild(document.createTextNode('Schau dir nochmal die Erklärung zum Thema '));
  item.appendChild(a);
  item.appendChild(document.createTextNode(' an, dann klappt es bestimmt.'));
  return item;
}

function processExplainAnchors(scope: ParentNode = document): void {
  const anchors = scope.querySelectorAll('.lia-mathpath-explain-anchor:not([data-lia-explain-processed="1"])');
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i] as HTMLElement;
    anchor.setAttribute('data-lia-explain-processed', '1');

    const details = findRelatedADetails(anchor);
    if (!details) continue;

    const topics = extractTopicsFromDetailElement(details);
    if (topics.length === 0) continue;

    const list = document.createElement('ul');
    list.className = 'lia-mathpath-explain-list lia-mathpath-no-glossary';

    let created = 0;
    for (let t = 0; t < topics.length; t++) {
      const topic = topics[t];
      const link = resolveTopicLink(topic);
      if (!link) continue;
      list.appendChild(buildExplainItem(topic, link));
      created++;
    }

    if (created > 0) {
      anchor.appendChild(list);
    }
  }
}

function buildExplainListForContext(context: Element): HTMLUListElement | null {
  let topics: string[] = [];

  const quiz = context.closest('.lia-quiz');
  if (quiz) {
    const quizzes = Array.from(document.querySelectorAll('.lia-quiz'));
    const quizIndex = quizzes.indexOf(quiz) + 1;
    if (quizIndex > 0 && _adetailsTopicsByTaskIndex[quizIndex]) {
      topics = _adetailsTopicsByTaskIndex[quizIndex];
    }
  }

  if (topics.length === 0) {
    const details = findRelatedADetails(context);
    if (!details) return null;
    topics = extractTopicsFromDetailElement(details);
  }

  if (topics.length === 0) return null;

  const list = document.createElement('ul');
  list.className = 'lia-mathpath-explain-list lia-mathpath-no-glossary';

  let created = 0;
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const link = resolveTopicLink(topic);
    if (!link) continue;
    list.appendChild(buildExplainItem(topic, link));
    created++;
  }

  return created > 0 ? list : null;
}

function processExplainTextMarkers(scope: Node = document.body): void {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  const nodes: Text[] = [];
  let current: Node | null;

  while ((current = walker.nextNode()) !== null) {
    if (current.nodeType !== Node.TEXT_NODE) continue;
    const text = current.textContent || '';
    if (!text.includes(EXPLAIN_MARKER)) continue;
    if (!current.parentElement) continue;
    if (current.parentElement.closest('.lia-quiz__hints')) continue;
    nodes.push(current as Text);
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const parent = node.parentElement;
    if (!parent) continue;

    const list = buildExplainListForContext(parent);
    if (!list) continue;

    const parts = (node.textContent || '').split(EXPLAIN_MARKER);
    const fragment = document.createDocumentFragment();

    for (let p = 0; p < parts.length; p++) {
      if (parts[p]) {
        fragment.appendChild(document.createTextNode(parts[p]));
      }
      if (p < parts.length - 1) {
        fragment.appendChild(list.cloneNode(true));
      }
    }

    parent.insertBefore(fragment, node);
    parent.removeChild(node);
  }
}

function processExplainHintMarkers(scope: ParentNode = document): void {
  const hintItems = scope.querySelectorAll('.lia-quiz__hints li:not([data-lia-explain-processed="1"])');
  for (let i = 0; i < hintItems.length; i++) {
    const item = hintItems[i] as HTMLLIElement;

    const normalized = (item.textContent || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!normalized.includes(EXPLAIN_MARKER)) {
      item.setAttribute('data-lia-explain-processed', '1');
      continue;
    }

    const list = buildExplainListForContext(item);
    if (!list || !item.parentElement) continue;

    const parent = item.parentElement;
    while (list.firstChild) {
      parent.insertBefore(list.firstChild, item);
    }
    parent.removeChild(item);
    parent.classList.add('lia-mathpath-no-glossary');
  }
}

function processExplainHintButtonFallback(scope: ParentNode = document): void {
  const quizzes = scope.querySelectorAll('.lia-quiz[data-hint-button="1"]');
  for (let i = 0; i < quizzes.length; i++) {
    const quiz = quizzes[i] as HTMLElement;
    const fallbackButton = quiz.querySelector('.lia-mathpath-explain-hint-toggle');
    const fallbackList = quiz.querySelector('.lia-mathpath-explain-hint-list');

    if (fallbackButton) fallbackButton.remove();
    if (fallbackList) fallbackList.remove();

    const expected = buildExplainListForContext(quiz);
    const nativeList = quiz.querySelector('.lia-quiz__hints');
    if (!expected || !nativeList) continue;

    const nativeHintButton = quiz.querySelector('button.lia-quiz__hint') as HTMLButtonElement | null;
    if (!quiz.hasAttribute('data-lia-native-hints-open')) {
      quiz.setAttribute('data-lia-native-hints-open', '0');
    }

    if (nativeHintButton) {
      if (!nativeHintButton.hasAttribute('data-lia-native-hints-bound')) {
        nativeHintButton.setAttribute('data-lia-native-hints-bound', '1');
        nativeHintButton.addEventListener('click', () => {
          const isOpen = quiz.getAttribute('data-lia-native-hints-open') === '1';
          const nextOpen = !isOpen;
          quiz.setAttribute('data-lia-native-hints-open', nextOpen ? '1' : '0');
          (nativeList as HTMLElement).style.display = nextOpen ? '' : 'none';
        });
      }
    } else {
      quiz.setAttribute('data-lia-native-hints-open', '0');
    }

    const open = quiz.getAttribute('data-lia-native-hints-open') === '1';
    (nativeList as HTMLElement).style.display = open ? '' : 'none';

    const seenInNative = new Set<string>();
    const nativeItems = Array.from(nativeList.querySelectorAll('li'));
    for (let ni = 0; ni < nativeItems.length; ni++) {
      const li = nativeItems[ni];
      const markerProbe = ((li.textContent || '').replace(/[^a-z0-9]/gi, '').toUpperCase());
      if (markerProbe.includes(EXPLAIN_MARKER)) {
        li.remove();
        continue;
      }

      const topicKey = normalizeTopicKey(li.querySelector('a')?.textContent || li.textContent || '');
      if (!topicKey) continue;
      if (seenInNative.has(topicKey)) {
        li.remove();
        continue;
      }
      seenInNative.add(topicKey);
    }

    const existing = new Set(
      Array.from(nativeList.querySelectorAll('li a'))
        .map(a => normalizeTopicKey(a.textContent || ''))
        .filter(Boolean)
    );

    const expectedItems = Array.from(expected.querySelectorAll('li'));
    for (let ei = 0; ei < expectedItems.length; ei++) {
      const a = expectedItems[ei].querySelector('a');
      const topicKey = normalizeTopicKey(a?.textContent || '');
      if (!topicKey || existing.has(topicKey)) continue;
      nativeList.appendChild(expectedItems[ei].cloneNode(true));
      existing.add(topicKey);
    }

    nativeList.classList.add('lia-mathpath-no-glossary');
    quiz.setAttribute('data-lia-explain-fallback', 'native');
  }
}

function ensureExplainOverlay(): HTMLDivElement {
  if (_explainOverlay && _explainOverlay.isConnected && _explainOverlayFrame) return _explainOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'lia-mathpath-explain-overlay';
  overlay.setAttribute('data-open', '0');

  const dialog = document.createElement('div');
  dialog.className = 'lia-mathpath-explain-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Erklaerung');

  const header = document.createElement('div');
  header.className = 'lia-mathpath-explain-header';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lia-mathpath-explain-close';
  close.setAttribute('aria-label', 'Overlay schließen');
  close.textContent = 'Schließen';

  const frame = document.createElement('iframe');
  frame.className = 'lia-mathpath-explain-frame';
  frame.loading = 'lazy';
  frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

  close.addEventListener('click', () => {
    closeExplainOverlay();
  });

  overlay.addEventListener('click', ev => {
    const target = ev.target as Element | null;
    if (!target) return;
    if (target.classList.contains('lia-mathpath-explain-overlay')) {
      closeExplainOverlay();
    }
  });

  header.appendChild(close);
  dialog.appendChild(header);
  dialog.appendChild(frame);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  _explainOverlay = overlay;
  _explainOverlayFrame = frame;
  return overlay;
}

function closeExplainOverlay(): void {
  const overlay = ensureExplainOverlay();
  overlay.setAttribute('data-open', '0');
  document.body.classList.remove('lia-mathpath-overlay-open');
  if (_explainOverlayFrame) {
    _explainOverlayFrame.src = 'about:blank';
  }
}

function openExplainOverlay(url: string): void {
  if (!url) return;
  const overlay = ensureExplainOverlay();
  if (_explainOverlayFrame) {
    _explainOverlayFrame.src = url;
  }
  overlay.setAttribute('data-open', '1');
  document.body.classList.add('lia-mathpath-overlay-open');
}

function isInsideTooltip(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return !!element?.closest('.lia-mathpath-tooltip');
}

function ensureTooltip(isNested = false): HTMLDivElement {
  const existing = isNested ? _nestedTooltip : _tooltip;
  if (existing && existing.isConnected) return existing;

  const tip = document.createElement('div');
  tip.className = 'lia-mathpath-tooltip';
  if (isNested) {
    tip.classList.add('lia-mathpath-tooltip--nested');
    _nestedTooltip = tip;
  } else {
    _tooltip = tip;
  }
  tip.setAttribute('data-open', '0');
  document.body.appendChild(tip);
  return tip;
}

function hideTooltip(isNested = false): void {
  const tip = ensureTooltip(isNested);
  tip.setAttribute('data-open', '0');
  tip.textContent = '';
}

function clearPinnedTooltip(): void {
  _tooltipPinned = false;
  _pinnedTarget = null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTooltipMarkup(text: string): string {
  const mathPattern = /(\$\$)([\s\S]+?)\1|(\$)([^\n$]+?)\3|\\\(([\s\S]+?)\\\)/g;
  let lastIndex = 0;
  let html = '';
  let match: RegExpExecArray | null;

  while ((match = mathPattern.exec(text)) !== null) {
    html += escapeHtml(text.slice(lastIndex, match.index)).replace(/\n/g, '<br>');

    const expression = match[2] || match[4] || match[5] || '';
    const displayMode = !!match[1];
    html += katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      output: 'html'
    });

    lastIndex = mathPattern.lastIndex;
  }

  html += escapeHtml(text.slice(lastIndex)).replace(/\n/g, '<br>');
  return html;
}

function placeTooltip(rect: DOMRect, isNested = false): void {
  const tip = ensureTooltip(isNested);
  const top = isNested
    ? Math.max(8, rect.top - tip.offsetHeight - 18)
    : Math.max(8, rect.top - tip.offsetHeight - 10);
  const left = isNested
    ? Math.max(8, Math.min(rect.right + 14, window.innerWidth - tip.offsetWidth - 8))
    : Math.max(8, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 8));
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
}

function showForTarget(target: Element): void {
  const isNested = !!target.closest('.lia-mathpath-tooltip');
  const targetRect = target.getBoundingClientRect();
  const term = target.getAttribute('data-lia-term') || target.textContent || '';
  const entry = getGlossaryEntry(term);
  if (!entry) return;

  const tip = ensureTooltip(isNested);
  const related = entry.links.length ? `\n${entry.links.join(' | ')}` : '';
  const title = `<div class="lia-mathpath-tooltip-title"><span class="lia-mathpath-glossary-highlight lia-mathpath-term" data-lia-term="${escapeHtml(entry.term)}">${escapeHtml(entry.term)}</span></div>`;
  const body = `<div class="lia-mathpath-tooltip-body">${renderTooltipMarkup(`${entry.explanation}${related}`)}</div>`;
  tip.innerHTML = `${title}${body}`;
  highlightGlossaryTermsInTooltip(tip);
  bindInScope(tip);
  tip.setAttribute('data-open', '1');
  placeTooltip(targetRect, isNested);
}

function bindElement(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  if (!el.hasAttribute('data-lia-term')) return;
  if (el.closest('div.notip')) return;
  if (el.closest(CODE_CONTEXT_SELECTOR)) return;
  if (el.dataset.liaMathpathBound === '1') return;

  el.dataset.liaMathpathBound = '1';
  el.classList.add('lia-mathpath-term');

  el.addEventListener('mouseenter', function () {
    showForTarget(el);
  });

  el.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    _tooltipPinned = true;
    _pinnedTarget = el;
    showForTarget(el);
  });

  el.addEventListener('mouseleave', function (ev) {
    const nextTarget = ev.relatedTarget as Node | null;
    if (nextTarget && isInsideTooltip(nextTarget)) return;
    if (_tooltipPinned) return;
    hideTooltip();
  });

  el.addEventListener('click', function () {
    _tooltipPinned = true;
    _pinnedTarget = el;
    showForTarget(el);
  });
}

function bindInScope(scope: ParentNode): void {
  const nodes = scope.querySelectorAll('[data-lia-term]');
  for (let i = 0; i < nodes.length; i++) {
    bindElement(nodes[i]);
  }
}

function shouldSkipElement(el: Node, allowTooltipContent = false): boolean {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName;
  if (EXCLUDED_TAGS.has(tag)) return true;
  if (el.closest('div.notip')) return true;
  if (el.closest(CODE_CONTEXT_SELECTOR)) return true;
  if (allowTooltipContent && el.closest('.katex')) return true;
  if (!allowTooltipContent && el.closest('.lia-mathpath-tooltip')) return true;
  if (el.closest('.lia-mathpath-no-glossary')) return true;
  if (el.classList.contains('lia-mathpath-glossary-highlight')) return true;
  if (el.classList.contains('lia-mathpath-term')) return true;
  return false;
}

function shouldProcessNode(node: Node, allowTooltipContent = false): boolean {
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent || '';
  if (text.trim().length < 1) return false;
  if (node.parentElement && shouldSkipElement(node.parentElement, allowTooltipContent)) return false;
  return true;
}

function highlightTermInNode(node: Node, term: string, allowTooltipContent = false): boolean {
  if (!shouldProcessNode(node, allowTooltipContent)) return false;

  const text = node.textContent || '';
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedTerm}[a-zäöüß]*`, 'gi');
  if (!regex.test(text)) return false;

  let lastIndex = 0;
  const fragments: Node[] = [];
  let match: RegExpExecArray | null;
  const regexGlobal = new RegExp(`\\b${escapedTerm}[a-zäöüß]*`, 'gi');

  while ((match = regexGlobal.exec(text)) !== null) {
    if (match.index > lastIndex) {
      fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
    }

    const highlightSpan = document.createElement('span');
    highlightSpan.className = 'lia-mathpath-glossary-highlight';
    highlightSpan.setAttribute('data-lia-term', term);
    highlightSpan.textContent = match[0];
    fragments.push(highlightSpan);

    lastIndex = regexGlobal.lastIndex;
  }

  if (lastIndex < text.length) {
    fragments.push(document.createTextNode(text.substring(lastIndex)));
  }

  if (fragments.length > 0 && node.parentElement) {
    const parent = node.parentElement;
    for (let i = 0; i < fragments.length; i++) {
      parent.insertBefore(fragments[i], node);
    }
    parent.removeChild(node);
    return true;
  }

  return false;
}

function highlightGlossaryTermsInNode(node: Node, allowTooltipContent = false): void {
  if (!shouldProcessNode(node, allowTooltipContent)) return;

  const terms = Object.keys(STORE.glossary);
  for (let i = 0; i < terms.length; i++) {
    if (highlightTermInNode(node, terms[i], allowTooltipContent)) {
      return;
    }
  }
}

function highlightGlossaryTermsInScope(scope: Node = document.body, allowTooltipContent = false): void {
  const terms = Object.keys(STORE.glossary);
  if (terms.length === 0) return;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  const queue: Node[] = [];
  let currentNode: Node | null;

  while ((currentNode = walker.nextNode()) !== null) {
    queue.push(currentNode);
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const node = queue[qi];
    if (!shouldProcessNode(node, allowTooltipContent)) continue;

    for (let ti = 0; ti < terms.length; ti++) {
      if (!shouldProcessNode(node, allowTooltipContent)) break;

      const parent = node.parentNode;
      if (highlightTermInNode(node, terms[ti], allowTooltipContent)) {
        if (parent) {
          const siblings = parent.childNodes;
          for (let si = 0; si < siblings.length; si++) {
            const sib = siblings[si];
            if (sib.nodeType === Node.TEXT_NODE && sib !== node && queue.indexOf(sib) < 0) {
              queue.push(sib);
            }
          }
        }
        break;
      }
    }
  }
}

export function highlightGlossaryTerms(scope: Node = document.body): void {
  highlightGlossaryTermsInScope(scope);
}

function highlightGlossaryTermsInTooltip(scope: Node): void {
  highlightGlossaryTermsInScope(scope, true);
}

export function bindGlossaryInteractions(scope: ParentNode): void {
  bindInScope(scope);
  highlightGlossaryTermsInScope(document.body);
  Promise.all([ensureExplainLinksLoaded(), ensureADetailsTopicsLoaded()]).then(() => {
    processExplainAnchors(document);
    processExplainTextMarkers(document.body);
    processExplainHintMarkers(document);
    processExplainHintButtonFallback(document);

    let retries = 0;
    const timer = setInterval(() => {
      retries++;
      processExplainHintMarkers(document);
      processExplainHintButtonFallback(document);
      if (retries >= 6) {
        clearInterval(timer);
      }
    }, 1200);
  });

  document.addEventListener('click', function (ev) {
    const target = ev.target as Element | null;
    if (!target) return;

    const explainLink = target.closest('.lia-mathpath-explain-link') as HTMLAnchorElement | null;
    if (explainLink) {
      ev.preventDefault();
      const href = explainLink.getAttribute('data-lia-explain-href') || explainLink.getAttribute('href') || '';
      openExplainOverlay(href);
      return;
    }

    const clickedGlossaryTerm = target.closest('.lia-mathpath-glossary-highlight') as Element | null;
    if (clickedGlossaryTerm) {
      _tooltipPinned = true;
      _pinnedTarget = clickedGlossaryTerm;
      showForTarget(clickedGlossaryTerm);
      return;
    }

    if (target.closest('.lia-mathpath-tooltip')) {
      // Clicking non-term content inside a tooltip is treated as an explicit close action.
      hideTooltip();
      hideTooltip(true);
      clearPinnedTooltip();
      return;
    }

    const hasOpenTooltip = !!document.querySelector('.lia-mathpath-tooltip[data-open="1"]');
    if (_tooltipPinned || hasOpenTooltip) {
      hideTooltip();
      hideTooltip(true);
      clearPinnedTooltip();
    }
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!_explainOverlay || _explainOverlay.getAttribute('data-open') !== '1') return;
    closeExplainOverlay();
  });

  window.addEventListener('scroll', function () {
    if (_pinnedTarget) placeTooltip(_pinnedTarget.getBoundingClientRect());
  }, true);

  window.addEventListener('resize', function () {
    if (_pinnedTarget) placeTooltip(_pinnedTarget.getBoundingClientRect());
  });
}

export function observeDynamicContent(): void {
  if (_observer) return;
  _observer = new MutationObserver(function (records) {
    let changed = false;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      for (let j = 0; j < rec.addedNodes.length; j++) {
        const node = rec.addedNodes[j];
        if (!(node instanceof Element)) continue;
        changed = true;
        bindElement(node);
        bindInScope(node);
        highlightGlossaryTermsInScope(node);
        processExplainAnchors(node);
        processExplainTextMarkers(node);
        processExplainHintMarkers(node);
        processExplainHintButtonFallback(node);
      }
    }

    if (changed) {
      processExplainHintMarkers(document);
      processExplainHintButtonFallback(document);
    }
  });

  _observer.observe(document.body, {
    childList: true,
    subtree: true
  });

}

export function onGlossaryUpdated(): void {
  if (_highlightObserver) return;
  _highlightObserver = new MutationObserver(function () {
    highlightGlossaryTermsInScope(document.body);
  });

  _highlightObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}
