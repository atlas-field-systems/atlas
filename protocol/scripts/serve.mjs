// Serves _site/ on http://localhost:8080 for trying the web viewer locally.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join('_site', path.endsWith('/') ? `${path}index.html` : path);
  let body;
  try { body = await readFile(file); } catch { return res.writeHead(404).end('Not found'); }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'text/plain' }).end(body);
}).listen(8080, () => console.log('Viewer at http://localhost:8080'));
