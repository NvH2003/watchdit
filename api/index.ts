const fs = require('fs');
const path = require('path');
const { createRequestHandler } = require('expo-server/adapter/vercel');

const serverDir = path.join(__dirname, '../dist/server');

function readEntryUrl() {
  try {
    // Bundled beside this function on every deploy.
    const fromApi = require('./entry-url.json');
    if (typeof fromApi?.url === 'string') return fromApi.url;
  } catch {
    // fall through
  }
  try {
    const manifestPath = path.join(__dirname, '../dist/client/assets/js/manifest.json');
    const url = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).entries?.[0]?.url;
    if (typeof url === 'string') return url;
  } catch {
    // fall through
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
    const isHtml =
      contentType.includes('text/html') ||
      raw.slice(0, 64).toString('utf8').toLowerCase().includes('<!doctype') ||
      raw.slice(0, 64).toString('utf8').includes('<html');

    if (isHtml && entryUrl) {
      const html = rewriteEntryScripts(raw.toString('utf8'), entryUrl);
      const out = Buffer.from(html, 'utf8');
      try {
        originalSetHeader('content-length', String(out.length));
      } catch {
        // headers may already be sent
      }
      // Debug header so we can confirm the rewrite ran in production.
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
