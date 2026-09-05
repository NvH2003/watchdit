/**
 * Write the published client entry URL next to api/index.ts and a build stamp
 * so Vercel always rebuilds the serverless function (includeFiles otherwise
 * can stay stale while static CDN assets update).
 */
const fs = require('fs');
const path = require('path');

const STABLE_ENTRY_URL = '/assets/js/entry.js';
const manifestPath = path.join(process.cwd(), 'dist', 'client', 'assets', 'js', 'manifest.json');
const outPath = path.join(process.cwd(), 'api', 'entry-url.json');
const stampPath = path.join(process.cwd(), 'api', 'build-stamp.json');

if (!fs.existsSync(manifestPath)) {
  console.error('write-entry-url: missing', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const url = typeof manifest.entryUrl === 'string' ? manifest.entryUrl : manifest.entries?.[0]?.url;
if (!url) {
  console.error('write-entry-url: no entry URL in manifest');
  process.exit(1);
}

const writtenAt = new Date().toISOString();
const payload = {
  url: STABLE_ENTRY_URL,
  hashedUrl: url === STABLE_ENTRY_URL ? manifest.entries?.[0]?.hashedUrl : url,
  primary: manifest.primary ?? manifest.entries?.[0]?.name,
  generatedAt: manifest.generatedAt,
  writtenAt,
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(
  stampPath,
  JSON.stringify(
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entryUrl: STABLE_ENTRY_URL,
      writtenAt,
    },
    null,
    2
  )
);

console.log('write-entry-url:', STABLE_ENTRY_URL, 'stamp →', stampPath);
