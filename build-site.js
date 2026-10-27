// Builds the public website (docs/index.html) from index.html.
// index.html is written without <html>/<head> tags because the Claude artifact adds them;
// a standalone website needs them, so this wraps the page in the same skeleton.
// The color-scheme meta tells browsers the page has its own dark theme, so "force dark" features leave it alone.
// Run: node build-site.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
</head>
<body>
`;
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'docs', 'index.html'), head + src + '\n</body>\n</html>\n');
// Tells GitHub Pages to serve the files as they are.
fs.writeFileSync(path.join(__dirname, 'docs', '.nojekyll'), '');
console.log('Built docs/index.html');
