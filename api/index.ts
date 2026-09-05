const fs = require('fs');
const path = require('path');
const { createRequestHandler } = require('expo-server/adapter/vercel');

const serverDir = path.join(__dirname, '../dist/server');

function readEntryUrl() {
  // Never require() JSON — the function bundler can inline a stale copy.
  const candidates = [
    path.join(__dirname, '../dist/client/assets/js/manifest.json'),
    path.join(process.cwd(), 'dist/client/assets/js/manifest.json'),
    path.join(__dirname, 'entry-url.json'),
    path.join(process.cwd(), 'api/entry-url.json'),
  ];
  for (const candidate of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const url = typeof json.url === 'string' ? json.url : json.entries?.[0]?.url;
      if (typeof url === 'string' && url.includes('/assets/js/entry-')) return url;
    } catch {
      // try next
    }
  }
  return null;
}

function rewriteEntryScripts(html, entryUrl) {
  return html
    .replace(/\/assets\/js\/entry-[a-f0-9]+\.js/g, entryUrl)
    .replace(/\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/g, entryUrl)
    .replace(/\/expo\/static\/js\/web\/entry-[a-f0-9]+\.js/g, entryUrl);
}

function syncHtmlFilesOnDisk() {
  const entryUrl = readEntryUrl();
  if (!entryUrl || !fs.existsSync(serverDir)) return entryUrl;

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.html')) continue;
      const before = fs.readFileSync(full, 'utf8');
      const after = rewriteEntryScripts(before, entryUrl);
      if (after !== before) fs.writeFileSync(full, after);
    }
  };

  try {
    walk(serverDir);
  } catch (error) {
    console.warn('api/index: could not sync HTML entry scripts', error);
  }
  return entryUrl;
}

const entryUrl = syncHtmlFilesOnDisk();
if (entryUrl) {
  console.log('api/index: using client entry', entryUrl);
}

module.exports = createRequestHandler({
  build: serverDir,
});
