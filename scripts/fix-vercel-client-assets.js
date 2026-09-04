/**
 * Vercel often skips underscore-prefixed folders in the static output
 * directory, so `/_expo/static/...` 404s and the app stays on SSR
 * "Connecting…". Rename the client bundle folder and rewrite HTML refs.
 */
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = path.join(process.cwd(), 'dist', 'client');
const SERVER_ROOT = path.join(process.cwd(), 'dist', 'server');
const FROM_DIR = path.join(CLIENT_ROOT, '_expo');
const TO_DIR = path.join(CLIENT_ROOT, 'expo');
const FROM_URL = '/_expo/static';
const TO_URL = '/expo/static';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rewriteFile(file) {
  if (!/\.(html|js|json|css|map)$/i.test(file)) return false;
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes(FROM_URL) && !before.includes('"/_expo/static') && !before.includes("'/_expo/static")) {
    return false;
  }
  const after = before.split(FROM_URL).join(TO_URL);
  if (after !== before) {
    fs.writeFileSync(file, after);
    return true;
  }
  return false;
}

if (!fs.existsSync(FROM_DIR)) {
  console.warn('fix-vercel-client-assets: dist/client/_expo not found — skipping');
  process.exit(0);
}

if (fs.existsSync(TO_DIR)) {
  fs.rmSync(TO_DIR, { recursive: true, force: true });
}
// Prefer copy+remove over rename — Windows often locks the export folder (EPERM).
fs.cpSync(FROM_DIR, TO_DIR, { recursive: true });
fs.rmSync(FROM_DIR, { recursive: true, force: true });

let rewritten = 0;
for (const root of [CLIENT_ROOT, SERVER_ROOT]) {
  for (const file of walk(root)) {
    if (rewriteFile(file)) rewritten++;
  }
}

console.log(
  `fix-vercel-client-assets: moved dist/client/_expo → dist/client/expo, rewrote ${rewritten} files`
);
