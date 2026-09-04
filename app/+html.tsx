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
        <script dangerouslySetInnerHTML={{ __html: detectBundleFailure }} />

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

const detectBundleFailure = `
window.addEventListener('error', function (event) {
  var el = event && event.target;
  if (!el || el.tagName !== 'SCRIPT' || !el.src) return;
  if (el.src.indexOf('/expo/static/') === -1 && el.src.indexOf('/_expo/static/') === -1) return;
  var root = document.getElementById('root') || document.body;
  if (!root) return;
  root.innerHTML = '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#121110;color:#f3efe8;font-family:system-ui,sans-serif;padding:32px;text-align:center"><h1 style="font-size:22px;margin:0 0 12px">Couldn’t load the app</h1><p style="color:#9a938a;line-height:1.5;margin:0 0 20px">The JavaScript bundle failed to load. Try a hard refresh.</p><button onclick="location.reload()" style="background:#e85d4c;color:#fff;border:0;border-radius:12px;padding:12px 24px;font-size:16px;font-weight:600;cursor:pointer">Try again</button></div>';
}, true);
`;
