/**
 * Zoho Invoice API client for the dashboard.
 *
 * Adapted from /Zoho-Plug/index.js OAuth pattern (ESM version).
 * Reads local quote_reference_db.json for fast data access.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── OAuth token management ──────────────────────────────────────────────────

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_TOKEN_URL = process.env.ZOHO_TOKEN_URL || 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_API_BASE = process.env.ZOHO_API_BASE || 'https://www.zohoapis.eu/invoice/v3';

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) {
    return accessToken;
  }
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho credentials not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN in .env');
  }
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ZOHO_TOKEN_URL}?${params}`, { method: 'POST' });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Zoho token refresh failed: ${data.error}`);
  }
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return accessToken;
}

// ── Organization ID ─────────────────────────────────────────────────────────

let organizationId = null;

async function getOrganizationId() {
  if (organizationId) return organizationId;
  const token = await getAccessToken();
  const res = await fetch(`${ZOHO_API_BASE}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const data = await res.json();
  if (!data.organizations || data.organizations.length === 0) {
    throw new Error('No Zoho Invoice organizations found');
  }
  organizationId = data.organizations[0].organization_id;
  return organizationId;
}

// ── Generic API caller ──────────────────────────────────────────────────────

async function zohoRequest(method, path, body) {
  const token = await getAccessToken();
  const orgId = await getOrganizationId();
  const url = `${ZOHO_API_BASE}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      'X-com-zoho-invoice-organizationid': orgId,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

// ── Query string helper ─────────────────────────────────────────────────────

function buildQs(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ── Report cache (10-min TTL) ───────────────────────────────────────────────

const reportCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function getCached(key) {
  const entry = reportCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  reportCache.set(key, { data, ts: Date.now() });
}

// ── Public API functions ────────────────────────────────────────────────────

export async function getReport(reportName, { from_date, to_date } = {}) {
  const cacheKey = `report:${reportName}:${from_date}:${to_date}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const qs = buildQs({ from_date, to_date });
  const data = await zohoRequest('GET', `/reports/${reportName}${qs}`);
  setCache(cacheKey, data);
  return data;
}

export async function listEstimates({ page = 1, per_page = 200, status, customer_id, date_start, date_end, search_text } = {}) {
  const qs = buildQs({ page, per_page, status, customer_id, date_start, date_end, search_text });
  return zohoRequest('GET', `/estimates${qs}`);
}

export async function listSalespersons() {
  const cacheKey = 'salespersons';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await zohoRequest('GET', '/salespersons');
  setCache(cacheKey, data);
  return data;
}

export async function listContacts({ page = 1, per_page = 200, search_text } = {}) {
  const qs = buildQs({ page, per_page, search_text });
  return zohoRequest('GET', `/contacts${qs}`);
}

// ── Local quote reference DB ────────────────────────────────────────────────

const QUOTE_DB_PATH = process.env.QUOTE_DB_PATH || join(__dirname, '../../Zoho-Plug/quote_reference_db.json');

let quoteDb = null;

export function loadQuoteDb() {
  if (quoteDb) return quoteDb;
  try {
    const text = readFileSync(QUOTE_DB_PATH, 'utf-8');
    quoteDb = JSON.parse(text);
  } catch (err) {
    console.warn(`[zoho-api] Could not read ${QUOTE_DB_PATH}: ${err.message}`);
    quoteDb = [];
  }
  return quoteDb;
}

export function reloadQuoteDb() {
  quoteDb = null;
  return loadQuoteDb();
}

export function isConfigured() {
  return !!(ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET && ZOHO_REFRESH_TOKEN);
}
