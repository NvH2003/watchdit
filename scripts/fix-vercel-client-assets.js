/**
 * Vercel is not serving Expo's client JS from dist/client/_expo (404), while
 * /assets/* works. Copy the web entry bundle into assets/js and rewrite HTML.
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
  console.warn('fix-vercel-client-assets: no dist/client/_expo/static/js/web — skipping');
  process.exit(0);
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
for (const name of entries) {
  const from = path.join(EXPO_JS_DIR, name);
  const to = path.join(ASSET_JS_DIR, name);
  fs.copyFileSync(from, to);
  const size = fs.statSync(to).size;
  console.log(`copied ${name} (${Math.round(size / 1024)} KB) → assets/js/`);
  replacements.push([`/_expo/static/js/web/${name}`, `/assets/js/${name}`]);
  replacements.push([`/expo/static/js/web/${name}`, `/assets/js/${name}`]);
}

// Keep a generic rewrite for any remaining _expo/static URL (css, etc.)
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

console.log(`fix-vercel-client-assets: rewrote ${rewritten} files to use /assets/…`);
