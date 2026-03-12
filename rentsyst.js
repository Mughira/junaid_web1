/**
 * RentSyst API client module.
 *
 * Handles OAuth2 authentication, vehicle fleet listing, busy-date
 * checks, and combined availability queries.
 *
 * Base URL: https://api.rentsyst.com/v1  (production)
 *           https://api-dev.rentsyst.com/v1  (dev/sandbox)
 *
 * Auth: OAuth2 client_credentials → accessToken query param
 *
 * Availability strategy:
 *   /vehicle/index  → full fleet with photos, pricing, specs
 *   /booking/busy-dates?vehicle_id=X → dates this vehicle is booked
 *   Combined: show fleet, mark each vehicle as available/busy for the
 *   requested date range.
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
  accessToken: '6ded4f139190816a1a583ac6da5bee69c00ad537',
  expiresAt: Date.now() + 24 * 60 * 60 * 1000, // assume valid for 24h initially
};

// ---------------------------------------------------------------------------
// Fleet cache (refreshed every 10 minutes)
// ---------------------------------------------------------------------------

let fleetCache = {
  vehicles: null,
  fetchedAt: 0,
};

const FLEET_CACHE_TTL = 60 * 60 * 1000; // 60 minutes (RentSyst allows only 10 req/hr)

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
        Accept: 'application/json',
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
            const err = new Error(
              parsed.message || parsed.error || `RentSyst API error (${res.statusCode})`
            );
            err.status = res.statusCode;
            err.body = parsed;
            return reject(err);
          }
          resolve(parsed);
        } catch {
          if (res.statusCode >= 400) {
            return reject(
              new Error(`RentSyst API error (${res.statusCode}): ${chunks.substring(0, 200)}`)
            );
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
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  const result = await request('POST', getBaseUrl() + '/oauth2/token', {
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
        url.searchParams.set(key, String(value));
      }
    }
  }
  return request('GET', url.toString());
}

// ---------------------------------------------------------------------------
// Public API methods
// ---------------------------------------------------------------------------

/**
 * Get all vehicles in the fleet (cached for 10 min).
 * GET /vehicle/index
 */
async function getVehicles(forceRefresh) {
  if (!forceRefresh && fleetCache.vehicles && Date.now() - fleetCache.fetchedAt < FLEET_CACHE_TTL) {
    return fleetCache.vehicles;
  }
  try {
    const vehicles = await apiGet('/vehicle/index');
    fleetCache = { vehicles, fetchedAt: Date.now() };
    return vehicles;
  } catch (err) {
    // On 429 rate limit, return stale cache if available
    if (err.status === 429 && fleetCache.vehicles) {
      console.warn('[rentsyst] Rate limited on /vehicle/index, returning stale cache');
      return fleetCache.vehicles;
    }
    throw err;
  }
}

/**
 * Get company settings (currency, locations, date_format, etc.).
 * GET /company/settings
 */
async function getCompanySettings() {
  return apiGet('/company/settings');
}

/**
 * Get busy/unavailable dates for a vehicle.
 * GET /booking/busy-dates
 */
async function getBusyDates(params) {
  return apiGet('/booking/busy-dates', params);
}

// ---------------------------------------------------------------------------
// Availability result cache (keyed by "startDate|endDate", TTL 2 min)
// ---------------------------------------------------------------------------

const availCache = new Map();
const AVAIL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (RentSyst allows only 10 req/hr)

function getAvailCacheKey(startDate, endDate) {
  return startDate + '|' + endDate;
}

/**
 * Check availability for a date range.
 *
 * Strategy:
 *   1. Fetch the full fleet from /vehicle/index (cached 10 min)
 *   2. Make ONE busy-dates call for the date range (no vehicle_id = all vehicles)
 *   3. Cross-reference busy dates with vehicles to mark availability
 *   4. Cache the result for 2 minutes to avoid rate limits
 *
 * @param {string} startDate  - YYYY-MM-DD
 * @param {string} endDate    - YYYY-MM-DD
 * @returns {object} { vehicles: [...], location: {...} }
 */
