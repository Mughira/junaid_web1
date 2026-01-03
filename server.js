const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const BASE_DIR = __dirname;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

// Handle API endpoints that Squarespace tries to POST to
const apiEndpoints = [
  '/api/census/RecordHit',
  '/api/census/button-render',
  '/api/census/form-render',
];

const server = http.createServer((req, res) => {
  // Use WHATWG URL API instead of deprecated url.parse()
  const baseUrl = `http://${req.headers.host || 'localhost'}`;
  let url;
  try {
    url = new URL(req.url, baseUrl);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request: Invalid URL');
    return;
  }
  
  // Decode URL-encoded characters (like %20 for spaces)
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (err) {
    // If already decoded, use as-is
    pathname = url.pathname;
  }

  // Handle API POST requests - return empty JSON response
  if (req.method === 'POST' && apiEndpoints.some(endpoint => pathname.startsWith(endpoint))) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({}));
    return;
  }

  // Handle root - serve index.html
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Remove leading slash and resolve path
  let filePath = path.join(BASE_DIR, pathname.replace(/^\//, ''));

  // Security: prevent directory traversal
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Get file extension for MIME type
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // File not found - try fallback strategies
      
      // Fallback 0: If no extension, try adding .html (e.g., /about -> /about.html)
      if (!ext && !pathname.endsWith('/')) {
        const htmlPath = filePath + '.html';
        fs.access(htmlPath, fs.constants.F_OK, (htmlErr) => {
          if (!htmlErr) {
            // Found .html version, serve it
            fs.readFile(htmlPath, (readErr, data) => {
              if (!readErr) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
                return;
              }
              // Continue to other fallbacks if read fails
              handleOtherFallbacks();
            });
          } else {
            // Continue to other fallbacks
            handleOtherFallbacks();
          }
        });
        return;
      }
      
      // Other fallback strategies
      handleOtherFallbacks();
      return;
    }

    // File exists - read and serve it
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading file');
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
  
  // Helper function for other fallback strategies
  function handleOtherFallbacks() {
    // Fallback 1: For missing JS files, return empty to prevent chunk load errors
    if (ext === '.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('// Missing file: ' + pathname + '\n');
        return;
      }
      
      // Fallback 2: For images in subdirectories, check root directory
      if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.svg') {
        const fileName = path.basename(filePath);
        const rootFilePath = path.join(BASE_DIR, fileName);
        
        fs.access(rootFilePath, fs.constants.F_OK, (fallbackErr) => {
          if (!fallbackErr) {
            // Found in root, serve it
            fs.readFile(rootFilePath, (readErr, data) => {
              if (!readErr) {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
                return;
              }
              // If read fails, return 404
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('File not found: ' + pathname);
            });
          } else {
            // Not found in root either, return 404
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found: ' + pathname);
          }
        });
        return;
      }
      
      // File not found - return 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found: ' + pathname);
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}/`);
  console.log(`📄 Open: http://localhost:${PORT}/index.html\n`);
  console.log('Press Ctrl+C to stop the server\n');
});

