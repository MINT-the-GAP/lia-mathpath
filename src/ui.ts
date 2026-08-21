// Binds hover/click glossary behavior for terms marked via data-lia-term.
// Also provides automatic glossary term highlighting in page text.

import katex from 'katex';
import { isElmManagedNode } from './dom-ownership';
import {
  getCourseBaseUrl,
  getCourseMarkdownUrl,
  getGlossaryEntry,
  getGlossaryMatchForms,
  joinUrl,
  normalizeTermKey
} from './store';
import type { GlossaryMatchForm } from './store';

let _tooltip: HTMLDivElement | null = null;
let _nestedTooltip: HTMLDivElement | null = null;
let _pinnedTarget: Element | null = null;
let _pinnedVirtualMatch: VirtualGlossaryMatch | null = null;
let _tooltipPinned = false;
let _observer: MutationObserver | null = null;
let _explainLinks: Record<string, string> = {};
let _explainLoadPromise: Promise<void> | null = null;
let _adetailsTopicsByTaskIndex: Record<number, string[]> = {};
let _adetailsLoadPromise: Promise<void> | null = null;
let _explainOverlay: HTMLDivElement | null = null;
let _explainOverlayFrame: HTMLIFrameElement | null = null;
let _interactionsBound = false;
let _explainRetriesScheduled = false;
const _boundTermElements = new WeakSet<HTMLElement>();
let _virtualMatches: VirtualGlossaryMatch[] = [];
let _virtualMatchesByNode = new WeakMap<Text, VirtualGlossaryMatch[]>();
let _hoveredVirtualMatch: VirtualGlossaryMatch | null = null;
let _virtualOverlay: HTMLDivElement | null = null;
let _virtualPaintFrame = 0;
let _virtualResizeObserver: ResizeObserver | null = null;
let _lastVirtualPointerPoint: { clientX: number; clientY: number } | null = null;

const VIRTUAL_HIGHLIGHT_NAME = 'lia-mathpath-glossary';
const VIRTUAL_HOVER_HIGHLIGHT_NAME = 'lia-mathpath-glossary-hover';
const PLUGIN_OWNED_SELECTOR = [
  '.lia-mathpath-tooltip',
  '.lia-mathpath-range-layer',
  '.lia-mathpath-explain-overlay'
].join(', ');

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
const EXCLUDED_CONTEXT_SELECTOR = [
  Array.from(EXCLUDED_TAGS).map(tag => tag.toLowerCase()).join(', '),
  CODE_CONTEXT_SELECTOR,
  'div.notip',
  '.katex',
  '.katex-display',
  '.lia-mathpath-tooltip',
  '.lia-mathpath-range-layer',
  '.lia-mathpath-no-glossary'
].join(', ');
const EXPLAIN_ELEMENT_TAG = 'lia-mathpath-explain';
const EXPLAIN_EMPTY_MESSAGE = 'Leider gibt es noch keinen automatisch verlinkten Erklärungskurs.';
const EXPLAIN_ELEMENT_STYLE = [
  ':host {',
  '  display: block;',
  '}',
  '.lia-mathpath-explain-list {',
  '  margin: 0;',
  '  padding: 0;',
  '  list-style: none;',
  '}',
  '.lia-mathpath-explain-list li {',
  '  margin: 0.2rem 0;',
  '}',
  '.lia-mathpath-explain-list a {',
  '  color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 1);',
  '  text-decoration: underline;',
  '  text-underline-offset: 2px;',
  '}',
  '.lia-mathpath-explain-list a:hover {',
  '  text-decoration-thickness: 2px;',
  '}'
].join('\n');

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

