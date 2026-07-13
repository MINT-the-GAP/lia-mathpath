// Public API exported on window.__LIA_MATHPATH__.

import {
  exportState,
  getCourseBaseUrl,
  getGlossaryEntry,
  importState,
  joinUrl,
  parseGlossaryMarkdown,
  registerWrongAttempt,
  setGlossaryEntries
} from './store';
import type { GlossaryEntry } from './types';

export function autoDiscoverGlossary(): number {
  // Suche nach Glossar-Tabellen in der Seite
  const tables = document.querySelectorAll('table');
  
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const rows = table.querySelectorAll('tbody tr');
    if (rows.length < 1) continue;

    // Extract header from first thead row or first tbody row
    let headerRow: HTMLTableRowElement | null = null;
    const theadRow = table.querySelector('thead tr');
    if (theadRow) {
      headerRow = theadRow as HTMLTableRowElement;
    } else if (rows.length > 0) {
      headerRow = rows[0] as HTMLTableRowElement;
    }

    if (!headerRow) continue;

    const headerCells = headerRow.querySelectorAll('th, td');
    const headers: string[] = [];
    for (let h = 0; h < headerCells.length; h++) {
      headers.push((headerCells[h].textContent || '').toLowerCase());
    }

    // Check if this looks like a glossary table
    const hasTermCol = headers.some(h => h.includes('term') || h.includes('wort') || h.includes('begriff'));
    const hasExplCol = headers.some(h => h.includes('explanation') || h.includes('erklär') || h.includes('erklaer') || h.includes('erklärung') || h.includes('erklaerung'));
    
    if (!hasTermCol || !hasExplCol) continue;

    // Parse glossary from this table
    const entries: GlossaryEntry[] = [];
    const colTerm = headers.findIndex(h => h.includes('term') || h.includes('wort') || h.includes('begriff'));
    const colExp = headers.findIndex(h => h.includes('explanation') || h.includes('erklär') || h.includes('erklaer') || h.includes('erklärung') || h.includes('erklaerung'));
    const colTags = headers.findIndex(h => h.includes('tag'));

    for (let r = 0; r < rows.length; r++) {
      const cells = (rows[r] as HTMLTableRowElement).querySelectorAll('td');
      if (cells.length <= Math.max(colTerm, colExp)) continue;

      const term = (cells[colTerm]?.textContent || '').trim();
      const explanation = (cells[colExp]?.textContent || '').trim();
      if (!term || !explanation) continue;

      entries.push({
        term,
        explanation,
        tags: colTags >= 0 ? (cells[colTags]?.textContent || '').split(/[,;]/).map(t => t.trim()).filter(Boolean) : [],
        links: []
      });
    }

    if (entries.length > 0) {
      setGlossaryEntries(entries);
      return entries.length;
    }
  }

  return 0;
}

let _highlightGlossaryTermsInScope: ((scope?: Node) => void) | null = null;

export function setHighlightFunction(fn: (scope?: Node) => void): void {
  _highlightGlossaryTermsInScope = fn;
}

export function doTriggerHighlighting(): void {
  if (_highlightGlossaryTermsInScope) {
    _highlightGlossaryTermsInScope(document.body);
  }
}

/** @internal alias for internal use */
const triggerHighlighting = doTriggerHighlighting;

/** Try to fetch Glossar.md from a base URL and load the glossary from it. */
function tryFetchGlossary(baseUrl: string): Promise<number> {
  const urls = [
    joinUrl(baseUrl, 'Glossar.md')
  ];
  const tryNext = (idx: number): Promise<number> => {
    if (idx >= urls.length) return Promise.resolve(0);
    return fetch(urls[idx])
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(md => {
        const parsed = parseGlossaryMarkdown(md);
        if (parsed.length > 0) {
          const count = setGlossaryEntries(parsed);
          triggerHighlighting();
          console.log(`[MathPath] Loaded ${count} glossary terms from ${urls[idx]}`);
          return count;
        }
        return 0;
      })
      .catch(() => tryNext(idx + 1));
  };
  return tryNext(0);
}

function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function buildLearningToken(studentId: string | undefined): string {
  const payload = {
    v: 1,
    studentId: String(studentId || '').trim() || null,
    ts: Date.now()
  };
  return encodeBase64Utf8(JSON.stringify(payload));
}

export function registerGlobalApi(): void {
  window.__LIA_MATHPATH__ = {
    setGlossary(entries: GlossaryEntry[]): number {
      const count = setGlossaryEntries(entries || []);
      triggerHighlighting();
      return count;
    },

    loadGlossaryMarkdown(markdown: string): number {
      const parsed = parseGlossaryMarkdown(markdown);
      const count = setGlossaryEntries(parsed);
      triggerHighlighting();
      return count;
    },

    getGlossary(term: string): GlossaryEntry | null {
      return getGlossaryEntry(term);
    },

    recordWrongAttempt(taskId: string, tags: string[] = []): number {
      return registerWrongAttempt(taskId, tags);
    },

    generateLearningToken(studentId?: string): string {
      return buildLearningToken(studentId);
    },

    exportState(): unknown {
      return exportState();
    },

    importState(payload: unknown): boolean {
      return importState(payload);
    }
  };

  // Initial discovery
  attemptGlossaryDiscovery();

  // Try to load Glossar.md via fetch
  const baseUrl = getCourseBaseUrl();
  if (baseUrl) {
    tryFetchGlossary(baseUrl);
  }
}

/** Re-scan the page for glossary tables and highlight if any new terms were found. */
export function attemptGlossaryDiscovery(): void {
  const count = autoDiscoverGlossary();
  if (count > 0) {
    triggerHighlighting();
  }
}
