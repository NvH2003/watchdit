/**
 * Vercel does not reliably serve Expo's `/_expo/static/...` client bundles.
 * Copy them under `/assets/...` (which does get published) and rewrite HTML.
 *
 * Always publish a stable `/assets/js/entry.js` so SSR HTML in the serverless
 * function cannot drift from CDN hashes across deploys.
 */
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = path.join(process.cwd(), 'dist', 'client');
const SERVER_ROOT = path.join(process.cwd(), 'dist', 'server');
const EXPO_JS_DIR = path.join(CLIENT_ROOT, '_expo', 'static', 'js', 'web');
const ASSET_JS_DIR = path.join(CLIENT_ROOT, 'assets', 'js');
const STABLE_ENTRY_URL = '/assets/js/entry.js';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rewriteFile(file, replacements) {
  if (!/\.(html|js|json|css|map)$/i.test(file)) return false;
  let text = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const [from, to] of replacements) {
    if (!text.includes(from)) continue;
    text = text.split(from).join(to);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, text);
  return changed;
}

if (!fs.existsSync(EXPO_JS_DIR)) {
  console.error('fix-vercel-client-assets: missing dist/client/_expo/static/js/web');
  process.exit(1);
}

fs.mkdirSync(ASSET_JS_DIR, { recursive: true });

const entries = fs
  .readdirSync(EXPO_JS_DIR)
  .filter(name => name.startsWith('entry-') && name.endsWith('.js'));

if (entries.length === 0) {
  console.error('fix-vercel-client-assets: no entry-*.js found');
  process.exit(1);
}

// Prefer the largest bundle if Metro ever emits more than one entry-*.js.
entries.sort((a, b) => {
  return fs.statSync(path.join(EXPO_JS_DIR, b)).size - fs.statSync(path.join(EXPO_JS_DIR, a)).size;
});

const primary = entries[0];
const replacements = [];
const published = [];

for (const name of entries) {
  const from = path.join(EXPO_JS_DIR, name);
  const to = path.join(ASSET_JS_DIR, name);
  fs.copyFileSync(from, to);
  const size = fs.statSync(to).size;
  if (size < 100_000) {
    console.error(`fix-vercel-client-assets: ${name} looks too small (${size} bytes)`);
    process.exit(1);
  }
  console.log(`copied ${name} (${Math.round(size / 1024)} KB) → assets/js/`);
  published.push({ name, size, url: STABLE_ENTRY_URL, hashedUrl: `/assets/js/${name}` });
}

fs.copyFileSync(path.join(ASSET_JS_DIR, primary), path.join(ASSET_JS_DIR, 'entry.js'));
console.log(`published stable ${STABLE_ENTRY_URL} from ${primary}`);

for (const name of entries) {
  // Point every known Expo / hashed path at the stable URL.
  replacements.push([`/_expo/static/js/web/${name}`, STABLE_ENTRY_URL]);
  replacements.push([`/expo/static/js/web/${name}`, STABLE_ENTRY_URL]);
  replacements.push([`/assets/js/${name}`, STABLE_ENTRY_URL]);
}

const EXPO_STATIC = path.join(CLIENT_ROOT, '_expo', 'static');
const ASSET_EXPO_STATIC = path.join(CLIENT_ROOT, 'assets', 'expo-static');
if (fs.existsSync(EXPO_STATIC)) {
  fs.cpSync(EXPO_STATIC, ASSET_EXPO_STATIC, { recursive: true });
  replacements.push(['/_expo/static/', '/assets/expo-static/']);
  replacements.push(['/expo/static/', '/assets/expo-static/']);
}

let rewritten = 0;
for (const root of [CLIENT_ROOT, SERVER_ROOT]) {
  for (const file of walk(root)) {
    if (rewriteFile(file, replacements)) rewritten++;
  }
}

// Catch any remaining hashed entry URLs the build may have emitted.
const entryPathRe = /(?:\/_expo\/static\/js\/web\/|\/expo\/static\/js\/web\/|\/assets\/js\/)entry-[a-f0-9]+\.js/g;
for (const root of [CLIENT_ROOT, SERVER_ROOT]) {
  for (const file of walk(root)) {
    if (!/\.(html|js|json)$/i.test(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    if (!entryPathRe.test(before)) continue;
    entryPathRe.lastIndex = 0;
    const after = before.replace(entryPathRe, STABLE_ENTRY_URL);
    if (after !== before) {
      fs.writeFileSync(file, after);
      rewritten++;
    }
  }
}

const serverHtml = walk(SERVER_ROOT).filter(f => f.endsWith('.html'));
const onDisk = fs.existsSync(path.join(ASSET_JS_DIR, 'entry.js'));
if (!onDisk) {
  console.error('fix-vercel-client-assets: missing assets/js/entry.js');
  process.exit(1);
}
const referenced = serverHtml.some(file => fs.readFileSync(file, 'utf8').includes(STABLE_ENTRY_URL));
if (!referenced) {
  console.error(`fix-vercel-client-assets: ${STABLE_ENTRY_URL} not referenced in any server HTML`);
  process.exit(1);
}

fs.writeFileSync(
  path.join(ASSET_JS_DIR, 'manifest.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      entryUrl: STABLE_ENTRY_URL,
      primary,
      entries: published,
    },
    null,
    2
  )
);

console.log(`fix-vercel-client-assets: rewrote ${rewritten} files; ok`);
