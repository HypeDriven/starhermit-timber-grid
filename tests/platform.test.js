// platform.test.js — src/platform.js over starhermit-sdk.js with a stubbed
// fetch and launch hash: token read, nickname, cloud-save path game:<slug>
// round-trip, settings patch, controls, and no network standalone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The SDK is a classic browser script; package.json "type": "module" makes
// Node treat .js as ESM, so evaluate it with a CommonJS shim.
const mod = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(mod, mod.exports);
const SDK = mod.exports;
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `x.${b64url({ sub: 'u-12345678', game_scope: 'timber-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.y`;

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

let n = 0;
async function setup(hash, hostname = 'timber-test.starhermit.com') {
  const calls = [], store = new Map(), etags = new Map();
  let version = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    if (path.endsWith('/profile')) return json({ nickname: 'Carpenter' });
    if (path.includes('/cloud-saves/')) {
      if (path.endsWith('/info')) {
        const slot = path.slice(0, -5);
        return json(store.has(slot) ? { exists: true, etag: etags.get(slot) } : { exists: false });
      }
      if (init.method === 'PUT') {
        const match = init.headers?.['If-Match'];
        if (match && match !== etags.get(path)) return new Response(JSON.stringify({ etag: etags.get(path) }), { status: 412 });
        store.set(path, JSON.parse(init.body).dataBase64);
        etags.set(path, '"v' + (++version) + '"');
        return json({ etag: etags.get(path) });
      }
      return store.has(path) ? new Response(Buffer.from(store.get(path), 'base64')) : new Response(null, { status: 404 });
    }
    if (path.endsWith('/settings')) return init.method === 'PATCH' ? new Response(null, { status: 204 }) : json({ settings: { theme: 'cabin' } });
    if (path.endsWith('/controls')) return json({ actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    return new Response(null, { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname };
  const win = { location, history: { state: null, replaceState: (_s, _t, u) => { location.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } } };
  globalThis.window = { location, addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.localStorage = memStorage();
  globalThis.fetch = (...a) => fetch(...a);
  globalThis.StarHermit = SDK.create({ window: win, fetch });
  const p = await import('../src/platform.js?case=' + (n++));
  // Another device writing the slot: this client's next conditional write is refused (412).
  const otherDevice = async (doc) => {
    const zipped = await globalThis.StarHermit._zip('save.json', new TextEncoder().encode(JSON.stringify(doc)));
    const slot = [...store.keys()][0];
    store.set(slot, Buffer.from(zipped).toString('base64'));
    etags.set(slot, '"v' + (++version) + '"');
  };
  return { calls, sh: globalThis.StarHermit, location, p, otherDevice };
}

test('launch token read + stripped; nickname; platform settings + controls adopted', async () => {
  const { p, sh, location } = await setup('#game_token=' + JWT);
  await p.init();
  assert.equal(p.isHosted(), true);
  assert.equal(sh.slug, 'timber-test');
  assert.equal(location.hash, '');
  assert.equal(p.playerName(), 'Carpenter');
  assert.equal(p.loadSettings().theme, 'cabin');
  assert.deepEqual(p.getBindings().hint, ['KeyJ']);
  assert.deepEqual(p.getBindings().undo, ['KeyU']);
  sh.signOut();
});

test('cloud save round-trips progression through game:<slug>', async () => {
  const { p, sh, calls } = await setup('#game_token=' + JWT);
  await p.init();
  const prog = p.loadProgression();
  prog.totalScore = 777;
  p.saveProgression(prog);
  await p.flushCloudSave();
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:timber-test')));
  assert.equal(put.auth, 'Bearer ' + JWT);
  assert.equal((await sh.loadJSON()).data.totalScore, 777);
  sh.signOut();
});

test('settings PATCH of changed keys + invite link', async () => {
  const { p, sh, calls } = await setup('#game_token=' + JWT);
  await p.init();
  p.saveSettings({ ...p.loadSettings(), muted: true });
  await new Promise((r) => setTimeout(r, 900));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.url.endsWith('/api/v1/games/timber-test/settings'));
  assert.deepEqual(JSON.parse(patch.body), { settings: { muted: true } });
  assert.match(p.inviteLink(), /game-invite\/u-12345678\/timber-test$/);
  sh.signOut();
});

test('standalone: no network calls', async () => {
  const { p, calls } = await setup('', 'example.com');
  await p.init();
  assert.equal(p.isHosted(), false);
  assert.equal(p.canSignIn(), false);
  assert.equal(p.inviteLink(), null);
  p.saveProgression(p.loadProgression());
  p.saveSettings(p.loadSettings());
  assert.equal(await p.getHostedBoard(), null);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(calls.length, 0);
});

test('sign-in offered on the platform host without a token', async () => {
  const { p, calls } = await setup('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  await p.init();
  assert.equal(p.canSignIn(), true);
  assert.equal(calls.length, 0);
});

test('a save conflict merges the other device\'s progress with this device\'s and saves again', async () => {
  const { p, sh, otherDevice } = await setup('#game_token=' + JWT);
  try {
    await p.init();
    const mine = { ...p.loadProgression(), journeyStage: 5, bests: { 'journey:4': { score: 300, at: 1 } }, achievements: { first_clear: 10 }, totalScore: 900, gamesPlayed: 6 };
    p.saveProgression(mine);
    assert.equal(await p.flushCloudSave(), true);
    const theirs = { journeyStage: 8, journeyBest: {}, bests: { 'journey:4': { score: 250, at: 2 }, 'daily:2026-10-17': { score: 400, at: 3 } }, achievements: { first_clear: 5, combo_master: 7 }, totalScore: 1200, gamesPlayed: 4 };
    await otherDevice(p.sealProgression(theirs));
    let merged = 0;
    p.onProgressMerged(() => { merged++; });
    p.saveProgression({ ...mine, gamesPlayed: 7 });
    assert.equal(await p.flushCloudSave(), false); // refused: the slot moved on
    for (let i = 0; i < 50 && !merged; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(merged, 1);
    const local = p.loadProgression();
    assert.equal(local.journeyStage, 8);
    assert.equal(local.bests['journey:4'].score, 300);
    assert.equal(local.bests['daily:2026-10-17'].score, 400);
    assert.deepEqual(local.achievements, { first_clear: 5, combo_master: 7 });
    assert.equal(local.gamesPlayed, 7);
    assert.equal(local.totalScore, 1200);
    assert.equal(await p.flushCloudSave(), true);
    assert.equal((await sh.loadJSON()).data.journeyStage, 8);
  } finally { sh.signOut(); }
});
