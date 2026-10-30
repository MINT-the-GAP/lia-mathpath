// Root store and pure helper functions.

import type { GlossaryEntry, MathPathStore, TaskAttempt } from './types';

type RootWindow = Window & { [key: string]: unknown };

function isLiaScriptHost(win: Window): boolean {
  try {
    return !!win.document.querySelector(
      '#lia-toolbar-nav, header.lia-header, .lia-canvas'
    );
  } catch (_) {
    return false;
  }
}

function isLiveEditorPreview(win: Window): boolean {
  try {
    return (win.frameElement as HTMLElement | null)?.id === 'liascript-preview';
  } catch (_) {
    return false;
  }
}

function getRootWindow(): RootWindow {
  const contentWindow = window as unknown as RootWindow;
  let candidate = contentWindow;

  while (true) {
    // A nested LiaScript course (for example an @Explain overlay or a
    // LiveEditor preview) owns its own state and UI. Do not leak into the
    // surrounding course/editor just because both documents share an origin.
    if (
      isLiveEditorPreview(candidate as unknown as Window) ||
      isLiaScriptHost(candidate as unknown as Window)
    ) {
      return candidate;
    }

    try {
      const parent = candidate.parent as unknown as RootWindow;
      if (!parent || parent === candidate) return contentWindow;

      // Probe access before advancing. Reading arbitrary properties from a
      // cross-origin WindowProxy after the loop would otherwise throw and stop
      // the complete MathPath bundle during LMS/online embeds.
      void parent.document;
      candidate = parent;
    } catch (_) {
      return contentWindow;
    }
  }
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
  glossaryAliases: {},
  attempts: {}
} satisfies MathPathStore;

export const STORE: MathPathStore = ROOT[STOREKEY] as MathPathStore;
STORE.glossaryAliases = STORE.glossaryAliases || {};

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

const GENERATED_COURSE_URI_RE = /^parent:schullia-[a-z0-9][a-z0-9-]{7,159}$/i;

/**
 * Sources created by the Aufgabensammlung player use a deterministic parent:
 * URI. The player exposes only that exact source through its same-origin
 * frame bridge, so accepting this narrowly scoped URI does not grant access to
 * arbitrary custom protocols.
 */
