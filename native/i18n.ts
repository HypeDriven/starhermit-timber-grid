// Localization: assets/strings.json (generated from the browser build's tables:
// the nine StarHermit locales plus Simplified Chinese, which carries its own
// `starhermit.*` account lines) on the engine's strings, which follow the
// interface language the runtime reports (the player's choice in Options, else
// the device's) and own the locale fallback and the account strings.
import { onPreferencesChange, preferences, strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
// every Chinese tag reads the zh table, as the browser build did (the engine's chain keeps zh-TW off it)
const followLanguage = (tag: string): void => { strings.setLanguage(/^zh\b/i.test(tag) ? "zh" : null); };
followLanguage(preferences().language);
onPreferencesChange((p) => followLanguage(p.language));
const apply = (locale: string): void => { ui.setLanguage(locale === "zh" ? "zh-CN" : locale); };
apply(strings.locale);
strings.onChange(apply);

type Vars = Record<string, string | number>;
/** A game string by key in the player's language; `{name}` placeholders from vars. */
export function t(key: string, vars?: Vars): string { return strings.t(key, vars); }
/** An account string (signIn, invite, inviteCopied, inviteLink, signedOut, leaderboard…). */
export function ts(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
