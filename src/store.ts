// Root store and pure helper functions.

import type { GlossaryEntry, MathPathStore, TaskAttempt } from './types';

type RootWindow = Window & { [key: string]: unknown };

function getRootWindow(): RootWindow {
  let w = window as unknown as RootWindow;
  try {
    while (w.parent && w.parent !== (w as unknown as Window)) {
      w = w.parent as RootWindow;
    }
  } catch (_) {
    // Cross-origin parent access is expected to fail in some embeds.
  }
  return w;
}

export const ROOT: RootWindow = getRootWindow();
export const DOC_ID: string = document.baseURI || location.href || 'doc';
const REGKEY = '__LIA_MATHPATH_REG_V1__';
const STOREKEY = '__LIA_MATHPATH_STORE_V1__';
const BASEURLKEY = '__LIA_MATHPATH_BASE_URL_V1__';
const DEFAULT_PLUGIN_BASE_URL = 'https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/';

ROOT[REGKEY] = ROOT[REGKEY] || { docs: {} };
const registry = ROOT[REGKEY] as { docs: Record<string, boolean> };
export const IS_DUPLICATE: boolean = !!registry.docs[DOC_ID];
registry.docs[DOC_ID] = true;

ROOT[STOREKEY] = ROOT[STOREKEY] || {
  glossary: {},
  attempts: {}
} satisfies MathPathStore;

export const STORE: MathPathStore = ROOT[STOREKEY] as MathPathStore;

function normalizeHttpUrl(url: string): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

export function setPluginBaseUrl(url: string): void {
  const normalized = normalizeHttpUrl(url);
  if (!normalized) return;
  ROOT[BASEURLKEY] = normalized;
}

export function getPluginBaseUrl(): string | null {
  const value = ROOT[BASEURLKEY];
  return typeof value === 'string' ? normalizeHttpUrl(value) : null;
}

export function joinUrl(base: string, fileName: string): string {
  const b = String(base || '').replace(/\/+$/, '');
  const f = String(fileName || '').replace(/^\/+/, '');
  return `${b}/${f}`;
}

/**
 * Base URL for MathPath-owned resources such as Explain.md and Glossar.md.
 * LiaScript's local bundle no longer identifies the imported plugin folder,
 * so fall back to the canonical plugin repository.
 */
export function getCourseBaseUrl(): string {
  const pluginBase = getPluginBaseUrl();
  if (pluginBase) return pluginBase;
  return DEFAULT_PLUGIN_BASE_URL;
}

/** Extract the LiaScript course Markdown URL from the current location's query param, if present. */
export function getCourseMarkdownUrl(): string | null {
  const hrefCandidates = [
    String(location.href || ''),
    String(ROOT.location?.href || '')
  ];

  for (let i = 0; i < hrefCandidates.length; i++) {
    const href = hrefCandidates[i];
    const match = href.match(/[?&](https?:\/\/[^?#]+\.md(?:\?[^#&]*)?)/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

export function normalizeTermKey(term: string): string {
  return String(term || '').trim().toLowerCase();
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(v => String(v).trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[,;]+/g)
    .map(v => v.trim())
    .filter(Boolean);
}

function normalizeLinks(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(v => String(v).trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[\s,;]+/g)
    .map(v => v.trim())
    .filter(Boolean);
}

export function setGlossaryEntries(entries: GlossaryEntry[]): number {
  let count = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const key = normalizeTermKey(e.term);
    if (!key || !String(e.explanation || '').trim()) continue;

    STORE.glossary[key] = {
      term: String(e.term).trim(),
      explanation: String(e.explanation).trim(),
      tags: normalizeTags(e.tags),
      links: normalizeLinks(e.links)
    };
    count++;
  }
  return count;
}

function parseRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  const compact = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return compact.split('|').map(v => v.trim());
}

function looksLikeSeparator(cells: string[]): boolean {
  if (!cells.length) return false;
  return cells.every(c => /^:?-{3,}:?$/.test(c));
}

export function parseGlossaryMarkdown(markdown: string): GlossaryEntry[] {
  const rows = String(markdown || '')
    .split(/\r?\n/g)
    .map(parseRow)
    .filter(r => r.length > 0);

  if (rows.length < 2) return [];

  const header = rows[0].map(v => v.toLowerCase());
  const separator = rows[1];
  if (!looksLikeSeparator(separator)) return [];

  const colTerm = header.findIndex(h => h.includes('term') || h.includes('wort') || h.includes('begriff'));
  const colExp = header.findIndex(
    h => h.includes('explanation') || h.includes('erklaer') || h.includes('erklaerung') || h.includes('erklär') || h.includes('erklärung')
  );
  const colTags = header.findIndex(h => h.includes('tag'));
  const colLinks = header.findIndex(h => h.includes('link') || h.includes('hint'));

  if (colTerm < 0 || colExp < 0) return [];

  const result: GlossaryEntry[] = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const term = row[colTerm] || '';
    const explanation = row[colExp] || '';
    if (!term.trim() || !explanation.trim()) continue;
    result.push({
      term,
      explanation,
      tags: colTags >= 0 ? normalizeTags(row[colTags]) : [],
      links: colLinks >= 0 ? normalizeLinks(row[colLinks]) : []
    });
  }
  return result;
}

export function getGlossaryEntry(term: string): GlossaryEntry | null {
  const key = normalizeTermKey(term);
  return key && STORE.glossary[key] ? STORE.glossary[key] : null;
}

export function registerWrongAttempt(taskId: string, tags: string[] = []): number {
  const id = String(taskId || '').trim();
  if (!id) return 0;

  const prev = STORE.attempts[id] || { taskId: id, wrongCount: 0, tags: [] };
  const mergedTags = Array.from(new Set([...prev.tags, ...normalizeTags(tags)]));
  const next: TaskAttempt = {
    taskId: id,
    wrongCount: prev.wrongCount + 1,
    tags: mergedTags
  };

  STORE.attempts[id] = next;
  return next.wrongCount;
}

export function getAttempt(taskId: string): TaskAttempt | null {
  const id = String(taskId || '').trim();
  return id && STORE.attempts[id] ? STORE.attempts[id] : null;
}

export function exportState(): unknown {
  return {
    glossary: STORE.glossary,
    attempts: STORE.attempts
  };
}

export function importState(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;

  if (obj.glossary && typeof obj.glossary === 'object') {
    STORE.glossary = obj.glossary as MathPathStore['glossary'];
  }
  if (obj.attempts && typeof obj.attempts === 'object') {
    STORE.attempts = obj.attempts as MathPathStore['attempts'];
  }

  return true;
}
