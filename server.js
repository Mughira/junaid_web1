require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const mailTransporter = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function jsonResponse(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
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
    pathname = url.pathname;
  }

  // --- CORS preflight ---
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // --- Contacts API ---
  try {
    // POST /api/contacts
    if (req.method === 'POST' && pathname === '/api/contacts') {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const contact = await db.createContact(data);
      return jsonResponse(res, 201, { contact, success: true });
    }

    // GET /api/contacts
    if (req.method === 'GET' && pathname === '/api/contacts') {
      const search = url.searchParams.get('search');
      const service = url.searchParams.get('service');
      const status = url.searchParams.get('status');
      const contacts = await db.getContacts({ search, service, status });
      const stats = await db.getStats();
      return jsonResponse(res, 200, {
        contacts,
        total: contacts.length,
        stats,
        meta: { timestamp: new Date().toISOString(), version: '1.0' }
      });
    }

    // GET/PATCH/DELETE /api/contacts/:id
    const contactMatch = pathname.match(/^\/api\/contacts\/(\d+)$/);
    if (contactMatch) {
      const id = parseInt(contactMatch[1]);

      if (req.method === 'GET') {
        const contact = await db.getContactById(id);
        if (!contact) return jsonResponse(res, 404, { error: 'Contact not found' });
        return jsonResponse(res, 200, { contact });
      }

      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const { status } = JSON.parse(body);
        const contact = await db.updateContactStatus(id, status);
        if (!contact) return jsonResponse(res, 404, { error: 'Contact not found' });
        return jsonResponse(res, 200, { contact, success: true });
      }

      if (req.method === 'DELETE') {
        const deleted = await db.deleteContact(id);
        if (!deleted) return jsonResponse(res, 404, { error: 'Contact not found' });
        return jsonResponse(res, 200, { success: true });
      }
    }
    // POST /api/create-payment-link (copy link only, no email)
    if (req.method === 'POST' && pathname === '/api/create-payment-link') {
      if (!stripe) return jsonResponse(res, 500, { error: 'Stripe is not configured' });

      const body = await readBody(req);
      const { contactId, amount, description } = JSON.parse(body);

      if (!contactId || !amount || amount <= 0) {
        return jsonResponse(res, 400, { error: 'Contact ID and valid amount are required' });
      }

      const contact = await db.getContactById(contactId);
      if (!contact) return jsonResponse(res, 404, { error: 'Contact not found' });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: contact.email || undefined,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: description || 'Kingship Concierge Service',
              description: `Payment for ${contact.fullName}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        success_url: (req.headers.origin || 'http://localhost:8000') + '/payment-success.html',
        cancel_url: (req.headers.origin || 'http://localhost:8000') + '/payment-cancel.html',
      });

      return jsonResponse(res, 200, {
        success: true,
        paymentUrl: session.url,
        sessionId: session.id,
      });
    }

    // POST /api/send-payment (create link + send email)
    if (req.method === 'POST' && pathname === '/api/send-payment') {
      if (!stripe) return jsonResponse(res, 500, { error: 'Stripe is not configured' });
      if (!mailTransporter) return jsonResponse(res, 500, { error: 'Email is not configured' });

      const body = await readBody(req);
      const { contactId, amount, description } = JSON.parse(body);

      if (!contactId || !amount || amount <= 0) {
        return jsonResponse(res, 400, { error: 'Contact ID and valid amount are required' });
      }

      const contact = await db.getContactById(contactId);
      if (!contact) return jsonResponse(res, 404, { error: 'Contact not found' });
      if (!contact.email) return jsonResponse(res, 400, { error: 'Contact has no email address' });

      // Create Stripe Payment Link via Checkout Session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: contact.email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: description || 'Kingship Concierge Service',
              description: `Payment for ${contact.fullName}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        success_url: (req.headers.origin || 'http://localhost:8000') + '/payment-success.html',
        cancel_url: (req.headers.origin || 'http://localhost:8000') + '/payment-cancel.html',
      });

      // Send email with payment link
      await mailTransporter.sendMail({
        from: `"Kingship Concierge" <${process.env.SMTP_FROM}>`,
        to: contact.email,
        subject: 'Your Payment Link - Kingship Concierge',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#E8E4DC;padding:40px;border-radius:12px;">
            <div style="text-align:center;margin-bottom:32px;">
              <h1 style="color:#C9A84C;font-weight:300;letter-spacing:2px;margin:0;">KINGSHIP</h1>
              <p style="color:rgba(232,228,220,0.5);font-size:13px;margin:4px 0 0;">Concierge Services</p>
            </div>
            <p style="font-size:16px;line-height:1.6;">Dear ${contact.fullName},</p>
            <p style="font-size:16px;line-height:1.6;">Thank you for choosing Kingship Concierge. Please find your payment details below:</p>
            <div style="background:#1A1A1A;border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:24px;margin:24px 0;text-align:center;">
              <p style="color:rgba(232,228,220,0.5);font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Amount Due</p>
              <p style="color:#C9A84C;font-size:36px;font-weight:700;margin:0;">$${parseFloat(amount).toFixed(2)}</p>
              ${description ? `<p style="color:rgba(232,228,220,0.5);font-size:14px;margin:8px 0 0;">${description}</p>` : ''}
            </div>
            <div style="text-align:center;margin:32px 0;">
              <a href="${session.url}" style="display:inline-block;background:#C9A84C;color:#0A0A0A;text-decoration:none;padding:14px 48px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">Pay Now</a>
            </div>
            <p style="font-size:13px;color:rgba(232,228,220,0.5);text-align:center;margin-top:32px;">This is a secure payment link powered by Stripe. Your payment information is encrypted and secure.</p>
            <hr style="border:none;border-top:1px solid rgba(201,168,76,0.2);margin:32px 0;">
            <p style="font-size:12px;color:rgba(232,228,220,0.3);text-align:center;">Kingship Concierge &mdash; Premium Transportation & Experiences</p>
          </div>
        `,
      });

      return jsonResponse(res, 200, {
        success: true,
        paymentUrl: session.url,
        sessionId: session.id,
      });
    }

  } catch (err) {
    console.error('API error:', err);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }

  // Handle Squarespace API POST requests - return empty JSON response
  if (req.method === 'POST' && apiEndpoints.some(endpoint => pathname.startsWith(endpoint))) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({}));
    return;
  }

  // Serve dashboard
  if (pathname === '/dashboard') {
    pathname = '/dashboard.html';
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

// Initialize database and start server
db.initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\nServer running at http://localhost:${PORT}/`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`API: http://localhost:${PORT}/api/contacts\n`);
    console.log('Press Ctrl+C to stop the server\n');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
  console.log('\nStarting server without database...');
  server.listen(PORT, () => {
    console.log(`\nServer running at http://localhost:${PORT}/`);
    console.log('WARNING: Database is not connected. API endpoints will not work.\n');
  });
});
