// Entry point: dedup guard, then initialize styles, UI hooks, and global API.

import { IS_DUPLICATE, setPluginBaseUrl } from './store';
import { ensureCss, syncAccentColor } from './styles';
import {
  bindGlossaryInteractions,
  highlightGlossaryTerms,
  observeDynamicContent,
  registerExplainElement,
  setDiscoveryFunction
} from './ui';
import { registerGlobalApi, setHighlightFunction, attemptGlossaryDiscovery } from './api';
import { installAssignmentDetails } from './adetails';
import { registerLearningPathElement } from './lernpfad-ui';
import { installRuntimeLearningState } from './lernpfad-runtime-state.js';

const DIST_INDEX_SCRIPT_RE = /\/dist\/index(?:\.[a-z0-9]+)?\.js$/i;

function parseScriptUrl(src: string): URL | null {
  const normalized = String(src || '').trim();
  if (!normalized) return null;

  try {
    return new URL(normalized, location.href);
  } catch (_) {
    return null;
  }
}

function isDistIndexScript(src: string): boolean {
  const url = parseScriptUrl(src);
  return !!url && DIST_INDEX_SCRIPT_RE.test(url.pathname || '');
}

/**
 * Identify MathPath when inspecting script tags that are not the currently
 * executing script. Many LiaScript templates publish the same dist/index.js
 * path, so that path alone does not identify the owning repository.
 */
function isMathPathScript(src: string): boolean {
  const url = parseScriptUrl(src);
  if (!url || !DIST_INDEX_SCRIPT_RE.test(url.pathname || '')) return false;

  return /\/lia-mathpath(?:@[^/]+)?(?:\/(?:refs\/heads\/)?[^/]+)?\/dist\/index(?:\.[a-z0-9]+)?\.js$/i.test(
    url.pathname || ''
  );
}

function resolveBaseFromScriptSrc(src: string): string | null {
  const normalized = String(src || '').trim();
  if (!normalized) return null;

  try {
    const url = new URL(normalized, location.href);
    const path = url.pathname || '';

    if (/\/dist\//i.test(path)) {
      url.pathname = path.replace(/\/dist\/[^/]*$/i, '/');
    } else {
      url.pathname = path.replace(/\/[^/]*$/, '/');
    }

    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function detectPluginBaseUrl(): string | null {
  const current = document.currentScript as HTMLScriptElement | null;
  // Do not mistake LiaScript's generated /liascript/index.<hash>.js bundle for
  // the directory that owns MathPath's Markdown resources.
  const currentSrc = current?.src || '';
  const fromCurrent = isDistIndexScript(currentSrc)
    ? resolveBaseFromScriptSrc(currentSrc)
    : null;
  if (fromCurrent) return fromCurrent;

  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = scripts[i].src || '';
    if (!isMathPathScript(src)) continue;
    const detected = resolveBaseFromScriptSrc(src);
    if (detected) return detected;
  }

  return null;
}

if (!IS_DUPLICATE) {
  const pluginBaseUrl = detectPluginBaseUrl();
  if (pluginBaseUrl) {
    setPluginBaseUrl(pluginBaseUrl);
  }

  ensureCss();
  syncAccentColor();
  registerExplainElement();
  installAssignmentDetails();
  installRuntimeLearningState();
  registerLearningPathElement();
  setHighlightFunction(highlightGlossaryTerms);
  setDiscoveryFunction(attemptGlossaryDiscovery);
  bindGlossaryInteractions(document);
  observeDynamicContent();
  registerGlobalApi();

  const themeObserver = new MutationObserver(records => {
    const shouldSync = records.some(record => {
      const target = record.target;
      if (!(target instanceof Element)) return false;
      if (target === document.documentElement || target === document.body) return true;
      if (record.attributeName?.startsWith('data-')) return true;
      return target.matches('.lia-slide, .lia-slide__content, .lia-content, main');
    });
    if (shouldSync) syncAccentColor();
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme', 'data-mode', 'data-color-scheme', 'data-bs-theme'],
    childList: false,
    subtree: true
  });
}
