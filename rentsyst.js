/**
 * RentSyst API client module.
 *
 * Handles OAuth2 authentication, vehicle availability checks,
 * vehicle/location listing, and busy-date retrieval.
 *
 * Base URL: https://api.rentsyst.com/v1  (production)
 *           https://api-dev.rentsyst.com/v1  (dev/sandbox)
 *
 * Auth: OAuth2 client_credentials → accessToken query param
 */

const https = require('https');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getBaseUrl() {
  return process.env.RENTSYST_ENVIRONMENT === 'production'
    ? 'https://api.rentsyst.com/v1'
    : 'https://api-dev.rentsyst.com/v1';
}

function isConfigured() {
  return !!(process.env.RENTSYST_CLIENT_ID && process.env.RENTSYST_CLIENT_SECRET);
}

// ---------------------------------------------------------------------------
// Token cache (auto-refresh before expiry)
// ---------------------------------------------------------------------------

let tokenCache = {
  accessToken: null,
  expiresAt: 0, // unix ms
};

// ---------------------------------------------------------------------------
// Low-level HTTPS helper
// ---------------------------------------------------------------------------

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isPost = method === 'POST';
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Accept': 'application/json',
        ...(isPost && data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {}),
      },
    };

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (chunk) => (chunks += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          if (res.statusCode >= 400) {
            const err = new Error(parsed.message || parsed.error || `RentSyst API error (${res.statusCode})`);
            err.status = res.statusCode;
            err.body = parsed;
            return reject(err);
          }
          resolve(parsed);
        } catch {
          if (res.statusCode >= 400) {
            return reject(new Error(`RentSyst API error (${res.statusCode}): ${chunks.substring(0, 200)}`));
          }
          resolve(chunks);
        }
      });
    });

    req.on('error', (err) => reject(new Error('RentSyst network error: ' + err.message)));
    if (data) req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// OAuth2 token management
// ---------------------------------------------------------------------------

async function getAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  const tokenUrl = getBaseUrl() + '/oauth2/token';

  const result = await request('POST', tokenUrl, {
    grant_type: 'client_credentials',
    client_id: process.env.RENTSYST_CLIENT_ID,
    client_secret: process.env.RENTSYST_CLIENT_SECRET,
  });

  if (!result.access_token) {
    throw new Error('RentSyst auth failed: no access_token in response');
  }

  tokenCache = {
    accessToken: result.access_token,
    expiresAt: Date.now() + (result.expires_in || 3600) * 1000,
  };

  console.log('[rentsyst] Token acquired, expires in', result.expires_in || 3600, 's');
  return tokenCache.accessToken;
}

// ---------------------------------------------------------------------------
// Authenticated API call helper
// ---------------------------------------------------------------------------

async function apiGet(endpoint, params) {
  const token = await getAccessToken();
  const url = new URL(getBaseUrl() + endpoint);
  url.searchParams.set('accessToken', token);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }
  return request('GET', url.toString());
}

async function apiPost(endpoint, body) {
  const token = await getAccessToken();
  const url = new URL(getBaseUrl() + endpoint);
  url.searchParams.set('accessToken', token);
  return request('POST', url.toString(), body);
}

// ---------------------------------------------------------------------------
// Public API methods
// ---------------------------------------------------------------------------

/**
 * Get all vehicles in the fleet.
 * GET /vehicle/index
 */
async function getVehicles() {
  return apiGet('/vehicle/index');
}

/**
 * Get company locations with available vehicles.
 * GET /company/location/vehicle
 */
async function getLocations() {
  return apiGet('/company/location/vehicle');
}

/**
 * Get company settings (currency, timezone, etc.).
 * GET /company/settings
 */
async function getCompanySettings() {
  return apiGet('/company/settings');
}

/**
 * Search for available vehicles.
 * GET /booking/search
 *
 * @param {object} params
 * @param {string} params.start_date  - Pickup date (YYYY-MM-DD or YYYY-MM-DD HH:mm)
 * @param {string} params.end_date    - Return date (YYYY-MM-DD or YYYY-MM-DD HH:mm)
 * @param {number} [params.location_id] - Pickup location ID
 * @param {number} [params.return_location_id] - Return location ID
 * @param {number} [params.vehicle_id] - Specific vehicle ID to check
 * @param {number} [params.category_id] - Vehicle category/type ID
 */
async function searchAvailability(params) {
  if (!params.start_date || !params.end_date) {
    throw new Error('start_date and end_date are required');
  }
  return apiGet('/booking/search', params);
}

/**
 * Get busy/unavailable dates for a vehicle or location.
 * GET /booking/busy-dates
 *
 * @param {object} params
 * @param {number} [params.vehicle_id]  - Vehicle ID
 * @param {number} [params.location_id] - Location ID
 * @param {string} [params.start_date]  - Range start (YYYY-MM-DD)
 * @param {string} [params.end_date]    - Range end (YYYY-MM-DD)
 */
async function getBusyDates(params) {
  return apiGet('/booking/busy-dates', params);
}

/**
 * Get work times for locations.
 * GET /company/locations/
 */
async function getWorkTimes() {
  return apiGet('/company/locations/');
}

module.exports = {
  isConfigured,
  getBaseUrl,
  getVehicles,
  getLocations,
  getCompanySettings,
  searchAvailability,
  getBusyDates,
  getWorkTimes,
};
