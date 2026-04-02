require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./db');
const authnet = require('./authnet');
const rentsyst = require('./rentsyst');
const nodemailer = require('nodemailer');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 8000;
const BASE_DIR = __dirname;
const RETURN_URL = process.env.RETURN_URL || 'https://kingshiptransportations.com';

// Dashboard API key – set in .env to protect payment endpoints
const API_KEY = process.env.DASHBOARD_API_KEY || '';

const mailTransporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const mimeTypes = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp',
};

// Squarespace legacy endpoints that need an empty 200 response
const squarespaceEndpoints = [
  '/api/census/RecordHit',
  '/api/census/button-render',
  '/api/census/form-render',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
}

function jsonResponse(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function jsonError(res, statusCode, message, details) {
  return jsonResponse(res, statusCode, {
    success: false,
    error: { message, ...(details ? { details } : {}) },
  });
}

function htmlResponse(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * Authentication check for protected endpoints.
 * If DASHBOARD_API_KEY is set, requests must include either:
 *   - Header: X-Api-Key: <key>
 *   - Query param: ?apiKey=<key>
 *   - Referer from /dashboard (same-origin dashboard requests)
 *
 * When no API key is configured, all requests are allowed (dev mode).
 */
function isAuthorized(req, url) {
  if (!API_KEY) return true; // no key configured – allow all (dev)

  // Check header
  if (req.headers['x-api-key'] === API_KEY) return true;

  // Check query param
  if (url.searchParams.get('apiKey') === API_KEY) return true;

  // Allow same-origin dashboard requests (Referer check)
  const referer = req.headers.referer || '';
  if (referer.includes('/dashboard')) return true;

  return false;
}

/**
 * Validate payment request body.
 * Returns { contactId, amount, description } or throws.
 */
function validatePaymentInput(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw { status: 400, message: 'Invalid JSON body' };
  }

  const { contactId, amount, description } = parsed;

  if (!contactId || !Number.isInteger(contactId) || contactId <= 0) {
    throw { status: 400, message: 'contactId must be a positive integer' };
  }

  const numAmount = parseFloat(amount);
  if (!numAmount || numAmount <= 0 || numAmount > 999999.99) {
    throw { status: 400, message: 'amount must be between $0.01 and $999,999.99' };
  }

  if (description && typeof description !== 'string') {
    throw { status: 400, message: 'description must be a string' };
  }

  return {
    contactId,
    amount: numAmount,
    description: (description || '').substring(0, 255),
  };
}

/**
 * Build an HTML page that auto-submits a POST form to Authorize.Net
 * Accept Hosted with the provided token.
 */
function buildPaymentRedirectPage(token, formUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Redirecting to Payment - Kingship</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0A0A0A;color:#E8E4DC;min-height:100vh;display:flex;align-items:center;justify-content:center}
.container{text-align:center;max-width:480px;padding:40px}
h1{font-size:28px;font-weight:300;letter-spacing:2px;color:#C9A84C;margin-bottom:8px}
p{font-size:15px;color:rgba(232,228,220,0.5);line-height:1.6;margin-bottom:24px}
.spinner{width:40px;height:40px;border:3px solid rgba(201,168,76,0.2);border-top:3px solid #C9A84C;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 24px}
@keyframes spin{to{transform:rotate(360deg)}}
noscript a{display:inline-block;padding:12px 32px;background:#C9A84C;color:#0A0A0A;text-decoration:none;border-radius:8px;font-weight:600}
</style>
</head>
<body>
<div class="container">
  <div class="spinner"></div>
  <h1>KINGSHIP</h1>
  <p>Redirecting you to our secure payment page...</p>
  <form id="payForm" method="POST" action="${formUrl}">
    <input type="hidden" name="token" value="${token}">
    <noscript><button type="submit" style="padding:12px 32px;background:#C9A84C;color:#0A0A0A;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Continue to Payment</button></noscript>
  </form>
</div>
<script>document.getElementById('payForm').submit();</script>
</body>
</html>`;
}

/**
 * Build the branded payment email HTML.
 */
function buildPaymentEmail(contact, amount, description, paymentPageUrl) {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#E8E4DC;padding:40px;border-radius:12px;">
  <div style="text-align:center;margin-bottom:32px;">
    <h1 style="color:#C9A84C;font-weight:300;letter-spacing:2px;margin:0;">KINGSHIP</h1>
    <p style="color:rgba(232,228,220,0.5);font-size:13px;margin:4px 0 0;">Transportations Services</p>
  </div>
  <p style="font-size:16px;line-height:1.6;">Dear ${escapeHtml(contact.fullName)},</p>
  <p style="font-size:16px;line-height:1.6;">Thank you for choosing Kingship. Please find your payment details below:</p>
  <div style="background:#1A1A1A;border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:24px;margin:24px 0;text-align:center;">
    <p style="color:rgba(232,228,220,0.5);font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Amount Due</p>
    <p style="color:#C9A84C;font-size:36px;font-weight:700;margin:0;">$${parseFloat(amount).toFixed(2)}</p>
    ${description ? `<p style="color:rgba(232,228,220,0.5);font-size:14px;margin:8px 0 0;">${escapeHtml(description)}</p>` : ''}
  </div>
  <div style="text-align:center;margin:32px 0;">
    <a href="${paymentPageUrl}" style="display:inline-block;background:#C9A84C;color:#0A0A0A;text-decoration:none;padding:14px 48px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">Pay Now</a>
  </div>
  <p style="font-size:13px;color:rgba(232,228,220,0.5);text-align:center;margin-top:32px;">This is a secure payment link powered by Authorize.Net. Your payment information is encrypted and secure.</p>
  <hr style="border:none;border-top:1px solid rgba(201,168,76,0.2);margin:32px 0;">
  <p style="font-size:12px;color:rgba(232,228,220,0.3);text-align:center;">Kingship &mdash; Premium Transportation &amp; Experiences</p>
</div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const baseUrl = `http://${req.headers.host || 'localhost'}`;
  let url;
  try {
    url = new URL(req.url, baseUrl);
  } catch {
    return htmlResponse(res, 400, 'Bad Request: Invalid URL');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }

  // --- CORS preflight ---
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // --- Squarespace legacy endpoints ---
  if (req.method === 'POST' && squarespaceEndpoints.some((ep) => pathname.startsWith(ep))) {
    return jsonResponse(res, 200, {});
  }

  // ===================================================================
  // API ROUTES
  // ===================================================================
  try {
    // -----------------------------------------------------------------
    // POST /api/contacts  (public – form submissions)
    // -----------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/contacts') {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const contact = await db.createContact(data);
      return jsonResponse(res, 201, { contact, success: true });
    }

    // -----------------------------------------------------------------
    // GET /api/contacts
    // -----------------------------------------------------------------
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
        meta: { timestamp: new Date().toISOString(), version: '2.0' },
      });
    }

    // -----------------------------------------------------------------
    // GET/PATCH/DELETE /api/contacts/:id
    // -----------------------------------------------------------------
    const contactMatch = pathname.match(/^\/api\/contacts\/(\d+)$/);
    if (contactMatch) {
      const id = parseInt(contactMatch[1]);

      if (req.method === 'GET') {
        const contact = await db.getContactById(id);
        if (!contact) return jsonError(res, 404, 'Contact not found');
        return jsonResponse(res, 200, { contact });
      }

      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const { status } = JSON.parse(body);
        const contact = await db.updateContactStatus(id, status);
        if (!contact) return jsonError(res, 404, 'Contact not found');
        return jsonResponse(res, 200, { contact, success: true });
      }

      if (req.method === 'DELETE') {
        const deleted = await db.deleteContact(id);
        if (!deleted) return jsonError(res, 404, 'Contact not found');
        return jsonResponse(res, 200, { success: true });
      }
    }

    // -----------------------------------------------------------------
    // POST /api/create-payment-link  (protected – dashboard only)
    //
    // Returns token + formUrl + a self-hosted redirect URL that the
    // customer can visit. The redirect page auto-POSTs the token to
    // Authorize.Net Accept Hosted.
    // -----------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/create-payment-link') {
      if (!authnet.isConfigured()) return jsonError(res, 503, 'Authorize.Net is not configured');
      if (!isAuthorized(req, url)) return jsonError(res, 401, 'Unauthorized');

      const body = await readBody(req);
      const { contactId, amount, description } = validatePaymentInput(body);

      const contact = await db.getContactById(contactId);
      if (!contact) return jsonError(res, 404, 'Contact not found');

      const result = await authnet.createHostedPaymentPage({
        amount,
        description,
        contact,
        returnUrl: RETURN_URL,
      });

      // Persist payment record
      const payment = await db.createPayment({
        contactId,
        invoiceNumber: authnet.generateInvoiceNumber(),
        amount,
        description,
        token: result.token,
      });

      // Build a self-hosted URL that auto-redirects via POST form
      const paymentPageUrl = `${RETURN_URL}/pay/${result.token}`;

      return jsonResponse(res, 200, {
        success: true,
        paymentPageUrl,
        token: result.token,
        formUrl: result.formUrl,
        paymentId: payment.id,
      });
    }

    // -----------------------------------------------------------------
    // POST /api/send-payment  (protected – create link + email)
    // -----------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/send-payment') {
      if (!authnet.isConfigured()) return jsonError(res, 503, 'Authorize.Net is not configured');
      if (!mailTransporter) return jsonError(res, 503, 'Email (SMTP) is not configured');
      if (!isAuthorized(req, url)) return jsonError(res, 401, 'Unauthorized');

      const body = await readBody(req);
      const { contactId, amount, description } = validatePaymentInput(body);

      const contact = await db.getContactById(contactId);
      if (!contact) return jsonError(res, 404, 'Contact not found');
      if (!contact.email) return jsonError(res, 400, 'Contact has no email address');

      const result = await authnet.createHostedPaymentPage({
        amount,
        description,
        contact,
        returnUrl: RETURN_URL,
      });

      // Persist payment record
      const payment = await db.createPayment({
        contactId,
        invoiceNumber: authnet.generateInvoiceNumber(),
        amount,
        description,
        token: result.token,
      });

      const paymentPageUrl = `${RETURN_URL}/pay/${result.token}`;

      // Send branded email
      await mailTransporter.sendMail({
        from: `"Kingship" <${process.env.SMTP_FROM}>`,
        to: contact.email,
        subject: 'Your Payment Link - Kingship',
        html: buildPaymentEmail(contact, amount, description, paymentPageUrl),
      });

      console.log(`[payment] Email sent to ${contact.email} for $${amount} (payment #${payment.id})`);

      return jsonResponse(res, 200, {
        success: true,
        paymentPageUrl,
        token: result.token,
        formUrl: result.formUrl,
        paymentId: payment.id,
      });
    }

    // -----------------------------------------------------------------
    // GET /pay/:token  – Serve auto-POST redirect page
    //
    // When a customer clicks the payment link (from email or copied),
    // this page auto-submits a hidden form that POSTs the token to
    // Authorize.Net's Accept Hosted page.
    // -----------------------------------------------------------------
    const payMatch = pathname.match(/^\/pay\/(.+)$/);
    if (req.method === 'GET' && payMatch) {
      const token = payMatch[1];
      if (!token || token.length < 10) {
        return htmlResponse(res, 400, 'Invalid payment token');
      }
      const html = buildPaymentRedirectPage(token, authnet.getFormUrl());
      return htmlResponse(res, 200, html);
    }

    // -----------------------------------------------------------------
    // POST /api/payment-webhook  – Authorize.Net webhook receiver
    //
    // Authorize.Net sends webhooks for events like:
    //   net.authorize.payment.authcapture.created
    //   net.authorize.payment.capture.created
    //   net.authorize.payment.void.created
    //   net.authorize.payment.refund.created
    //
    // Configure webhooks in Authorize.Net dashboard:
    //   https://developer.authorize.net/api/reference/features/webhooks.html
    // -----------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/payment-webhook') {
      const rawBody = await readBody(req);
      const signature = req.headers['x-anet-signature'] || '';

      // Verify signature if AUTHNET_SIGNATURE_KEY is configured
      if (!authnet.verifyWebhookSignature(rawBody, signature)) {
        console.error('[webhook] Invalid signature – rejecting');
        return jsonError(res, 401, 'Invalid webhook signature');
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return jsonError(res, 400, 'Invalid JSON payload');
      }

      const eventType = payload.eventType || '';
      const webhookId = payload.notificationId || '';
      const transactionId = payload.payload && payload.payload.id ? String(payload.payload.id) : null;
      const authCode = payload.payload && payload.payload.authCode ? payload.payload.authCode : null;

      console.log(`[webhook] Received: ${eventType} | txn: ${transactionId} | id: ${webhookId}`);

      // Map Authorize.Net event types to our payment statuses
      let paymentStatus = 'unknown';
      if (eventType.includes('authcapture.created') || eventType.includes('capture.created')) {
        paymentStatus = 'completed';
      } else if (eventType.includes('void.created')) {
        paymentStatus = 'voided';
      } else if (eventType.includes('refund.created')) {
        paymentStatus = 'refunded';
      } else if (eventType.includes('declined')) {
        paymentStatus = 'declined';
      } else if (eventType.includes('error') || eventType.includes('fraud')) {
        paymentStatus = 'failed';
      }

      // Update payment record in database
      if (transactionId) {
        try {
          const updated = await db.updatePaymentByTransaction({
            transactionId,
            authCode,
            status: paymentStatus,
            authnetResponse: payload,
          });

          if (updated) {
            console.log(`[webhook] Payment #${updated.id} updated -> ${paymentStatus}`);

            // If payment completed, update the contact status too
            if (paymentStatus === 'completed' && updated.contactId) {
              await db.updateContactStatus(updated.contactId, 'completed');
              console.log(`[webhook] Contact #${updated.contactId} marked completed`);
            }
          } else {
            console.warn(`[webhook] No matching payment found for txn: ${transactionId}`);
          }
        } catch (err) {
          console.error('[webhook] DB update failed:', err.message);
        }
      }

      // Always return 200 to Authorize.Net to acknowledge receipt
      return jsonResponse(res, 200, { success: true, received: eventType });
    }

    // -----------------------------------------------------------------
    // RentSyst Integration – Vehicle Availability
    // -----------------------------------------------------------------

    // GET /api/rentsyst/vehicles – list all fleet vehicles (raw)
    if (req.method === 'GET' && pathname === '/api/rentsyst/vehicles') {
      if (!rentsyst.isConfigured()) return jsonError(res, 503, 'RentSyst is not configured');
      const data = await rentsyst.getVehicles();
      return jsonResponse(res, 200, { success: true, data });
    }

    // GET /api/rentsyst/availability?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
    // Returns fleet vehicles annotated with availability for the date range
    if (req.method === 'GET' && pathname === '/api/rentsyst/availability') {
      if (!rentsyst.isConfigured()) return jsonError(res, 503, 'RentSyst is not configured');

      const start_date = url.searchParams.get('start_date');
      const end_date = url.searchParams.get('end_date');
      if (!start_date || !end_date) {
        return jsonError(res, 400, 'start_date and end_date are required (YYYY-MM-DD)');
      }

      const data = await rentsyst.checkAvailability(start_date, end_date);
      return jsonResponse(res, 200, { success: true, data });
    }

    // GET /api/rentsyst/busy-dates?vehicle_id=...&start_date=...&end_date=...
    if (req.method === 'GET' && pathname === '/api/rentsyst/busy-dates') {
      if (!rentsyst.isConfigured()) return jsonError(res, 503, 'RentSyst is not configured');

      const params = {};
      const vehicle_id = url.searchParams.get('vehicle_id');
      const start_date = url.searchParams.get('start_date');
      const end_date = url.searchParams.get('end_date');
      if (vehicle_id) params.vehicle_id = vehicle_id;
      if (start_date) params.start_date = start_date;
      if (end_date) params.end_date = end_date;

      const data = await rentsyst.getBusyDates(params);
      return jsonResponse(res, 200, { success: true, data });
    }

    // GET /api/rentsyst/settings – company settings
    if (req.method === 'GET' && pathname === '/api/rentsyst/settings') {
      if (!rentsyst.isConfigured()) return jsonError(res, 503, 'RentSyst is not configured');
      const data = await rentsyst.getCompanySettings();
      return jsonResponse(res, 200, { success: true, data });
    }

  } catch (err) {
    // Structured error handling for validation errors thrown by validatePaymentInput
    if (err.status) {
      return jsonError(res, err.status, err.message);
    }
    // Authorize.Net API errors bubble up with .code
    if (err.code && err.raw) {
      console.error(`[authnet] API error (${err.code}): ${err.message}`);
      return jsonError(res, 502, 'Payment gateway error: ' + err.message, { code: err.code });
    }
    // RentSyst API errors
    if (err.message && err.message.startsWith('RentSyst')) {
      console.error(`[rentsyst] ${err.message}`);
      const status = err.status === 429 ? 429 : (err.status || 502);
      return jsonError(res, status, err.status === 429
        ? 'Vehicle availability data is temporarily unavailable. Please try again in a few minutes.'
        : err.message);
    }
    // JSON parse errors
    if (err instanceof SyntaxError) {
      return jsonError(res, 400, 'Invalid JSON in request body');
    }
    console.error('[server] Unhandled API error:', err);
    return jsonError(res, 500, 'Internal server error');
  }

  // ===================================================================
  // STATIC FILE SERVING
  // ===================================================================

  // Route aliases
  if (pathname === '/dashboard') pathname = '/dashboard.html';
  if (pathname === '/') pathname = '/index.html';

  // Resolve and secure file path
  let filePath = path.join(BASE_DIR, pathname.replace(/^\//, ''));
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Compressible MIME types for gzip
  const compressible = ['.html', '.css', '.js', '.json', '.svg', '.xml'];

  /**
   * Send a static file with gzip compression (for text) and cache headers.
   * Images/fonts get long cache (7 days), HTML gets short cache (10 min).
   */
  function sendFile(res, statusCode, data, type) {
    const fileExt = ext || '.html';
    const isText = compressible.includes(fileExt);

    // Cache headers: images/fonts 7 days, CSS/JS 1 day, HTML 10 min
    let cacheControl = 'public, max-age=600'; // HTML default: 10 min
    if (['.css', '.js'].includes(fileExt)) cacheControl = 'public, max-age=86400'; // 1 day
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(fileExt)) {
      cacheControl = 'public, max-age=604800'; // 7 days
    }

    const headers = { 'Content-Type': type, 'Cache-Control': cacheControl };

    // Gzip compress text content if client supports it
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (isText && acceptEncoding.includes('gzip') && data.length > 1024) {
      zlib.gzip(data, (err, compressed) => {
        if (err || !compressed) {
          res.writeHead(statusCode, headers);
          res.end(data);
          return;
        }
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
        res.writeHead(statusCode, headers);
        res.end(compressed);
      });
      return;
    }

    res.writeHead(statusCode, headers);
    res.end(data);
  }

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // Try adding .html extension
      if (!ext && !pathname.endsWith('/')) {
        const htmlPath = filePath + '.html';
        fs.access(htmlPath, fs.constants.F_OK, (htmlErr) => {
          if (!htmlErr) {
            fs.readFile(htmlPath, (readErr, data) => {
              if (!readErr) return sendFile(res, 200, data, 'text/html');
              handleFallbacks();
            });
          } else {
            handleFallbacks();
          }
        });
        return;
      }
      handleFallbacks();
      return;
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading file');
        return;
      }
      sendFile(res, 200, data, contentType);
    });
  });

  function handleFallbacks() {
    if (ext === '.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end('// Missing file: ' + pathname + '\n');
      return;
    }

    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
      const fileName = path.basename(filePath);
      const rootFilePath = path.join(BASE_DIR, fileName);
      fs.access(rootFilePath, fs.constants.F_OK, (fallbackErr) => {
        if (!fallbackErr) {
          fs.readFile(rootFilePath, (readErr, data) => {
            if (!readErr) return sendFile(res, 200, data, contentType);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found: ' + pathname);
          });
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found: ' + pathname);
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found: ' + pathname);
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

db.initDB()
  .then(() => {
    // Warm RentSyst fleet cache on startup (non-blocking)
    rentsyst.warmCache();

    server.listen(PORT, () => {
      console.log(`\nServer running at http://localhost:${PORT}/`);
      console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
      console.log(`API: http://localhost:${PORT}/api/contacts`);
      console.log(`Payment webhook: http://localhost:${PORT}/api/payment-webhook`);
      console.log(`Authorize.Net: ${authnet.isConfigured() ? 'configured' : 'NOT configured'} (${authnet.isProduction() ? 'PRODUCTION' : 'SANDBOX'})`);
      console.log(`SMTP: ${mailTransporter ? 'configured' : 'NOT configured'}`);
      console.log(`RentSyst: ${rentsyst.isConfigured() ? 'configured' : 'NOT configured'}`);
      console.log(`Auth: ${API_KEY ? 'API key set' : 'NO API key (dev mode – all requests allowed)'}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    console.log('\nStarting server without database...');
    server.listen(PORT, () => {
      console.log(`\nServer running at http://localhost:${PORT}/`);
      console.log('WARNING: Database is not connected. API endpoints will not work.\n');
    });
  });
