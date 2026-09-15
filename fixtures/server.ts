import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const files = new Set(['broken.html', 'fixed.html', 'login-modal.html']);
const server = http.createServer(async (request, response) => {
  const name = new URL(request.url ?? '/', 'http://fixture.local').pathname.slice(1) || 'login-modal.html';
  if (!files.has(name)) { response.writeHead(404); response.end('Fixture not found'); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(await fs.readFile(fileURLToPath(new URL(name, import.meta.url))));
});
server.listen(4174, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:4174/login-modal.html'));
