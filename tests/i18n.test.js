// i18n.test.js — every string key the native client (native/*.ts) uses exists in all nine
// StarHermit locales (and zh), with the same {placeholders} as US English;
// content (themes, challenges, practice levels, tutorial steps, achievements)
// is named in every locale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STRINGS, LOCALES } from '../src/strings.js';
import * as content from '../src/content.js';

const ALL = [...LOCALES, 'zh'];
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
    const same = [...used].filter((k) => STRINGS[loc][k] === STRINGS['en-US'][k] && !/\{row\},\{col\}/.test(STRINGS['en-US'][k]));
    assert.ok(same.length < 12, `${loc}: ${same.join(', ')}`);
  }
});
test('platform-control strings (ts) exist in every locale', async () => {
  const { SH_STRINGS } = await import('../src/sh-i18n.js');
  const keys = [...new Set([...code.matchAll(/\bts\("([A-Za-z0-9]+)"/g)].map((m) => m[1]).concat(['lbPosting', 'lbRank', 'lbPosted', 'lbNotPosted']))];
  assert.ok(keys.length >= 6, keys.join(','));
  for (const loc of LOCALES) assert.deepEqual(keys.filter((k) => typeof SH_STRINGS[loc][k] !== 'string'), [], loc);
  assert.deepEqual(keys.filter((k) => typeof STRINGS.zh[k] !== 'string'), [], 'zh');
});
