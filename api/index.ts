const fs = require('fs');
const path = require('path');
const { createRequestHandler } = require('expo-server/adapter/vercel');

const serverDir = path.join(__dirname, '../dist/server');

function readEntryUrl() {
  // IMPORTANT: never require() these JSON files — the Vercel function bundler
  // can inline a stale copy from a previous build.
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

const expoHandler = createRequestHandler({
  build: serverDir,
});

module.exports = async function handler(req, res) {
  const entryUrl = readEntryUrl();
  const pathName = (req.url || '').split('?')[0];
  const patchHtml = Boolean(entryUrl) && !pathName.startsWith('/api/');

  if (!patchHtml) {
    return expoHandler(req, res);
  }

  const chunks = [];
  let contentType = '';
  const originalSetHeader = res.setHeader.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === 'content-type') {
      contentType = Array.isArray(value) ? value.join(';') : String(value);
    }
    return originalSetHeader(name, value);
  };

  res.write = (chunk, encoding, cb) => {
    if (chunk == null) return true;
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    chunks.push(buf);
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  };

  res.end = (chunk, encoding, cb) => {
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = undefined;
      encoding = undefined;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }
    if (chunk != null && chunk !== '') {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8')
      );
    }

    const raw = Buffer.concat(chunks);
    const head = raw.slice(0, 64).toString('utf8').toLowerCase();
    const isHtml =
      contentType.includes('text/html') ||
      head.includes('<!doctype') ||
      head.includes('<html');

    if (isHtml && entryUrl) {
      const html = rewriteEntryScripts(raw.toString('utf8'), entryUrl);
      const out = Buffer.from(html, 'utf8');
      try {
        originalSetHeader('content-length', String(out.length));
      } catch {
        // ignore
      }
      try {
        originalSetHeader('x-watchdit-entry', entryUrl);
      } catch {
        // ignore
      }
      return originalEnd(out, cb);
    }

    if (raw.length) originalWrite(raw);
    return originalEnd(cb);
  };

  return expoHandler(req, res);
};
