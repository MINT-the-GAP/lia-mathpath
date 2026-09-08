// Runtime CSS for glossary hover/click interactions.

const CSS_ID = 'lia-mathpath-style-v1';
const ACCENT_VAR = '--lia-mathpath-accent-rgb';
const ACCENT_CONTRAST_VAR = '--lia-mathpath-accent-contrast-rgb';
const DEFAULT_ACCENT = '20, 115, 117';
const SURFACE_VAR = '--lia-mathpath-surface-rgb';
const TEXT_VAR = '--lia-mathpath-text-rgb';
const DEFAULT_SURFACE = '255, 255, 255';
const DEFAULT_TEXT = '24, 28, 34';
const DEFAULT_ACCENT_CONTRAST = '255, 255, 255';
const DARK_ACCENT_CONTRAST = '0, 0, 0';
const THEME_PROBE_SELECTOR = [
  '.lia-slide.active .lia-slide__content',
  '.lia-slide.current .lia-slide__content',
  'main.lia-slide__content',
  '.lia-content',
  'main'
].join(', ');

type RgbChannels = [number, number, number];

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseChannel(value: string): number | null {
  const normalized = value.trim();
  const numeric = Number(normalized.replace(/%$/, ''));
  if (!Number.isFinite(numeric)) return null;
  return clampChannel(normalized.endsWith('%') ? numeric * 2.55 : numeric);
}

function parseRgbChannels(color: string): RgbChannels | null {
  const normalized = String(color || '').trim();
  if (!normalized || normalized.toLowerCase() === 'transparent') return null;

  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3
      ? hex.split('').map(value => `${value}${value}`).join('')
      : hex;
    return [
      parseInt(expanded.slice(0, 2), 16),
      parseInt(expanded.slice(2, 4), 16),
      parseInt(expanded.slice(4, 6), 16)
    ];
  }

  const srgb = normalized.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (srgb) {
    return [
      clampChannel(Number(srgb[1]) * 255),
      clampChannel(Number(srgb[2]) * 255),
      clampChannel(Number(srgb[3]) * 255)
    ];
  }

  const functional = normalized.match(/^rgba?\(\s*([^)]*)\)/i)?.[1];
  const channels = (functional || normalized)
    .split('/')[0]
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(parseChannel);

  return channels.length === 3 && channels.every(value => value !== null)
    ? channels as RgbChannels
    : null;
}

function parseRgbTriplet(color: string): string | null {
  const channels = parseRgbChannels(color);
  return channels ? channels.join(', ') : null;
}

function isTransparent(color: string): boolean {
  const normalized = String(color || '').replace(/\s+/g, '').toLowerCase();
  return !normalized ||
    normalized === 'transparent' ||
    /^rgba\([^)]*,0(?:\.0+)?\)$/.test(normalized) ||
    /^rgb\([^)]*\/0(?:\.0+)?\)$/.test(normalized);
}

function themeProbe(): Element {
  return document.querySelector(THEME_PROBE_SELECTOR) || document.body || document.documentElement;
}

function readThemeToken(probe: Element, property: string): string | null {
  const candidates = [probe, document.body, document.documentElement].filter(
    (element, index, all): element is Element => Boolean(element) && all.indexOf(element) === index
  );

  for (let i = 0; i < candidates.length; i++) {
    const value = getComputedStyle(candidates[i]).getPropertyValue(property);
    const parsed = parseRgbTriplet(value);
    if (parsed) return parsed;
  }
  return null;
}

function readComputedThemePair(probe: Element): { surface: string; text: string } | null {
  let current: Element | null = probe;
  while (current) {
    const style = getComputedStyle(current);
    if (!isTransparent(style.backgroundColor)) {
      const surface = parseRgbTriplet(style.backgroundColor);
      const text = parseRgbTriplet(style.color);
      if (surface && text) return { surface, text };
    }
    current = current.parentElement;
  }
  return null;
}

function relativeLuminance(channels: RgbChannels): number {
  const linear = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: RgbChannels, second: RgbChannels): number {
  const high = Math.max(relativeLuminance(first), relativeLuminance(second));
  const low = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (high + 0.05) / (low + 0.05);
}

function accentContrast(accent: string): string {
  const channels = parseRgbChannels(accent);
  const dark = parseRgbChannels(DARK_ACCENT_CONTRAST);
  const light = parseRgbChannels(DEFAULT_ACCENT_CONTRAST);
  if (!channels || !dark || !light) return DEFAULT_ACCENT_CONTRAST;
  return contrastRatio(channels, dark) >= contrastRatio(channels, light)
    ? DARK_ACCENT_CONTRAST
    : DEFAULT_ACCENT_CONTRAST;
}

