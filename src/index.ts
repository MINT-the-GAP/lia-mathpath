// Entry point: dedup guard, then initialize styles, UI hooks, and global API.

import { IS_DUPLICATE, setPluginBaseUrl } from './store';
import { ensureCss, syncAccentColor } from './styles';
import { bindGlossaryInteractions, observeDynamicContent, setDiscoveryFunction, highlightGlossaryTerms } from './ui';
import { registerGlobalApi, setHighlightFunction, attemptGlossaryDiscovery } from './api';

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
  const fromCurrent = /\/dist\/index(?:\.[a-z0-9]+)?\.js(?:[?#].*)?$/i.test(currentSrc)
    ? resolveBaseFromScriptSrc(currentSrc)
    : null;
  if (fromCurrent) return fromCurrent;

  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = scripts[i].src || '';
    if (!/\/dist\/index(?:\.[a-z0-9]+)?\.js(?:[?#].*)?$/i.test(src)) continue;
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
  setHighlightFunction(highlightGlossaryTerms);
  setDiscoveryFunction(attemptGlossaryDiscovery);
  bindGlossaryInteractions(document);
  observeDynamicContent();
  registerGlobalApi();

  const accentObserver = new MutationObserver(() => {
    syncAccentColor();
  });

  accentObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
    childList: false,
    subtree: true
  });
}
