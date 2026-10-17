// Timber Grid — game language via sh-language.js (window.StarHermitLanguage):
// explicit choice (ui.language) → StarHermit account preferredLanguage →
// device languages → en-US. Supported: the nine StarHermit locales plus zh.
// The game's own Settings select is bound with bindSelect (panel: false), so
// the shared options panel shows no second selector.
import { LOCALES } from './strings.js';
import { setLang } from './ui.js';

export const SUPPORTED = [...LOCALES, 'zh'];
const listeners = new Set();
/** fn(locale) after every language change. */
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function apply(locale) {
  setLang(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const fn of listeners) { try { fn(locale); } catch (e) { console.error(e); } }
}

const SL = typeof window !== 'undefined' ? window.StarHermitLanguage : null;
export const language = SL ? SL.create({ game: 'timber-grid', supported: SUPPORTED, panel: false, apply }) : null;
if (!language) apply('en-US');

/** Bind the Settings language select (+ status line); zh gets its native name. Returns an unbind fn. */
export function bindLanguageSelect(select, status) {
  if (!language) return () => {};
  const unbind = language.bindSelect(select, status);
  const zh = select.querySelector('option[value="zh"]');
  if (zh) { zh.textContent = '中文'; zh.lang = 'zh'; }
  return unbind;
}
