const fs = require('fs');
const path = require('path');
const { createRequestHandler } = require('expo-server/adapter/vercel');

// Required so each deploy invalidates the Vercel function bundle (and its
// includeFiles copy of dist/). Without this, static CDN assets update while
// SSR HTML keeps pointing at a deleted hashed entry.
try {
  require('./build-stamp.json');
} catch {
  // Local / missing stamp — fine.
}

const serverDir = path.join(__dirname, '../dist/server');
const STABLE_ENTRY_URL = '/assets/js/entry.js';

function readEntryUrl() {
  // Prefer the stable URL; fall back to whatever the build wrote.
  const candidates = [
    path.join(__dirname, 'entry-url.json'),
    path.join(process.cwd(), 'api/entry-url.json'),
    path.join(__dirname, '../dist/client/assets/js/manifest.json'),
    path.join(process.cwd(), 'dist/client/assets/js/manifest.json'),
  ];
  for (const candidate of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (typeof json.entryUrl === 'string' && json.entryUrl.includes('/assets/js/')) {
        return json.entryUrl;
      }
      const url = typeof json.url === 'string' ? json.url : json.entries?.[0]?.url;
      if (typeof url === 'string' && url.includes('/assets/js/')) return STABLE_ENTRY_URL;
    } catch {
      // try next
    }
  }
  return STABLE_ENTRY_URL;
}

function rewriteEntryScripts(html, entryUrl) {
  return html
    .replace(/(?:\/_expo\/static\/js\/web\/|\/expo\/static\/js\/web\/|\/assets\/js\/)entry-[a-f0-9]+\.js/g, entryUrl)
    .replace(/\/assets\/js\/entry\.js/g, entryUrl);
}

function syncServerFilesOnDisk() {
  const entryUrl = readEntryUrl();
  if (!fs.existsSync(serverDir)) return entryUrl;

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(html|json)$/i.test(entry.name)) continue;
      const before = fs.readFileSync(full, 'utf8');
      const after = rewriteEntryScripts(before, entryUrl);
      if (after !== before) fs.writeFileSync(full, after);
    }
  };

  try {
    walk(serverDir);
  } catch (error) {
    console.warn('api/index: could not sync server entry scripts', error);
  }
  return entryUrl;
}

const entryUrl = syncServerFilesOnDisk();
console.log('api/index: using client entry', entryUrl);

module.exports = createRequestHandler({
  build: serverDir,
});
