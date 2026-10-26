// Localization: the game's string tables (src/strings.js, nine StarHermit
// locales plus Simplified Chinese) and the platform-control strings
// (src/sh-i18n.js), in the interface language the runtime reports
// (preferences().language: the player's choice in Options, else the device's).
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { LOCALES, STRINGS } from "../src/strings.js";
import { shText } from "../src/sh-i18n.js";

type Table = Record<string, string>;
const TABLES = STRINGS as unknown as Record<string, Table>;
const PRIMARY: Record<string, string> = { en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT", zh: "zh" };

/** The supported locale nearest a BCP 47 tag (en-GB, es-ES and fr-CA by region). */
export function pickLocale(tag: string): string {
  const t = String(tag || "en-US");
  const exact = [...LOCALES, "zh"].find((l) => l.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const lang = t.split("-")[0]!.toLowerCase();
  if (lang === "en" && /-(gb|ie|au|nz|za|in)$/i.test(t)) return "en-GB";
  if (lang === "es" && /-es$/i.test(t)) return "es-ES";
  if (lang === "fr" && /-ca$/i.test(t)) return "fr-CA";
  return PRIMARY[lang] ?? "en-US";
}

export let locale = pickLocale(preferences().language);
const listeners = new Set<() => void>();
/** fn() after the interface language changed. */
export function onLanguage(fn: () => void): void { listeners.add(fn); }
function apply(): void {
  ui.setLanguage(locale === "zh" ? "zh-CN" : locale);
  for (const fn of listeners) fn();
}
onPreferencesChange((p) => {
  const next = pickLocale(p.language);
  if (next === locale) return;
  locale = next;
  apply();
});
apply();

type Vars = Record<string, string | number>;
/** A game string by key in the player's language; `{name}` placeholders from vars. */
export function t(key: string, vars?: Vars): string {
  let s = TABLES[locale]?.[key] ?? TABLES["en-US"]![key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}
/** A platform-control string (sign-in, invite, leaderboard line); zh carries its own copies. */
export function ts(key: string, vars?: Vars): string {
  return locale === "zh" ? t(key, vars) : shText(key, vars ?? {}, locale);
}