function setRootProperty(property: string, value: string): void {
  const style = document.documentElement.style;
  if (style.getPropertyValue(property).trim() !== value) {
    style.setProperty(property, value);
  }
}

export function syncAccentColor(): void {
  const probe = themeProbe();
  const accent = readThemeToken(probe, '--color-highlight') || DEFAULT_ACCENT;
  const tokenSurface = readThemeToken(probe, '--color-background');
  const tokenText = readThemeToken(probe, '--color-text');
  const computedPair = tokenSurface && tokenText ? null : readComputedThemePair(probe);
  const surface = tokenSurface && tokenText
    ? tokenSurface
    : computedPair?.surface || DEFAULT_SURFACE;
  const text = tokenSurface && tokenText
    ? tokenText
    : computedPair?.text || DEFAULT_TEXT;

  setRootProperty(ACCENT_VAR, accent);
  setRootProperty(ACCENT_CONTRAST_VAR, accentContrast(accent));
  setRootProperty(SURFACE_VAR, surface);
  setRootProperty(TEXT_VAR, text);
}

export function ensureCss(): void {
  if (document.getElementById(CSS_ID)) return;

  // Exclude copied or moved markers without overriding the navigation's own styles.
  const outsideToc = ':not(.lia-toc, .lia-toc *, [id="lia-bm-toc5"], [id="lia-bm-toc5"] *)';
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = [
    `.lia-mathpath-term${outsideToc}:not([data-lia-mathpath-auto-term]),`,
    `:root:not([data-lia-mathpath-tooltips="off"]) .lia-mathpath-term${outsideToc}[data-lia-mathpath-auto-term] {`,
    '  border-bottom: 1px dashed currentColor;',
    '  cursor: help;',
    '  font-weight: 500;',
    '}',
    `.lia-mathpath-glossary-highlight${outsideToc}:not([data-lia-mathpath-auto-term]),`,
    `:root:not([data-lia-mathpath-tooltips="off"]) .lia-mathpath-glossary-highlight${outsideToc}[data-lia-mathpath-auto-term] {`,
    '  background-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.18);',
    '  box-shadow: inset 0 -2px 0 rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.65);',
    '  font-weight: 500;',
    '  cursor: pointer;',
    '  transition: background-color 120ms ease, box-shadow 120ms ease;',
    '}',
    `.lia-mathpath-glossary-highlight${outsideToc}:not([data-lia-mathpath-auto-term]):hover,`,
    `:root:not([data-lia-mathpath-tooltips="off"]) .lia-mathpath-glossary-highlight${outsideToc}[data-lia-mathpath-auto-term]:hover {`,
    '  background-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.3);',
    '  box-shadow: inset 0 -2px 0 rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.82);',
    '}',
    '::highlight(lia-mathpath-glossary) {',
    '  background-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.18);',
    '  text-decoration: underline solid rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.72);',
    '  text-decoration-thickness: 2px;',
    '  text-underline-offset: 2px;',
    '}',
    '::highlight(lia-mathpath-glossary-hover) {',
    '  background-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.3);',
    '  text-decoration-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.9);',
    '}',
    '.lia-mathpath-range-layer {',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 2147482000;',
    '  overflow: hidden;',
    '  pointer-events: none;',
    '  contain: strict;',
    '}',
    '.lia-mathpath-range-rect {',
    '  position: absolute;',
    '  box-sizing: border-box;',
    '  background-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.18);',
    '  box-shadow: inset 0 -2px 0 rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.72);',
    '}',
    '.lia-mathpath-range-rect--active {',
    '  background-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.3);',
    '  box-shadow: inset 0 -2px 0 rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.9);',
    '}',
    '.lia-mathpath-overlay-open {',
    '  overflow: hidden;',
    '}',
    '.lia-mathpath-explain-overlay {',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 2147483200;',
    '  display: none;',
    '  align-items: center;',
    '  justify-content: center;',
    '  background: rgba(0, 0, 0, 0.55);',
    '}',
    '.lia-mathpath-explain-overlay[data-open="1"] {',
    '  display: flex;',
    '}',
    '.lia-mathpath-explain-dialog {',
    '  width: 90vw;',
    '  height: 90vh;',
    '  background: rgb(var(--lia-mathpath-surface-rgb, 255, 255, 255));',
    '  border-radius: 10px;',
    '  overflow: hidden;',
    '  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35), 0 0 0 3px rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.95);',
    '  border: 3px solid rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 1);',
    '  display: grid;',
    '  grid-template-rows: auto 1fr;',
    '}',
    '.lia-mathpath-explain-header {',
    '  display: flex;',
    '  justify-content: flex-end;',
    '  align-items: center;',
    '  padding: 0.35rem 0.6rem;',
    '  background: rgb(var(--lia-mathpath-surface-rgb, 255, 255, 255));',
    '  border-bottom: 1px solid rgba(var(--lia-mathpath-text-rgb, 24, 28, 34), 0.2);',
    '  color: rgba(var(--lia-mathpath-text-rgb, 24, 28, 34), 1);',
    '}',
    '.lia-mathpath-explain-close {',
    '  margin: 0;',
    '  padding: 0.32rem 0.7rem;',
    '  border: 1px solid rgb(var(--lia-mathpath-accent-rgb, 20, 115, 117)) !important;',
    '  border-radius: 0.4rem;',
    '  background: rgb(var(--lia-mathpath-accent-rgb, 20, 115, 117)) !important;',
    '  color: rgb(var(--lia-mathpath-accent-contrast-rgb, 255, 255, 255)) !important;',
    '  -webkit-text-fill-color: rgb(var(--lia-mathpath-accent-contrast-rgb, 255, 255, 255)) !important;',
    '  -webkit-appearance: none;',
    '  appearance: none;',
    '  font: inherit;',
    '  font-weight: 600;',
    '  cursor: pointer;',
    '}',
    '.lia-mathpath-explain-close:hover {',
    '  filter: brightness(0.92);',
    '}',
    '.lia-mathpath-explain-close:focus-visible {',
    '  outline: 2px solid rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.45);',
    '  outline-offset: 1px;',
    '}',
    '.lia-mathpath-explain-frame {',
    '  width: 100%;',
    '  height: 100%;',
    '  border: 0;',
    '  background: rgb(var(--lia-mathpath-surface-rgb, 255, 255, 255));',
    '}',
    '.lia-mathpath-tooltip {',
    '  position: fixed;',
    '  z-index: 2147483000;',
    '  max-width: min(34rem, calc(100vw - 2rem));',
    '  padding: 0.6rem 0.8rem;',
    '  border-radius: 0.5rem;',
    '  border: 1px solid rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.55);',
    '  background: rgba(var(--lia-mathpath-surface-rgb, 255, 255, 255), 0.98);',
    '  color: rgb(var(--lia-mathpath-text-rgb, 24, 28, 34));',
    '  -webkit-text-fill-color: rgb(var(--lia-mathpath-text-rgb, 24, 28, 34));',
    '  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);',
    '  font-size: inherit;',
    '  line-height: inherit;',
    '  font-family: inherit;',
    '  pointer-events: none;',
    '  opacity: 0;',
    '  transform: translateY(4px);',
    '  transition: opacity 120ms ease, transform 120ms ease;',
    '}',
    '.lia-mathpath-tooltip--nested {',
    '  z-index: 2147483100;',
    '}',
    '.lia-mathpath-tooltip-title,',
    '.lia-mathpath-tooltip-title.lia-mathpath-term {',
    '  margin-bottom: 0.35rem;',
    '  padding-bottom: 0.35rem;',
    '  border-bottom: none !important;',
    '  box-shadow: none !important;',
    '  background-image: linear-gradient(rgba(var(--lia-mathpath-text-rgb, 24, 28, 34), 0.25), rgba(var(--lia-mathpath-text-rgb, 24, 28, 34), 0.25));',
    '  background-repeat: no-repeat;',
    '  background-position: left bottom;',
    '  background-size: 100% 1px;',
    '}',
    '.lia-mathpath-tooltip-body {',
    '}',
    '.lia-mathpath-tooltip .lia-mathpath-glossary-highlight {',
    '  border-bottom: none !important;',
    '  box-shadow: none !important;',
    '  text-decoration: none !important;',
    '}',
    '.lia-mathpath-tooltip .lia-mathpath-term {',
    '  border-bottom: none !important;',
    '  box-shadow: none !important;',
    '}',
    '.lia-mathpath-tooltip .katex,',
    '.lia-mathpath-tooltip .katex * {',
    '  border-bottom: none !important;',
    '  text-decoration: none !important;',
    '  cursor: inherit !important;',
    '  font-weight: inherit !important;',
    '}',
    '.lia-mathpath-tooltip[data-open="1"] {',
    '  opacity: 1;',
    '  transform: translateY(0);',
    '  pointer-events: auto;',
    '}'
  ].join('\n');

  document.head.appendChild(style);
  syncAccentColor();
}
