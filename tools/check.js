// Syntax-checks every JavaScript file and validates the distribution layout.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

for (const file of walk(ROOT)) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`OK   ${path.relative(ROOT, file)}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${path.relative(ROOT, file)}\n${e.stderr}`);
  }
}

// Distribution checks: starhermit.txt, launch file, server script.
const sh = fs.readFileSync(path.join(ROOT, 'starhermit.txt'), 'utf8');
const meta = Object.fromEntries(sh.trim().split('\n').map(l => l.split('=')));
if (meta.name !== 'Timber Grid') { console.error('FAIL starhermit name'); failed = true; }
for (const key of ['launch', 'server']) {
  if (!meta[key] || !fs.existsSync(path.join(ROOT, meta[key]))) {
    console.error(`FAIL starhermit ${key}=${meta[key]} missing`);
    failed = true;
  } else {
    console.log(`OK   starhermit ${key}=${meta[key]}`);
  }
}
// index.html's import map resolves "three" to ./vendor/three.module.js, which is
// committed; node_modules is not, so the vendored copy is what must exist.
if (!fs.existsSync(path.join(ROOT, 'vendor/three.module.js'))) {
  console.error('FAIL vendored three.js module missing'); failed = true;
} else {
  console.log('OK   vendored three.js present');
}
if (!fs.existsSync(path.join(ROOT, 'LICENSE.md'))) {
  console.error('FAIL LICENSE.md missing'); failed = true;
} else {
  console.log('OK   LICENSE.md present');
}

process.exit(failed ? 1 : 0);
