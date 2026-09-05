import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, shrink-to-fit=no" />
        <title>Watch'd It</title>
        <meta name="theme-color" content="#121110" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Watch'd It" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/pwa-180.png" />
        <script dangerouslySetInnerHTML={{ __html: registerServiceWorker }} />
        <script dangerouslySetInnerHTML={{ __html: ensureClientEntry }} />

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* Add any additional <head> elements that you want globally available on web... */}
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #121110;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #121110;
  }
}`;

const registerServiceWorker = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      Promise.all(regs.map((r) => r.unregister())).finally(() => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      });
    });
  });
}
`;

// Keep the deferred Expo entry script on the live CDN URL. Replacing the
// <script> node (not only src) is required after a 404 — browsers will not
// reload a failed deferred script when only the attribute changes.
const ensureClientEntry = `
(function () {
  var STABLE = '/assets/js/entry.js';
  function isEntrySrc(src) {
    return (
      src.indexOf('/assets/js/entry') === 0 ||
      src.indexOf('/_expo/static/js/web/entry-') === 0 ||
      src.indexOf('/expo/static/js/web/entry-') === 0
    );
  }
  function apply(url) {
    if (!url) return;
    var scripts = document.querySelectorAll('script[src*="entry"]');
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i];
      var src = old.getAttribute('src') || '';
      if (!isEntrySrc(src) || src === url) continue;
      var next = document.createElement('script');
      next.src = url;
      next.defer = true;
      old.parentNode.insertBefore(next, old);
      old.parentNode.removeChild(old);
    }
  }
  function sync() {
    apply(STABLE);
    try {
      fetch('/assets/js/manifest.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) {
          var url = (m && m.entryUrl) || (m && m.entries && m.entries[0] && m.entries[0].url) || STABLE;
          apply(url);
        })
        .catch(function () {});
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }
})();
`;
