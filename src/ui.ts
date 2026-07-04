// Binds hover/click glossary behavior for terms marked via data-lia-term.
// Also provides automatic glossary term highlighting in page text.

import katex from 'katex';
import { getGlossaryEntry, STORE } from './store';

let _tooltip: HTMLDivElement | null = null;
let _nestedTooltip: HTMLDivElement | null = null;
let _pinnedTarget: Element | null = null;
let _tooltipPinned = false;
let _observer: MutationObserver | null = null;
let _highlightObserver: MutationObserver | null = null;

const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'PRE', 'CODE', 'NOSCRIPT', 'TEXTAREA',
  'INPUT', 'BUTTON', 'SVG', 'CANVAS'
]);

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
  if (allowTooltipContent && el.closest('.katex')) return true;
  if (!allowTooltipContent && el.closest('.lia-mathpath-tooltip')) return true;
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

  document.addEventListener('click', function (ev) {
    const target = ev.target as Element | null;
    if (!target) return;

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
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      for (let j = 0; j < rec.addedNodes.length; j++) {
        const node = rec.addedNodes[j];
        if (!(node instanceof Element)) continue;
        bindElement(node);
        bindInScope(node);
        highlightGlossaryTermsInScope(node);
      }
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
