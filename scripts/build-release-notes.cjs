const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/changelog.md'), 'utf8');
const output = path.join(root, '.tools/release-notes');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const plain = value => value.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');
const releases = [...source.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
if (!releases.length) throw new Error('No versions found in docs/changelog.md');

const content = releases.map(([, title, body]) => {
  const items = [...body.matchAll(/^- (.+)$/gm)].map(match => `<li>${escape(plain(match[1].trim()))}</li>`);
  if (!items.length) throw new Error(`No release notes for ${title}`);
  const version = title.match(/^\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error(`Invalid version: ${title}`);
  return `<section aria-labelledby="v${version}"><h2 id="v${version}">${escape(title)}</h2>\n<ul>${items.join('\n')}</ul></section>`;
}).join('\n');

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="PingScreen 版本更新记录">
<title>PingScreen · Release Notes</title>
<style>
body { margin: 0; background: #fff; color: #222; font: 16px/1.8 system-ui, sans-serif; }
main { max-width: 760px; margin: 56px auto; padding: 0 24px; overflow-wrap: anywhere; }
h1 { margin: 0 0 40px; font-size: 28px; line-height: 1.4; }
h2 { margin: 0 0 12px; font-size: 20px; scroll-margin-top: 24px; }
section + section { margin-top: 40px; }
ul { margin: 0; padding-left: 1.4em; }
li + li { margin-top: 6px; }
@media (max-width: 480px) { main { margin: 32px auto; padding: 0 20px; } }
</style>
</head>
<body><main><h1>PingScreen · Release Notes</h1>
${content}
</main></body>
</html>
`);
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log(`Release Notes generated: ${releases.length} versions → ${output}`);
