const fs = require('fs');
const path = require('path');

const serverDir = path.join(__dirname, '../dist/server');
const manifestPath = path.join(__dirname, '../dist/client/assets/js/manifest.json');

/**
 * Static CDN files and the serverless `dist/server` HTML can drift between
 * deploys (stale function package). Force every HTML shell to point at the
 * entry URL from the published client manifest before handling requests.
 */
function syncEntryScripts() {
  let entryUrl = null;
  try {
    entryUrl = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).entries?.[0]?.url;
  } catch {
    console.warn('api/index: missing client JS manifest', manifestPath);
    return;
  }
  if (!entryUrl || typeof entryUrl !== 'string') return;

  const replaceEntry = html =>
    html.replace(/\/assets\/js\/entry-[a-f0-9]+\.js/g, entryUrl)
      .replace(/\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/g, entryUrl)
      .replace(/\/expo\/static\/js\/web\/entry-[a-f0-9]+\.js/g, entryUrl);

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.html')) continue;
      const before = fs.readFileSync(full, 'utf8');
      const after = replaceEntry(before);
      if (after !== before) fs.writeFileSync(full, after);
    }
  }

  walk(serverDir);
}

syncEntryScripts();

// Bust Vercel function cache when the client entry changes.
try {
  require('../dist/client/assets/js/manifest.json');
} catch {
  // ignore — sync already warned
}

const { createRequestHandler } = require('expo-server/adapter/vercel');

module.exports = createRequestHandler({
  build: serverDir,
});
