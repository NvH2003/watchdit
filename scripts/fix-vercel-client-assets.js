/**
 * Vercel does not reliably serve Expo's `/_expo/static/...` client bundles.
 * Copy them under `/assets/...` (which does get published) and rewrite HTML.
 *
 * Also: never let the build succeed if the rewritten entry file is missing —
 * a missing file + long Cache-Control caused sticky "Couldn't load the app".
 */
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = path.join(process.cwd(), 'dist', 'client');
const SERVER_ROOT = path.join(process.cwd(), 'dist', 'server');
const EXPO_JS_DIR = path.join(CLIENT_ROOT, '_expo', 'static', 'js', 'web');
const ASSET_JS_DIR = path.join(CLIENT_ROOT, 'assets', 'js');

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
  // Don't rewrite our own inline detector strings inside baked HTML more than needed;
  // replacements are exact entry paths / static prefixes only.
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
  published.push({ name, size, url: `/assets/js/${name}` });
  replacements.push([`/_expo/static/js/web/${name}`, `/assets/js/${name}`]);
  replacements.push([`/expo/static/js/web/${name}`, `/assets/js/${name}`]);
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

// Verify every published entry is referenced from server HTML and still on disk.
const serverHtml = walk(SERVER_ROOT).filter(f => f.endsWith('.html'));
for (const { name, url } of published) {
  const onDisk = fs.existsSync(path.join(ASSET_JS_DIR, name));
  if (!onDisk) {
    console.error(`fix-vercel-client-assets: missing after copy: ${name}`);
    process.exit(1);
  }
  const referenced = serverHtml.some(file => fs.readFileSync(file, 'utf8').includes(url));
  if (!referenced) {
    console.error(`fix-vercel-client-assets: ${url} not referenced in any server HTML`);
    process.exit(1);
  }
}

fs.writeFileSync(
  path.join(ASSET_JS_DIR, 'manifest.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), entries: published }, null, 2)
);

console.log(`fix-vercel-client-assets: rewrote ${rewritten} files; ok`);