async function checkAvailability(startDate, endDate) {
  // Check cache first
  const cacheKey = getAvailCacheKey(startDate, endDate);
  const cached = availCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < AVAIL_CACHE_TTL) {
    return cached.data;
  }

  let vehicles;
  try {
    vehicles = await getVehicles();
  } catch (err) {
    // If rate-limited and we have stale availability data, return it
    if (err.status === 429 && cached) {
      console.warn('[rentsyst] Rate limited, returning stale availability cache');
      return cached.data;
    }
    throw err;
  }
  if (!vehicles || vehicles.length === 0) {
    return { vehicles: [], location: null };
  }

  const locationInfo =
    vehicles[0].locations && vehicles[0].locations[0] && vehicles[0].locations[0][0]
      ? vehicles[0].locations[0][0]
      : null;

  // Single API call: get busy dates for ALL vehicles in the date range
  let busyVehicleIds = new Set();
  try {
    const busyResult = await getBusyDates({
      start_date: startDate,
      end_date: endDate,
    });
    // The response may contain an array of dates with vehicle info,
    // or a simple list of dates. Parse both formats.
    if (busyResult.dates && busyResult.dates.length > 0) {
      busyResult.dates.forEach((d) => {
        if (d.vehicle_id) busyVehicleIds.add(String(d.vehicle_id));
        // If the response is just date strings (no vehicle_id),
        // it means ALL vehicles are busy on those dates
        if (typeof d === 'string') {
          vehicles.forEach((v) => busyVehicleIds.add(String(v.id)));
        }
      });
    }
  } catch (err) {
    // On 429 rate limit, return stale cache if available
    if (err.status === 429 && cached) {
      console.warn('[rentsyst] Rate limited on busy-dates, returning stale availability cache');
      return cached.data;
    }
    // If busy-dates fails for other reasons, assume all available (graceful degradation)
    console.warn('[rentsyst] busy-dates check failed, assuming all available:', err.message);
  }

  const results = vehicles
    .filter((v) => v.status === 'active')
    .map((v) => ({
      id: v.id,
      name: [v.brand, v.mark].filter(Boolean).join(' '),
      brand: v.brand,
      model: v.mark,
      group: v.group || '',
      bodyType: v.body_type || '',
      type: v.type || '',
      year: v.year,
      seats: v.number_seats,
      doors: v.number_doors,
      largeBags: v.large_bags,
      smallBags: v.small_bags,
      fuel: v.fuel || '',
      transmission: v.transmission || '',
      color: v.color ? v.color.title : '',
      price: v.min_price || v.price || 0,
      currency: v.currency || '$',
      thumbnail: v.thumbnail || (v.photos && v.photos[0]) || '',
      photos: v.photos || [],
      options: (v.options || []).map((o) => o.title || o.name || o),
      available: !busyVehicleIds.has(String(v.id)),
      status: v.status,
    }));

  const data = {
    vehicles: results,
    location: locationInfo,
    dateRange: { start: startDate, end: endDate },
  };

  // Cache the result
  availCache.set(cacheKey, { data, fetchedAt: Date.now() });

  // Evict old cache entries
  for (const [key, entry] of availCache) {
    if (Date.now() - entry.fetchedAt > AVAIL_CACHE_TTL) availCache.delete(key);
  }

  return data;
}

/**
 * Warm the fleet cache on server startup so the first user request
 * doesn't consume a rate limit slot.
 */
async function warmCache() {
  if (!isConfigured()) return;
  try {
    await getVehicles(true);
    console.log('[rentsyst] Fleet cache warmed:', fleetCache.vehicles?.length || 0, 'vehicles');
  } catch (err) {
    console.warn('[rentsyst] Cache warm failed (non-fatal):', err.message);
  }
}

module.exports = {
  isConfigured,
  getBaseUrl,
  getVehicles,
  getCompanySettings,
  getBusyDates,
  checkAvailability,
  warmCache,
};