/** Parses the "points-marker; topic1, topic2" format shared by @ADetails(...) call args and their rendered data-adetails* attributes. */
function extractTopicsAfterFirstSemicolon(value: string): string[] {
  const content = decodeTopicSeparators(value).trim();
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
  let fenceMarker = '';
  const searchableMarkdown = String(markdown || '')
    .split(/\r?\n/g)
    .map(line => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0];
        if (!fenceMarker) fenceMarker = marker;
        else if (fenceMarker === marker) fenceMarker = '';
        return '';
      }
      if (fenceMarker) return '';
      return line.replace(/`[^`]*`/g, '');
    })
    .join('\n');
  const regex = /@ADetails\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(searchableMarkdown)) !== null) {
    index++;
    const topics = extractTopicsAfterFirstSemicolon(match[1] || '');
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
  const elementTopics: string[] = [];
  const jsonTags = details.getAttribute('data-adetail-tags');
  if (jsonTags) {
    try {
      const parsed = JSON.parse(jsonTags);
      if (Array.isArray(parsed)) {
        elementTopics.push(...parsed.map(v => String(v).trim()).filter(Boolean));
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
  elementTopics.push(...extractTopicsAfterFirstSemicolon(adetails));

  let fallbackTopics: string[] = [];

  const taskIndex = Number(details.getAttribute('data-adetails-task-index') || details.getAttribute('data-adetails-seq') || '');
  if (Number.isFinite(taskIndex) && taskIndex > 0 && _adetailsTopicsByTaskIndex[taskIndex]) {
    fallbackTopics = _adetailsTopicsByTaskIndex[taskIndex];
  }

  if (fallbackTopics.length === 0) {
    const allDetails = Array.from(document.querySelectorAll('[data-adetails], [data-adetails-all], [data-adetails-raw], [data-adetail-tags]'));
    const detailsIndex = allDetails.indexOf(details) + 1;
    if (detailsIndex > 0 && _adetailsTopicsByTaskIndex[detailsIndex]) {
      fallbackTopics = _adetailsTopicsByTaskIndex[detailsIndex];
    }
  }

  const quiz = details.closest('.lia-quiz');
  if (quiz && fallbackTopics.length === 0) {
    const quizzes = Array.from(document.querySelectorAll('.lia-quiz'));
    const quizIndex = quizzes.indexOf(quiz) + 1;
    if (quizIndex > 0 && _adetailsTopicsByTaskIndex[quizIndex]) {
      fallbackTopics = _adetailsTopicsByTaskIndex[quizIndex];
    }
  }

  // Rendered ADetails attributes and the original Markdown can each be partial.
  const seen = new Set<string>();
  const domTopics = elementTopics.filter(topic => {
    const key = normalizeTopicKey(topic);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (domTopics.length === 0) return fallbackTopics;

  const compatibleFallback = domTopics.every((topic, index) =>
    normalizeTopicKey(topic) === normalizeTopicKey(fallbackTopics[index] || '')
  );
  if (!compatibleFallback) return domTopics;

  return [...domTopics, ...fallbackTopics.slice(domTopics.length)];
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

function buildExplainListForContext(context: Element): HTMLUListElement | null {
  let topics: string[] = [];

  const details = findRelatedADetails(context);
  if (details) {
    topics = extractTopicsFromDetailElement(details);
  }

  if (topics.length === 0) {
    const quiz = context.closest('.lia-quiz');
    const quizzes = Array.from(document.querySelectorAll('.lia-quiz'));
    const quizIndex = quiz ? quizzes.indexOf(quiz) + 1 : 0;
    if (quizIndex > 0 && _adetailsTopicsByTaskIndex[quizIndex]) {
      topics = _adetailsTopicsByTaskIndex[quizIndex];
    }
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

  if (created === 0) {
    const item = document.createElement('li');
    item.textContent = EXPLAIN_EMPTY_MESSAGE;
    list.appendChild(item);
  }

  return list;
}

class LiaMathPathExplainElement extends HTMLElement {
  private readonly content: HTMLDivElement;
  private isReady = false;

  constructor() {
    super();

    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = EXPLAIN_ELEMENT_STYLE;

    this.content = document.createElement('div');
    this.content.setAttribute('part', 'content');

    root.appendChild(style);
    root.appendChild(this.content);
    root.addEventListener('click', ev => {
      const link = ev.composedPath().find(node =>
        node instanceof HTMLAnchorElement && node.hasAttribute('data-lia-explain-href')
      ) as HTMLAnchorElement | undefined;
      if (!link) return;

      ev.preventDefault();
      const href = link.getAttribute('data-lia-explain-href') || link.href;
      openExplainOverlay(href);
    });
  }

  connectedCallback(): void {
    Promise.all([ensureExplainLinksLoaded(), ensureADetailsTopicsLoaded()]).then(() => {
      this.isReady = true;
      if (this.isConnected) this.render();
    });
  }

  render(): void {
    if (!this.isReady) return;

    const list = buildExplainListForContext(this);
    this.content.replaceChildren();
    if (list) this.content.appendChild(list);
  }
}

export function registerExplainElement(): void {
  if (!customElements.get(EXPLAIN_ELEMENT_TAG)) {
    customElements.define(EXPLAIN_ELEMENT_TAG, LiaMathPathExplainElement);
  }
}

function processExplainElements(scope: ParentNode = document): void {
  const elements = Array.from(scope.querySelectorAll(EXPLAIN_ELEMENT_TAG)) as LiaMathPathExplainElement[];
  if (scope instanceof LiaMathPathExplainElement) {
    elements.unshift(scope);
  }

  for (let i = 0; i < elements.length; i++) {
    elements[i].render();
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
  const tip = isNested ? _nestedTooltip : _tooltip;
  if (!tip || !tip.isConnected) return;
  tip.setAttribute('data-open', '0');
  tip.textContent = '';
}

function clearPinnedTooltip(): void {
  _tooltipPinned = false;
  _pinnedTarget = null;
  _pinnedVirtualMatch = null;
  setHoveredVirtualMatch(null);
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

function isExcludedGlossaryContext(element: Element): boolean {
  return !!element.closest(EXCLUDED_CONTEXT_SELECTOR);
}

function showEntryAtRect(term: string, targetRect: DOMRect, isNested = false): void {
  const entry = getGlossaryEntry(term);
  if (!entry) return;

  const tip = ensureTooltip(isNested);
  const related = entry.links.length ? `\n${entry.links.join(' | ')}` : '';
  const title = `<div class="lia-mathpath-tooltip-title"><span class="lia-mathpath-glossary-highlight lia-mathpath-term" data-lia-term="${escapeHtml(entry.term)}">${escapeHtml(entry.term)}</span></div>`;
  const body = `<div class="lia-mathpath-tooltip-body">${renderTooltipMarkup(`${entry.explanation}${related}`)}</div>`;
  tip.innerHTML = `${title}${body}`;
  tip.setAttribute('data-open', '1');
  placeTooltip(targetRect, isNested);
}

function showForTarget(target: Element): void {
  if (!target.isConnected || isExcludedGlossaryContext(target)) return;
  setHoveredVirtualMatch(null);
  const isNested = !!target.closest('.lia-mathpath-tooltip');
  const term = target.getAttribute('data-lia-term') || target.textContent || '';
  showEntryAtRect(term, target.getBoundingClientRect(), isNested);
}

function bindElement(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  if (!el.hasAttribute('data-lia-term')) return;
  if (isExcludedGlossaryContext(el)) return;

  const missingClasses = ['lia-mathpath-term', 'lia-mathpath-glossary-highlight']
    .filter(className => !el.classList.contains(className));
  if (missingClasses.length > 0) el.classList.add(...missingClasses);
  if (_boundTermElements.has(el)) return;
  if (el.dataset.liaMathpathBound === '1') {
    _boundTermElements.add(el);
    return;
  }

  _boundTermElements.add(el);
  el.dataset.liaMathpathBound = '1';

  el.addEventListener('mouseenter', function () {
    showForTarget(el);
  });

  el.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    _tooltipPinned = true;
    _pinnedTarget = el;
    _pinnedVirtualMatch = null;
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
    _pinnedVirtualMatch = null;
    showForTarget(el);
  });
}

function getElementsInScope(scope: Node, selector: string): Element[] {
  const elements: Element[] = [];
  if (scope instanceof Element && scope.matches(selector)) {
    elements.push(scope);
  }

  const parentScope = scope as ParentNode;
  if (typeof parentScope.querySelectorAll === 'function') {
    elements.push(...Array.from(parentScope.querySelectorAll(selector)));
  }
  return elements;
}

function bindInScope(scope: Node): void {
  const nodes = getElementsInScope(scope, '[data-lia-term]');
  for (let i = 0; i < nodes.length; i++) bindElement(nodes[i]);
}

function shouldSkipElement(el: Node): boolean {
  if (!(el instanceof Element)) return false;
  if (isExcludedGlossaryContext(el)) return true;
  if (el.closest('[data-lia-term], .lia-mathpath-glossary-highlight, .lia-mathpath-term')) return true;
  return false;
}

function shouldProcessTextNode(node: Node): node is Text {
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent || '';
  if (text.trim().length < 1) return false;
  if (node.parentElement && shouldSkipElement(node.parentElement)) return false;
  return true;
}

interface PreparedGlossaryMatcher {
  regex: RegExp;
  bySurface: Map<string, GlossaryMatchForm>;
}

interface GlossaryTextMatch {
  start: number;
  end: number;
  text: string;
  term: string;
}

interface VirtualGlossaryMatch extends GlossaryTextMatch {
  node: Text;
  range: Range;
}

interface VirtualGlossaryHit {
  match: VirtualGlossaryMatch;
  rect: DOMRect;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prepareGlossaryMatcher(forms: GlossaryMatchForm[]): PreparedGlossaryMatcher | null {
  const alternatives: string[] = [];
  const bySurface = new Map<string, GlossaryMatchForm>();

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i].form.trim();
    const key = normalizeTermKey(form);
    if (!form || !key || bySurface.has(key)) continue;
    bySurface.set(key, forms[i]);
    alternatives.push(form.split(/\s+/g).map(escapeRegex).join('\\s+'));
  }

  if (alternatives.length === 0) return null;
  return {
    regex: new RegExp(
      `(^|[^\\p{L}\\p{M}\\p{N}_])(${alternatives.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`,
      'giu'
    ),
    bySurface
  };
}

function findGlossaryMatches(text: string, matcher: PreparedGlossaryMatcher): GlossaryTextMatch[] {
  const matches: GlossaryTextMatch[] = [];
  matcher.regex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.regex.exec(text)) !== null) {
    const leadingBoundary = match[1] || '';
    const matchedText = match[2] || '';
    const form = matcher.bySurface.get(normalizeTermKey(matchedText));
    if (!form) continue;

    const start = match.index + leadingBoundary.length;
    matches.push({
      start,
      end: start + matchedText.length,
      text: matchedText,
      term: form.term
    });
  }

  return matches;
}

function createRangeForMatch(node: Text, match: GlossaryTextMatch): Range | null {
  const range = document.createRange();
  try {
    range.setStart(node, match.start);
    range.setEnd(node, match.end);
    return range.collapsed ? null : range;
  } catch (_) {
    return null;
  }
}

function isVirtualMatchLive(match: VirtualGlossaryMatch): boolean {
  if (!match.node.isConnected || !isElmManagedNode(match.node)) return false;
  if (match.node.data.slice(match.start, match.end) !== match.text) return false;
  const parent = match.node.parentElement;
  return !!parent && !shouldSkipElement(parent);
}

function getVirtualMatchRects(match: VirtualGlossaryMatch): DOMRect[] {
  if (!isVirtualMatchLive(match)) return [];
  try {
    return Array.from(match.range.getClientRects()).filter(rect => rect.width > 0.5 && rect.height > 0.5);
  } catch (_) {
    return [];
  }
}

function rectContainsPoint(rect: DOMRect, x: number, y: number, tolerance = 1): boolean {
  return x >= rect.left - tolerance &&
    x <= rect.right + tolerance &&
    y >= rect.top - tolerance &&
    y <= rect.bottom + tolerance;
}

function getVirtualMatchRect(
  match: VirtualGlossaryMatch,
  clientX?: number,
  clientY?: number
): DOMRect | null {
  const rects = getVirtualMatchRects(match);
  if (rects.length === 0) return null;
  if (typeof clientX === 'number' && typeof clientY === 'number') {
    const pointed = rects.find(rect => rectContainsPoint(rect, clientX, clientY));
    return pointed || null;
  }
  return rects[0];
}

function getHighlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === 'undefined' || typeof Highlight !== 'function') return null;
  const registry = CSS.highlights;
  return registry && typeof registry.set === 'function' && typeof registry.delete === 'function'
    ? registry
    : null;
}

function ensureVirtualOverlay(): HTMLDivElement {
  if (_virtualOverlay && _virtualOverlay.isConnected) return _virtualOverlay;
  const overlay = document.createElement('div');
  overlay.className = 'lia-mathpath-range-layer lia-mathpath-no-glossary';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  _virtualOverlay = overlay;
  return overlay;
}

function removeVirtualOverlay(): void {
  if (_virtualOverlay?.isConnected) _virtualOverlay.remove();
  _virtualOverlay = null;
}

function renderVirtualOverlay(): void {
  if (_virtualMatches.length === 0) {
    removeVirtualOverlay();
    return;
  }

  const overlay = ensureVirtualOverlay();
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < _virtualMatches.length; i++) {
    const match = _virtualMatches[i];
    const active = match === _hoveredVirtualMatch || match === _pinnedVirtualMatch;
    const rects = getVirtualMatchRects(match);
    for (let j = 0; j < rects.length; j++) {
      const rect = rects[j];
      const marker = document.createElement('span');
      marker.className = active
        ? 'lia-mathpath-range-rect lia-mathpath-range-rect--active'
        : 'lia-mathpath-range-rect';
      marker.style.left = String(rect.left) + 'px';
      marker.style.top = String(rect.top) + 'px';
      marker.style.width = String(rect.width) + 'px';
      marker.style.height = String(rect.height) + 'px';
      fragment.appendChild(marker);
    }
  }

  overlay.replaceChildren(fragment);
}

function updateVirtualPainting(): void {
  const registry = getHighlightRegistry();
  const liveMatches = _virtualMatches.filter(isVirtualMatchLive);

  if (registry) {
    if (liveMatches.length > 0) {
      const highlight = new Highlight();
      for (let i = 0; i < liveMatches.length; i++) {
        highlight.add(liveMatches[i].range);
      }
      registry.set(VIRTUAL_HIGHLIGHT_NAME, highlight);
    } else {
      registry.delete(VIRTUAL_HIGHLIGHT_NAME);
    }

    const active = _pinnedVirtualMatch || _hoveredVirtualMatch;
    if (active && isVirtualMatchLive(active)) {
      registry.set(VIRTUAL_HOVER_HIGHLIGHT_NAME, new Highlight(active.range));
    } else {
      registry.delete(VIRTUAL_HOVER_HIGHLIGHT_NAME);
    }
    removeVirtualOverlay();
    return;
  }

  renderVirtualOverlay();
}

function scheduleVirtualPainting(): void {
  if (_virtualPaintFrame) return;
  if (typeof window.requestAnimationFrame !== 'function') {
    updateVirtualPainting();
    return;
  }
  _virtualPaintFrame = window.requestAnimationFrame(() => {
    _virtualPaintFrame = 0;
    updateVirtualPainting();
  });
}

function authoredElementFromPoint(clientX: number, clientY: number): Element | null {
  const candidates = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : typeof document.elementFromPoint === 'function'
      ? [document.elementFromPoint(clientX, clientY)].filter((element): element is Element => !!element)
      : [];

  for (let i = 0; i < candidates.length; i++) {
    if (!candidates[i].closest('.lia-mathpath-tooltip, .lia-mathpath-range-layer')) {
      return candidates[i];
    }
  }
  return null;
}

function refreshGlossaryLayout(): void {
  scheduleVirtualPainting();

  if (_pinnedVirtualMatch) {
    const rect = getVirtualMatchRect(_pinnedVirtualMatch);
    if (!rect) {
      hideTooltip();
      clearPinnedTooltip();
      return;
    }
    placeTooltip(rect);
    return;
  }

  if (_hoveredVirtualMatch) {
    const point = _lastVirtualPointerPoint;
    const pointTarget = point
      ? authoredElementFromPoint(point.clientX, point.clientY)
      : null;
    const hit = point
      ? findVirtualMatchAtPoint(point.clientX, point.clientY, pointTarget)
      : null;
    if (!hit || hit.match !== _hoveredVirtualMatch) {
      closeUnpinnedVirtualTooltip();
      return;
    }
    placeTooltip(hit.rect);
    return;
  }

  if (!_pinnedTarget) return;
  if (!_pinnedTarget.isConnected) {
    hideTooltip();
    clearPinnedTooltip();
    return;
  }
  placeTooltip(_pinnedTarget.getBoundingClientRect());
}

function setHoveredVirtualMatch(match: VirtualGlossaryMatch | null): void {
  if (_hoveredVirtualMatch === match) return;
  _hoveredVirtualMatch = match;
  updateVirtualPainting();
}

function closeUnpinnedVirtualTooltip(): void {
  if (_tooltipPinned || !_hoveredVirtualMatch) return;
  _lastVirtualPointerPoint = null;
  setHoveredVirtualMatch(null);
  hideTooltip();
}

function findReplacementVirtualMatch(previous: VirtualGlossaryMatch | null): VirtualGlossaryMatch | null {
  if (!previous) return null;
  const candidates = _virtualMatchesByNode.get(previous.node) || [];
  return candidates.find(candidate =>
    candidate.start === previous.start &&
    candidate.end === previous.end &&
    candidate.term === previous.term &&
    candidate.text === previous.text
  ) || null;
}

function rebuildVirtualGlossaryMatches(matcher: PreparedGlossaryMatcher | null): void {
  const previousPinned = _pinnedVirtualMatch;
  const previousHovered = _hoveredVirtualMatch;
  const nextMatches: VirtualGlossaryMatch[] = [];
  const nextByNode = new WeakMap<Text, VirtualGlossaryMatch[]>();

  if (matcher && document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let current: Node | null;
    while ((current = walker.nextNode()) !== null) {
      if (!shouldProcessTextNode(current) || !isElmManagedNode(current)) continue;
      const textMatches = findGlossaryMatches(current.data, matcher);
      if (textMatches.length === 0) continue;

      const nodeMatches: VirtualGlossaryMatch[] = [];
      for (let i = 0; i < textMatches.length; i++) {
        const textMatch = textMatches[i];
        const range = createRangeForMatch(current, textMatch);
        if (!range) continue;
        const virtualMatch = { ...textMatch, node: current, range };
        nodeMatches.push(virtualMatch);
        nextMatches.push(virtualMatch);
      }
      if (nodeMatches.length > 0) nextByNode.set(current, nodeMatches);
    }
  }

  _virtualMatches = nextMatches;
  _virtualMatchesByNode = nextByNode;
  _pinnedVirtualMatch = findReplacementVirtualMatch(previousPinned);
  _hoveredVirtualMatch = findReplacementVirtualMatch(previousHovered);

  if (previousPinned && !_pinnedVirtualMatch) {
    hideTooltip();
    clearPinnedTooltip();
  } else if (previousHovered && !_hoveredVirtualMatch && !_tooltipPinned) {
    hideTooltip();
  }

  updateVirtualPainting();
  if (_pinnedVirtualMatch) refreshGlossaryLayout();
}

function textPointFromClientPoint(clientX: number, clientY: number): { node: Text; offset: number } | null {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof caretDocument.caretPositionFromPoint === 'function') {
    const position = caretDocument.caretPositionFromPoint(clientX, clientY);
    node = position?.offsetNode || null;
    offset = position?.offset || 0;
  } else if (typeof caretDocument.caretRangeFromPoint === 'function') {
    const range = caretDocument.caretRangeFromPoint(clientX, clientY);
    node = range?.startContainer || null;
    offset = range?.startOffset || 0;
  }

  return node?.nodeType === Node.TEXT_NODE
    ? { node: node as Text, offset }
    : null;
}

function virtualMatchBelongsToTarget(match: VirtualGlossaryMatch, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  const parent = match.node.parentElement;
  return !!parent && (target === parent || target.contains(parent) || parent.contains(target));
}

function findVirtualMatchAtPoint(
  clientX: number,
  clientY: number,
  eventTarget: EventTarget | null
): VirtualGlossaryHit | null {
  const point = textPointFromClientPoint(clientX, clientY);
  if (point) {
    const candidates = _virtualMatchesByNode.get(point.node) || [];
    for (let i = 0; i < candidates.length; i++) {
      const match = candidates[i];
      const hitsOffset =
        (point.offset >= match.start && point.offset < match.end) ||
        (point.offset > match.start && point.offset - 1 < match.end);
      if (!hitsOffset || !virtualMatchBelongsToTarget(match, eventTarget)) continue;
      const rect = getVirtualMatchRect(match, clientX, clientY);
      if (rect) return { match, rect };
    }
  }

  for (let i = 0; i < _virtualMatches.length; i++) {
    const match = _virtualMatches[i];
    if (!virtualMatchBelongsToTarget(match, eventTarget)) continue;
    const rect = getVirtualMatchRect(match, clientX, clientY);
    if (rect) return { match, rect };
  }
  return null;
}

function showForVirtualMatch(match: VirtualGlossaryMatch, rect?: DOMRect): void {
  const targetRect = rect || getVirtualMatchRect(match);
  if (!targetRect) return;
  setHoveredVirtualMatch(match);
  showEntryAtRect(match.term, targetRect);
}

function activateSemanticTermsInScope(scope: Node): void {
  const elements = getElementsInScope(scope, 'em');
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.hasAttribute('data-lia-term') || isExcludedGlossaryContext(element)) continue;

    const entry = getGlossaryEntry((element.textContent || '').trim());
    if (!entry) continue;

    element.setAttribute('data-lia-term', entry.term);
    element.classList.add('lia-mathpath-glossary-highlight');
    bindElement(element);
  }
}

function highlightTermsInNode(node: Node, matcher: PreparedGlossaryMatcher): boolean {
  if (!shouldProcessTextNode(node) || isElmManagedNode(node)) return false;

  const text = node.data;
  const matches = findGlossaryMatches(text, matcher);
  if (matches.length === 0 || !node.parentElement) return false;

  let lastIndex = 0;
  const fragments: Node[] = [];
  const highlights: HTMLElement[] = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (current.start > lastIndex) {
      fragments.push(document.createTextNode(text.substring(lastIndex, current.start)));
    }

    const highlightSpan = document.createElement('span');
    highlightSpan.className = 'lia-mathpath-glossary-highlight';
    highlightSpan.setAttribute('data-lia-term', current.term);
    highlightSpan.textContent = current.text;
    fragments.push(highlightSpan);
    highlights.push(highlightSpan);
    lastIndex = current.end;
  }

  if (lastIndex < text.length) {
    fragments.push(document.createTextNode(text.substring(lastIndex)));
  }

  const parent = node.parentElement;
  for (let i = 0; i < fragments.length; i++) {
    parent.insertBefore(fragments[i], node);
  }
  parent.removeChild(node);
  for (let i = 0; i < highlights.length; i++) bindElement(highlights[i]);
  return true;
}

function highlightGlossaryTermsInScope(scope: Node = document.body): void {
  bindInScope(scope);
  activateSemanticTermsInScope(scope);

  const matcher = prepareGlossaryMatcher(getGlossaryMatchForms());
  if (!matcher) {
    rebuildVirtualGlossaryMatches(null);
    return;
  }

  const queue: Node[] = [];
  if (scope.nodeType === Node.TEXT_NODE) {
    queue.push(scope);
  } else {
    const ownerDocument = scope.ownerDocument || document;
    const walker = ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode()) !== null) queue.push(currentNode);
  }

  for (let i = 0; i < queue.length; i++) highlightTermsInNode(queue[i], matcher);
  rebuildVirtualGlossaryMatches(matcher);
  bindInScope(scope);
}

export function highlightGlossaryTerms(scope: Node = document.body): void {
  highlightGlossaryTermsInScope(scope);
}

export function bindGlossaryInteractions(scope: ParentNode): void {
  highlightGlossaryTermsInScope(scope as Node);

  if (!_explainRetriesScheduled) {
    _explainRetriesScheduled = true;
    Promise.all([ensureExplainLinksLoaded(), ensureADetailsTopicsLoaded()]).then(() => {
      processExplainElements(document);

      let retries = 0;
      const timer = setInterval(() => {
        retries++;
        processExplainElements(document);
        if (retries >= 6) clearInterval(timer);
      }, 1200);
    });
  }

  if (_interactionsBound) return;
  _interactionsBound = true;

  document.addEventListener('pointermove', function (ev) {
    if (_tooltipPinned || ev.pointerType === 'touch') return;
    const target = ev.target;
    if (target instanceof Element && target.closest('.lia-mathpath-tooltip')) return;
    _lastVirtualPointerPoint = { clientX: ev.clientX, clientY: ev.clientY };
    if (target instanceof Element && target.closest('.lia-mathpath-glossary-highlight')) {
      setHoveredVirtualMatch(null);
      return;
    }

    const hit = findVirtualMatchAtPoint(ev.clientX, ev.clientY, target);
    if (hit) {
      if (_hoveredVirtualMatch !== hit.match) showForVirtualMatch(hit.match, hit.rect);
      return;
    }

    setHoveredVirtualMatch(null);
    hideTooltip();
  }, { capture: true, passive: true });

  document.addEventListener('pointerout', function (ev) {
    if (ev.relatedTarget === null) closeUnpinnedVirtualTooltip();
  }, true);

  document.addEventListener('pointercancel', closeUnpinnedVirtualTooltip, true);
  window.addEventListener('blur', closeUnpinnedVirtualTooltip);

  document.addEventListener('click', function (ev) {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    const clickedGlossaryTerm = target.closest('.lia-mathpath-glossary-highlight') as Element | null;
    if (clickedGlossaryTerm && !isExcludedGlossaryContext(clickedGlossaryTerm)) {
      _tooltipPinned = true;
      _pinnedTarget = clickedGlossaryTerm;
      _pinnedVirtualMatch = null;
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

    const selection = window.getSelection();
    const hasSelection = !!selection && !selection.isCollapsed && !!String(selection).trim();
    if (!hasSelection && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      const hit = findVirtualMatchAtPoint(ev.clientX, ev.clientY, target);
      if (hit) {
        _tooltipPinned = true;
        _pinnedTarget = null;
        _pinnedVirtualMatch = hit.match;
        showForVirtualMatch(hit.match, hit.rect);
        return;
      }
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

  window.addEventListener('scroll', refreshGlossaryLayout, true);
  window.addEventListener('resize', refreshGlossaryLayout);

  const layoutEvents = ['load', 'toggle', 'transitionend', 'animationend'];
  for (let i = 0; i < layoutEvents.length; i++) {
    document.addEventListener(layoutEvents[i], refreshGlossaryLayout, true);
  }

  if (typeof ResizeObserver === 'function') {
    _virtualResizeObserver = new ResizeObserver(refreshGlossaryLayout);
    _virtualResizeObserver.observe(document.documentElement);
    if (document.body) _virtualResizeObserver.observe(document.body);
  }

  const fontSet = (document as Document & {
    fonts?: { ready?: Promise<unknown> };
  }).fonts;
  fontSet?.ready?.then(refreshGlossaryLayout, () => {});
}

let _discoverGlossary: (() => void) | null = null;

export function setDiscoveryFunction(fn: () => void): void {
  _discoverGlossary = fn;
}

function isPluginOwnedMutationNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return !!element?.closest(PLUGIN_OWNED_SELECTOR);
}

export function observeDynamicContent(): void {
  if (_observer || !document.body) return;
  _observer = new MutationObserver(function (records) {
    let contentChanged = false;
    let childContentChanged = false;
    let layoutChanged = false;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (isPluginOwnedMutationNode(rec.target)) continue;

      if (rec.type === 'characterData') {
        contentChanged = true;
        continue;
      }

      if (rec.type === 'attributes') {
        if (rec.attributeName === 'class' || rec.attributeName === 'data-lia-term') {
          contentChanged = true;
        } else {
          layoutChanged = true;
        }
        continue;
      }

      for (let j = 0; j < rec.addedNodes.length; j++) {
        const node = rec.addedNodes[j];
        if (isPluginOwnedMutationNode(node)) continue;
        contentChanged = true;
        childContentChanged = true;
        if (node instanceof Element) processExplainElements(node);
      }
      for (let j = 0; j < rec.removedNodes.length; j++) {
        if (isPluginOwnedMutationNode(rec.removedNodes[j])) continue;
        contentChanged = true;
        childContentChanged = true;
      }
    }

    if (contentChanged) highlightGlossaryTermsInScope(document.body);
    if (contentChanged || layoutChanged) refreshGlossaryLayout();
    if (childContentChanged) {
      if (_discoverGlossary) _discoverGlossary();
      processExplainElements(document);
    }
  });

  _observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeFilter: ['class', 'data-lia-term', 'style', 'hidden', 'open', 'width', 'height']
  });
}