export function normalizeCourseSourceUri(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withoutSubmission = raw.split('#', 1)[0];
  if (GENERATED_COURSE_URI_RE.test(withoutSubmission)) return withoutSubmission;
  const http = normalizeHttpUrl(withoutSubmission);
  if (!http) return null;
  try {
    return /\.md$/i.test(new URL(http).pathname) ? http : null;
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
    // Freeze encodes the complete inner course URL, including its submission
    // fragment. Decode that wrapper, preserving escapes in an ordinary URL.
    try {
      const query = new URL(href).search.slice(1);
      const candidates = [query];
      try { candidates.push(decodeURIComponent(query)); } catch (_) { /* malformed URL */ }
      for (const candidate of candidates) {
        const normalized = normalizeCourseSourceUri(candidate);
        if (normalized) return normalized;
      }
    } catch (_) { /* retain the legacy embedded-query fallback */ }
    const match = href.match(/[?&](https?:\/\/[^?#]+\.md(?:\?[^#&]*)?)/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Resolve resources next to a course served by a local LiaScript preview.
 * The preview executes fetched scripts as blob URLs, so the bundle URL itself
 * cannot reliably identify the project directory.
 */
export function getLocalCourseBaseUrl(): string | null {
  const markdownUrl = getCourseMarkdownUrl();
  if (!markdownUrl) return null;

  try {
    const parsed = new URL(markdownUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return null;

    parsed.pathname = parsed.pathname.replace(/\/[^/]*$/, '/');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

export function normalizeTermKey(term: string): string {
  return String(term || '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .toLocaleLowerCase('de-DE');
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

function normalizeAliases(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw.map(v => String(v).trim()).filter(Boolean)
    : String(raw || '').split(/[,;]+/g).map(v => v.trim()).filter(Boolean);
  const seen = new Set<string>();
  return values.map(value => value.normalize('NFC')).filter(value => {
    const key = normalizeTermKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rebuildGlossaryAliases(): void {
  const aliases: Record<string, string> = {};
  const entries = Object.values(STORE.glossary);
  const canonicalKeys = new Set(entries.map(entry => normalizeTermKey(entry.term)).filter(Boolean));
  const ambiguousAliases = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const canonicalKey = normalizeTermKey(entry.term);
    if (!canonicalKey) continue;

    const entryAliases = normalizeAliases(entry.aliases);
    entry.aliases = entryAliases;
    for (let j = 0; j < entryAliases.length; j++) {
      const aliasKey = normalizeTermKey(entryAliases[j]);
      if (!aliasKey || canonicalKeys.has(aliasKey) || ambiguousAliases.has(aliasKey)) continue;
      if (aliases[aliasKey] && aliases[aliasKey] !== canonicalKey) {
        delete aliases[aliasKey];
        ambiguousAliases.add(aliasKey);
        continue;
      }
      aliases[aliasKey] = canonicalKey;
    }
  }

  STORE.glossaryAliases = aliases;
}

rebuildGlossaryAliases();

export function setGlossaryEntries(entries: GlossaryEntry[]): number {
  let count = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const key = normalizeTermKey(e.term);
    if (!key || !String(e.explanation || '').trim()) continue;

    STORE.glossary[key] = {
      term: String(e.term).trim().normalize('NFC'),
      explanation: String(e.explanation).trim(),
      tags: normalizeTags(e.tags),
      links: normalizeLinks(e.links),
      aliases: normalizeAliases(e.aliases)
    };
    count++;
  }
  rebuildGlossaryAliases();
  return count;
}

function parseRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];

  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '|') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && trimmed[j] === '\\'; j--) backslashes++;
      if (backslashes % 2 === 0) {
        cells.push(cell.trim());
        cell = '';
        continue;
      }
    }
    cell += char;
  }
  cells.push(cell.trim());

  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
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
  const colAliases = header.findIndex(h => h.includes('alias') || h.includes('wortform'));

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
      links: colLinks >= 0 ? normalizeLinks(row[colLinks]) : [],
      aliases: colAliases >= 0 ? normalizeAliases(row[colAliases]) : []
    });
  }
  return result;
}

export function getGlossaryEntry(term: string): GlossaryEntry | null {
  const key = normalizeTermKey(term);
  if (!key) return null;
  if (STORE.glossary[key]) return STORE.glossary[key];

  const canonicalKey = STORE.glossaryAliases[key];
  return canonicalKey && STORE.glossary[canonicalKey]
    ? STORE.glossary[canonicalKey]
    : null;
}

function beginsWithUppercaseLetter(value: string): boolean {
  const firstLetter = String(value || '').normalize('NFC').match(/\p{L}/u)?.[0];
  if (!firstLetter) return false;
  return firstLetter === firstLetter.toLocaleUpperCase('de-DE') &&
    firstLetter !== firstLetter.toLocaleLowerCase('de-DE');
}

/**
 * Resolve an automatically discovered text surface.
 * Uppercase-authored aliases represent German nominal forms and must keep their
 * uppercase initial so homographic verbs such as "zahlen" are not highlighted.
 */
export function getGlossaryEntryForText(surface: string): GlossaryEntry | null {
  const key = normalizeTermKey(surface);
  if (!key) return null;
  if (STORE.glossary[key]) return STORE.glossary[key];

  const canonicalKey = STORE.glossaryAliases[key];
  const entry = canonicalKey ? STORE.glossary[canonicalKey] : null;
  if (!entry) return null;

  const authoredAlias = normalizeAliases(entry.aliases)
    .find(alias => normalizeTermKey(alias) === key);
  if (!authoredAlias || !beginsWithUppercaseLetter(authoredAlias)) return entry;
  return beginsWithUppercaseLetter(surface) ? entry : null;
}

export interface GlossaryMatchForm {
  form: string;
  term: string;
  kind: 'term' | 'alias';
  requiresUppercaseInitial: boolean;
}

export function glossaryMatchFormAllowsSurface(
  form: GlossaryMatchForm,
  surface: string
): boolean {
  return !form.requiresUppercaseInitial || beginsWithUppercaseLetter(surface);
}

/** Return exact, controlled match surfaces with canonical terms taking precedence over aliases. */
export function getGlossaryMatchForms(): GlossaryMatchForm[] {
  const forms: GlossaryMatchForm[] = [];
  const seen = new Set<string>();
  const entries = Object.values(STORE.glossary);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const key = normalizeTermKey(entry.term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    forms.push({
      form: entry.term,
      term: entry.term,
      kind: 'term',
      requiresUppercaseInitial: false
    });
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryAliases = normalizeAliases(entry.aliases);
    const canonicalKey = normalizeTermKey(entry.term);
    for (let j = 0; j < entryAliases.length; j++) {
      const key = normalizeTermKey(entryAliases[j]);
      if (!key || seen.has(key) || STORE.glossaryAliases[key] !== canonicalKey) continue;
      seen.add(key);
      forms.push({
        form: entryAliases[j],
        term: entry.term,
        kind: 'alias',
        requiresUppercaseInitial: beginsWithUppercaseLetter(entryAliases[j])
      });
    }
  }

  return forms.sort((a, b) =>
    b.form.length - a.form.length ||
    (a.kind === b.kind ? 0 : a.kind === 'term' ? -1 : 1) ||
    a.form.localeCompare(b.form, 'de')
  );
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
    rebuildGlossaryAliases();
  }
  if (obj.attempts && typeof obj.attempts === 'object') {
    STORE.attempts = obj.attempts as MathPathStore['attempts'];
  }

  return true;
}
