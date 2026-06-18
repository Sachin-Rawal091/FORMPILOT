/**
 * FormPilot Mock HTTP Server
 * Serves the KRP Government Registration Portal for live automation testing.
 * Port: 8080
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/krp' : req.url;

  console.log(`[Server] ${req.method} ${url}`);

  if (url === '/krp' || url === '/krp/') {
    const filePath = path.join(__dirname, 'krp_portal.html');
    serveFile(res, filePath, 'text/html');
    return;
  }

  if (url === '/job' || url === '/job/' || url === '/jobs' || url === '/jobs/') {
    const filePath = path.join(__dirname, 'job_portal.html');
    serveFile(res, filePath, 'text/html');
    return;
  }

  // Serve any other static files
  const filePath = path.join(__dirname, url);
  const ext = path.extname(filePath);
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  serveFile(res, filePath, mimeType);
});

function serveFile(res, filePath, mimeType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${filePath}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`\n🏛  KRP Government Portal running at: http://localhost:${PORT}/krp`);
  console.log(`💼  Job Application Portal running at: http://localhost:${PORT}/jobs`);
  console.log(`📋  Ready for FormPilot automation testing.\n`);
});
