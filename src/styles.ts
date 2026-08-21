// Runtime CSS for glossary hover/click interactions.

import 'katex/dist/katex.min.css';

const CSS_ID = 'lia-mathpath-style-v1';
const ACCENT_VAR = '--lia-mathpath-accent-rgb';
const DEFAULT_ACCENT = '20, 115, 117';
const SURFACE_VAR = '--lia-mathpath-surface-rgb';
const TEXT_VAR = '--lia-mathpath-text-rgb';
const DEFAULT_SURFACE = '255, 255, 255';
const DEFAULT_TEXT = '24, 28, 34';

function parseRgbTriplet(color: string): string | null {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match) {
    return `${match[1]}, ${match[2]}, ${match[3]}`;
  }

  const legacyMatch = color.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (legacyMatch) {
    const to255 = (value: string): number => Math.max(0, Math.min(255, Math.round(Number(value) * 255)));
    return `${to255(legacyMatch[1])}, ${to255(legacyMatch[2])}, ${to255(legacyMatch[3])}`;
  }

  return null;
}

export function syncAccentColor(): void {
  const button = document.querySelector('button');
  const color = button ? getComputedStyle(button).color : '';
  const accent = parseRgbTriplet(color) || DEFAULT_ACCENT;

  const body = document.body;
  const bodyStyle = body ? getComputedStyle(body) : null;
  const surface = parseRgbTriplet(bodyStyle?.backgroundColor || '') || DEFAULT_SURFACE;
  const text = parseRgbTriplet(bodyStyle?.color || '') || DEFAULT_TEXT;

  document.documentElement.style.setProperty(ACCENT_VAR, accent);
  document.documentElement.style.setProperty(SURFACE_VAR, surface);
  document.documentElement.style.setProperty(TEXT_VAR, text);
}

export function ensureCss(): void {
  if (document.getElementById(CSS_ID)) return;

  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = [
    '.lia-mathpath-term {',
    '  border-bottom: 1px dashed currentColor;',
    '  cursor: help;',
    '  font-weight: 500;',
    '}',
    '.lia-mathpath-glossary-highlight {',
    '  background-color: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.18);',
    '  box-shadow: inset 0 -2px 0 rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.65);',
    '  font-weight: 500;',
    '  cursor: pointer;',
    '  transition: background-color 120ms ease, box-shadow 120ms ease;',
    '}',
    '.lia-mathpath-glossary-highlight:hover {',
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
    '  background: #fff;',
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
    '  background: rgba(var(--lia-mathpath-surface-rgb, 255, 255, 255), 0.98);',
    '  border-bottom: 1px solid rgba(var(--lia-mathpath-text-rgb, 24, 28, 34), 0.2);',
    '  color: rgba(var(--lia-mathpath-text-rgb, 24, 28, 34), 1);',
    '}',
    '.lia-mathpath-explain-close {',
    '  margin: 0;',
    '  padding: 0.32rem 0.7rem;',
    '  border: 1px solid rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 1);',
    '  border-radius: 0.4rem;',
    '  background: rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 1);',
    '  color: #fff;',
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
    '  background: #fff;',
    '}',
    '.lia-mathpath-tooltip {',
    '  position: fixed;',
    '  z-index: 2147483000;',
    '  max-width: min(34rem, calc(100vw - 2rem));',
    '  padding: 0.6rem 0.8rem;',
    '  border-radius: 0.5rem;',
    '  border: 1px solid rgba(var(--lia-mathpath-accent-rgb, 20, 115, 117), 0.55);',
    '  background: rgba(18, 22, 29, 0.95);',
    '  color: #f6f8fb;',
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
    '  background-image: linear-gradient(rgba(246, 248, 251, 0.25), rgba(246, 248, 251, 0.25));',
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
