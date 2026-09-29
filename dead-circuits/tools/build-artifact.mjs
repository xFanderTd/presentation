// Bundles index.html + css + js into one self-contained page (dist/dead-circuits.html).
// The artifact host wraps the page in its own <html>/<head>/<body>, so we emit only
// the <title>, font link, inline <style>, the stage markup and inline <script>s.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, 'Dead Circuits'])[1];
const fontLinks = [...html.matchAll(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/g)].map((m) => m[0]).join('\n');
const css = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)">/g)]
  .map((m) => fs.readFileSync(path.join(root, m[1]), 'utf8')).join('\n');
const body = html.match(/<body>([\s\S]*?)<script/)[1].trim();
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]).filter((src) => fs.existsSync(path.join(root, src)));
const js = scripts.map((src) => `<script>/* ${src} */\n${fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
const out = `<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
${fontLinks}
<style>
${css}
</style>
${body}
${js}
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'dead-circuits.html'), out);
// Standalone single-file build (with doctype) for offline play / download
fs.writeFileSync(path.join(root, 'dist', 'dead-circuits-standalone.html'), `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n${out.replace(body, '').replace(js, '')}</head>\n<body>\n${body}\n${js}\n</body>\n</html>\n`);
console.log('scripts:', scripts.length, 'bytes:', out.length);
