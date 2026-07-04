// Entry point: dedup guard, then initialize styles, UI hooks, and global API.

import { IS_DUPLICATE } from './store';
import { ensureCss, syncAccentColor } from './styles';
import { bindGlossaryInteractions, observeDynamicContent, highlightGlossaryTerms } from './ui';
import { registerGlobalApi, setHighlightFunction, autoDiscoverGlossary, doTriggerHighlighting } from './api';

if (!IS_DUPLICATE) {
  ensureCss();
  syncAccentColor();
  setHighlightFunction(highlightGlossaryTerms);
  bindGlossaryInteractions(document);
  observeDynamicContent();
  registerGlobalApi();

  const accentObserver = new MutationObserver(() => {
    syncAccentColor();
  });

  accentObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: false
  });
  
  // Auto-discover glossary from tables in DOM
  setTimeout(() => {
    const entries = autoDiscoverGlossary();
    if (entries > 0) {
      console.log(`[MathPath] Auto-discovered ${entries} glossary terms`);
      doTriggerHighlighting();
    }
  }, 500);
}
