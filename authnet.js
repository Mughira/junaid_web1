/**
 * Authorize.Net Accept Hosted integration module.
 *
 * Handles:
 *  - API requests to Authorize.Net (sandbox + production)
 *  - Hosted payment page token generation
 *  - Webhook signature verification
 */

const https = require('https');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function isProduction() {
  return process.env.AUTHNET_ENVIRONMENT === 'production';
}

function getEndpoint() {
  return isProduction()
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
}

function getFormUrl() {
  return isProduction()
    ? 'https://accept.authorize.net/payment/payment'
    : 'https://test.authorize.net/payment/payment';
}

function isConfigured() {
  return !!(process.env.AUTHNET_API_LOGIN_ID && process.env.AUTHNET_TRANSACTION_KEY);
}

// ---------------------------------------------------------------------------
// Low-level HTTPS POST to Authorize.Net JSON API
// ---------------------------------------------------------------------------

function apiRequest(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const urlObj = new URL(getEndpoint());
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          // Authorize.Net prepends a UTF-8 BOM – strip it
          body = body.replace(/^\uFEFF/, '');
          const parsed = JSON.parse(body);

          // Surface API-level errors immediately
          if (parsed.messages && parsed.messages.resultCode === 'Error') {
            const msg =
              parsed.messages.message && parsed.messages.message[0]
                ? parsed.messages.message[0].text
                : 'Unknown Authorize.Net error';
            const code =
              parsed.messages.message && parsed.messages.message[0]
                ? parsed.messages.message[0].code
                : 'E00001';
            const err = new Error(msg);
            err.code = code;
            err.raw = parsed;
            return reject(err);
          }

          resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid JSON response from Authorize.Net'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error('Network error contacting Authorize.Net: ' + err.message));
    });

    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Merchant authentication object (reused in every request)
// ---------------------------------------------------------------------------

function merchantAuth() {
  return {
    name: process.env.AUTHNET_API_LOGIN_ID,
    transactionKey: process.env.AUTHNET_TRANSACTION_KEY,
  };
}

// ---------------------------------------------------------------------------
// Generate a collision-safe invoice number
// ---------------------------------------------------------------------------

function generateInvoiceNumber() {
  // Authorize.Net invoiceNumber max 20 chars
  // Format: INV-<8 hex chars from UUID> = 12 chars
  return 'INV-' + crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
}

// ---------------------------------------------------------------------------
// Create Accept Hosted payment page token
// ---------------------------------------------------------------------------

async function createHostedPaymentPage({ amount, description, contact, returnUrl }) {
  // Validate amount
  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount <= 0 || parsedAmount > 999999.99) {
    throw new Error('Amount must be between $0.01 and $999,999.99');
  }

  const firstName = (contact.fullName || '').split(' ')[0] || '';
  const lastName = (contact.fullName || '').split(' ').slice(1).join(' ') || '';

  const payload = {
    getHostedPaymentPageRequest: {
      merchantAuthentication: merchantAuth(),
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: parsedAmount.toFixed(2),
        order: {
          invoiceNumber: generateInvoiceNumber(),
          description: (description || 'Kingship Service').substring(0, 255),
        },
        customer: {
          email: contact.email || '',
        },
        billTo: {
          firstName,
          lastName,
          company: contact.company || '',
          phoneNumber: contact.phone || '',
          email: contact.email || '',
        },
      },
      hostedPaymentSettings: {
        setting: [
          {
            settingName: 'hostedPaymentReturnOptions',
            settingValue: JSON.stringify({
              showReceipt: true,
              url: returnUrl + '/payment-success.html',
              urlText: 'Return to Kingship',
              cancelUrl: returnUrl + '/payment-cancel.html',
              cancelUrlText: 'Cancel',
            }),
          },
          {
            settingName: 'hostedPaymentButtonOptions',
            settingValue: JSON.stringify({ text: 'Pay Now' }),
          },
          {
            settingName: 'hostedPaymentStyleOptions',
            settingValue: JSON.stringify({ bgColor: '#0A0A0A' }),
          },
          {
            settingName: 'hostedPaymentPaymentOptions',
            settingValue: JSON.stringify({
              cardCodeRequired: true,
              showCreditCard: true,
              showBankAccount: false,
            }),
          },
          {
            settingName: 'hostedPaymentOrderOptions',
            settingValue: JSON.stringify({
              show: true,
              merchantName: 'Kingship Transportations',
            }),
          },
          {
            settingName: 'hostedPaymentCustomerOptions',
            settingValue: JSON.stringify({
              showEmail: true,
              requiredEmail: true,
              addPaymentProfile: false,
            }),
          },
        ],
      },
    },
  };

  const result = await apiRequest(payload);

  if (!result.token) {
    throw new Error('No token returned from Authorize.Net');
  }

  return {
    token: result.token,
    formUrl: getFormUrl(),
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
//
// Authorize.Net signs webhook payloads with HMAC-SHA512 using the
// Signature Key configured in the merchant dashboard.
// Header: X-ANET-Signature = sha512=<hex digest>
// ---------------------------------------------------------------------------

function verifyWebhookSignature(rawBody, signatureHeader) {
  const signatureKey = process.env.AUTHNET_SIGNATURE_KEY;
  if (!signatureKey) {
    // If no key is configured we cannot verify – log a warning but allow
    console.warn('[authnet] AUTHNET_SIGNATURE_KEY not set – skipping webhook signature verification');
    return true;
  }

  if (!signatureHeader) return false;

  // Header format: "sha512=HEXDIGEST"
  const provided = signatureHeader.replace(/^sha512=/i, '').toUpperCase();
  const computed = crypto
    .createHmac('sha512', signatureKey)
    .update(rawBody)
    .digest('hex')
    .toUpperCase();

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(computed));
}

module.exports = {
  isConfigured,
  isProduction,
  getFormUrl,
  createHostedPaymentPage,
  verifyWebhookSignature,
  generateInvoiceNumber,
};
