/**
 * Write the published client entry URL next to api/index.ts so the Vercel
 * function always ships with the matching hash (includeFiles alone was stale).
 */
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(process.cwd(), 'dist', 'client', 'assets', 'js', 'manifest.json');
const outPath = path.join(process.cwd(), 'api', 'entry-url.json');

if (!fs.existsSync(manifestPath)) {
  console.error('write-entry-url: missing', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const url = manifest.entries?.[0]?.url;
if (!url) {
  console.error('write-entry-url: no entries in manifest');
  process.exit(1);
}

const payload = {
  url,
  name: manifest.entries[0].name,
  generatedAt: manifest.generatedAt,
  writtenAt: new Date().toISOString(),
};
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log('write-entry-url:', url);
