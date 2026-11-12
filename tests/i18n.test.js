import { readFileSync as readReviewedIdentityData } from 'node:fs';
const REVIEWED_IDENTITIES = JSON.parse(readReviewedIdentityData(new URL('./reviewed-identities.json', import.meta.url), 'utf8'));
// Only exact reviewed key/source pairs are exempt; all other English copies count.
function isReviewedIdentity(locale, key, source) {
  const row = REVIEWED_IDENTITIES.locales[locale]?.[key];
  return row?.source === source && typeof row.reason === 'string' && row.reason.length > 0;
}
// i18n.test.js — every string key the native client (native/*.ts) uses exists in all nine
// StarHermit locales (and zh), with the same {placeholders} as US English;
// content (themes, challenges, practice levels, tutorial steps, achievements)
// is named in every locale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as content from '../src/content.js';

const STRINGS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT', 'zh', 'fr-BE', 'de-BE', 'en-SG', 'en-HK', 'en-BQ', 'es-CO', 'de-IT', 'fr-IT', 'es-CL', 'es-AR', 'es-EC', 'zh-SG', 'ja-JP', 'nl-BE', 'ms-SG', 'ta-SG', 'zh-HK', 'yue-HK', 'nl-NL', 'fi-FI', 'sv-FI', 'et-EE', 'id-ID', 'vi-VN', 'de-BR', 'da-DE', 'lb-BE', 'co-FR', 'eu-FR', 'ca-FR', 'oc-FR', 'sl-IT', 'fur-IT', 'ca-IT', 'oc-IT', 'ca-ES', 'eu-ES', 'gl-ES', 'su-ID', 'bew-ID', 'km-VN', 'ru-FI', 'ru-EE'];
const ALL = LOCALES;
const code = readdirSync(new URL('../native/', import.meta.url)).filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(new URL('../native/' + f, import.meta.url), 'utf8')).join('\n');
const used = new Set();
for (const m of code.matchAll(/\bt\("([A-Za-z0-9]+)"(?!\s*\+)/g)) used.add(m[1]);
for (const m of code.matchAll(/"((?:sync|pal|cell|ach)[A-Z][A-Za-z0-9]*)"/g)) used.add(m[1]);
// keys passed through a table or variable: t(k) over the breakdown rows, the settings toggles
for (const k of ['placed', 'cleared', 'multi', 'combo', 'leftHanded', 'holdToDrag', 'haptics']) used.add(k);
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const camel = (id) => id.split('-').map(cap).join('');
for (const th of content.THEMES) used.add('theme' + cap(th.id));
for (const c of content.CHALLENGES) { used.add('ch' + camel(c.id)); used.add('ch' + camel(c.id) + 'Desc'); }
for (const d of content.PRACTICE_DIFFICULTIES) { used.add('pr' + cap(d.id)); used.add('pr' + cap(d.id) + 'Desc'); }
for (const k of ['tutPlace', 'tutClear', 'tutCombo']) { used.add(k + 'Title'); used.add(k + 'Text'); }
for (const k of ['achFirstClear', 'achComboMaster', 'achStreakWeek', 'achJourney20', 'achMarathon']) { used.add(k); used.add(k + 'Desc'); }
for (const k of ['easy', 'medium', 'hard', 'journey', 'daily', 'challenge', 'practice', 'learn', 'syncSaving', 'syncSynced', 'syncError']) used.add(k);
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine StarHermit locales plus zh', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...ALL].sort()));
test('found the keys in code', () => assert.ok(used.size > 100, String(used.size)));
for (const loc of ALL) {
  test(`${loc}: every used key, matching placeholders`, () => {
    assert.deepEqual([...used].filter((k) => typeof STRINGS[loc][k] !== 'string'), []);
    for (const k of used) assert.equal(vars(STRINGS[loc][k]), vars(STRINGS['en-US'][k]), `${loc}.${k}`);
  });
}
test('content entries match the authored English data', () => {
  const en = STRINGS['en-US'];
  for (const th of content.THEMES) assert.equal(en['theme' + cap(th.id)], th.name);
  for (const c of content.CHALLENGES) assert.equal(en['ch' + camel(c.id) + 'Desc'], c.description);
  for (const d of content.PRACTICE_DIFFICULTIES) assert.equal(en['pr' + cap(d.id)], d.name);
  assert.deepEqual(content.TUTORIAL_STEPS.map((s) => s.title), [en.tutPlaceTitle, en.tutClearTitle, en.tutComboTitle]);
});
test('non-English locales are translated', () => {
  for (const loc of ALL.filter((l) => !l.startsWith('en'))) {
    const same = ([...used].filter((k) => STRINGS[loc][k] === STRINGS['en-US'][k] && !/\{row\},\{col\}/.test(STRINGS['en-US'][k]))).filter((key) => !isReviewedIdentity(loc, key, STRINGS['en-US'][key]));
    assert.ok(same.length < 12, `${loc}: ${same.join(', ')}`);
  }
});
test('zh carries its own account strings (the engine has nine locales)', () => {
  const keys = [...new Set([...code.matchAll(/\bts\("([A-Za-z0-9]+)"/g)].map((m) => m[1]).concat(['leaderboardPosting', 'leaderboardRank', 'leaderboardPosted', 'leaderboardNotPosted']))];
  assert.ok(keys.length >= 6, keys.join(','));
  assert.deepEqual(keys.filter((k) => typeof STRINGS.zh[`starhermit.${k}`] !== 'string'), [], 'zh');
});
