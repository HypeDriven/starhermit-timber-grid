// progress.test.js — src/progress.js: the two-device merge, the browser
// build's cloud save (save.json text) and settings keys as the native client
// migrates them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checksum, defaultProgression, mergeProgression, migrateBrowserSetting, normalizeProgression,
  progressionFromBrowserSave, BROWSER_SETTING_KEYS, DEFAULT_SETTINGS,
} from '../src/progress.js';

test('merge keeps the furthest stage, better bests, earliest unlocks, larger totals', () => {
  const a = { journeyStage: 5, bests: { 'journey:3': { score: 90 }, daily: { score: 10 } }, achievements: { first_clear: 200 }, totalScore: 500, gamesPlayed: 9 };
  const b = { journeyStage: 3, bests: { 'journey:3': { score: 120 }, practice: { score: 7 } }, achievements: { first_clear: 100, marathon: 300 }, totalScore: 400, gamesPlayed: 12 };
  const m = mergeProgression(a, b);
  assert.equal(m.journeyStage, 5);
  assert.deepEqual(m.bests, { 'journey:3': { score: 120 }, daily: { score: 10 }, practice: { score: 7 } });
  assert.deepEqual(m.achievements, { first_clear: 100, marathon: 300 });
  assert.equal(m.totalScore, 500);
  assert.equal(m.gamesPlayed, 12);
  assert.deepEqual(mergeProgression(null, undefined), defaultProgression());
});

test('a browser-build save.json converts; a damaged one does not', () => {
  const data = { journeyStage: 7, journeyBest: {}, bests: { 'journey:6': { score: 300, at: 1 } }, achievements: { combo_master: 5 }, totalScore: 3000, gamesPlayed: 20 };
  const text = JSON.stringify({ version: 1, data, checksum: checksum(data), savedAt: 123 });
  assert.deepEqual(progressionFromBrowserSave(text), normalizeProgression(data));
  assert.equal(progressionFromBrowserSave(JSON.stringify({ version: 1, data, checksum: '00000000' })), null);
  assert.equal(progressionFromBrowserSave(JSON.stringify({ version: 2, data, checksum: checksum(data) })), null);
  assert.equal(progressionFromBrowserSave('not json'), null);
  assert.equal(progressionFromBrowserSave(null), null);
});

test('normalize repairs missing and mistyped fields', () => {
  const p = normalizeProgression({ journeyStage: '3', bests: [], totalScore: -5 });
  assert.equal(p.journeyStage, 3);
  assert.deepEqual(p.bests, {});
  assert.equal(p.totalScore, 0);
});

test('browser settings: kept where the game still has them, the runtime-owned ones dropped', () => {
  assert.equal(migrateBrowserSetting('theme', 'ember'), 'ember');
  assert.equal(migrateBrowserSetting('leftHanded', true), true);
  assert.equal(migrateBrowserSetting('leftHanded', 'yes'), undefined);
  assert.deepEqual(migrateBrowserSetting('tutorialsDone', ['learn', 3]), ['learn']);
  for (const k of ['volMusic', 'muted', 'graphics', 'quality', 'reducedMotion', 'highContrast', 'largeText']) assert.equal(migrateBrowserSetting(k, 1), undefined, k);
  for (const k of Object.keys(DEFAULT_SETTINGS)) assert.ok(BROWSER_SETTING_KEYS.includes(k), k);
});
