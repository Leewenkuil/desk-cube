// Builds the public website (docs/) from index.html and the files in public/.
// index.html is written without <html>/<head> tags because the Claude artifact adds them;
// a standalone website needs them, so this wraps the page in the same skeleton, plus the tags
// only the real site uses: search description, link previews, app icons and the app manifest.
// The color-scheme meta tells browsers the page has its own dark theme, so "force dark" features leave it alone.
// Run: node build-site.js
const fs = require('fs');
const path = require('path');

const SITE = 'https://deskcube.app/';
const TITLE = 'Desk Cube – a free 3D puzzle cube, timer and lessons';
const DESC = 'Turn a 3D puzzle cube in your browser: 2×2, 3×3 and 4×4, step-by-step lessons for beginners, a speed timer, a daily challenge, a leaderboard and replays you can share.';

// The artifact's own short title stays in index.html; the site gets a fuller one in its head.
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/^<title>[^<]*<\/title>\n/, '');
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<link rel="canonical" href="${SITE}">
<meta name="theme-color" content="#f6f8f9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151d23" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="Desk Cube">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Desk Cube">
<meta property="og:title" content="Desk Cube">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A solved 3×3 cube beside the words Desk Cube">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Desk Cube', url: SITE,
  description: DESC, applicationCategory: 'GameApplication', operatingSystem: 'Any',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
})}</script>
<!-- Cloudflare Web Analytics: visitor counts without cookies. Only the real site has it, so the Claude preview isn't counted. -->
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "1db7e9df27f34d1e9a63cfbecb6bc0c8"}'></script>
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
</head>
<body>
`;
const out = path.join(__dirname, 'docs');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), head + src + '\n</body>\n</html>\n');
// Icons, the preview picture, the app manifest, the offline worker, robots.txt and the sitemap.
for (const f of fs.readdirSync(path.join(__dirname, 'public'))) fs.copyFileSync(path.join(__dirname, 'public', f), path.join(out, f));
// Tells GitHub Pages to serve the files as they are.
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// The site's own domain (set up in Cloudflare DNS); GitHub Pages reads it from this file.
fs.writeFileSync(path.join(out, 'CNAME'), 'deskcube.app\n');
console.log('Built docs/');
