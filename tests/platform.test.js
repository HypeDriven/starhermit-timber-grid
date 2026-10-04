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
  const calls = [], store = new Map();
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    if (path.endsWith('/profile')) return json({ nickname: 'Carpenter' });
    if (path.includes('/cloud-saves/')) {
      if (init.method === 'PUT') { store.set(path, JSON.parse(init.body).dataBase64); return new Response(null, { status: 204 }); }
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
  return { calls, sh: globalThis.StarHermit, location, p };
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
  const { p, calls } = await setup('');
  await p.init();
  assert.equal(p.canSignIn(), true);
  assert.equal(calls.length, 0);
});
