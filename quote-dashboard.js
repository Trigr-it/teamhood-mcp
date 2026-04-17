/**
 * Node Group Portal — Multi-page web UI.
 *
 * Usage:
 *   node --env-file=.env quote-dashboard.js
 *
 * Pages:
 *   /           — Landing page with navigation tiles
 *   /pricing    — Teamhood "Price Required" cards → Zoho estimates
 *   /live       — Browse all quotes from the reference database
 *   /dashboard  — Financial dashboard with charts and KPIs
 *
 * API:
 *   GET  /api/quotes              — Price-required cards (existing)
 *   GET  /api/quotes/:cardId      — Single card detail (existing)
 *   POST /api/quotes/:cardId/approve — Approve quote (existing)
 *   GET  /api/live/estimates      — Filtered estimates from local DB
 *   GET  /api/dashboard/summary   — All dashboard data in one call
 */

import express from 'express';
import { handleQuoteTool } from './src/tools/quotes.js';
import * as api from './src/teamhood-api.js';
import { lookupClient } from './src/utils/client-lookup.js';
import { parseCardTitle } from './src/utils/title-parser.js';
import { findSimilarQuotes } from './src/utils/quote-matcher.js';
import * as zoho from './src/zoho-api.js';

const app = express();
app.use(express.json());

const DASH_PORT = process.env.DASH_PORT || 3456;

// ---------------------------------------------------------------------------
// Existing API endpoints (unchanged)
// ---------------------------------------------------------------------------

app.get('/api/quotes', async (_req, res) => {
  try {
    const cards = await handleQuoteTool('list_price_required', {});
    res.json({ success: true, quotes: cards });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/quotes/:cardId', async (req, res) => {
  try {
    const data = await handleQuoteTool('prepare_quote_data', { card_id: req.params.cardId });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/quotes/:cardId/approve', async (req, res) => {
  try {
    const { cardId } = req.params;
    const { rate, quantity, customerName, lineItemName, lineItemDescription } = req.body;

    const card = await api.getCard(cardId);
    if (!card) throw new Error(`Card not found: ${cardId}`);

    const parsed = parseCardTitle(card.title);
    const client = lookupClient(parsed.clientCode);
    const zohoCustomerName = customerName || client?.customerName;

    if (!zohoCustomerName) {
      throw new Error(`No Zoho customer mapped for client code "${parsed.clientCode}". Add it to client-identifiers.txt.`);
    }

    const quoteData = {
      zohoCustomerName,
      estimateData: {
        reference_number: card.displayId,
        notes: [
          `Scope: ${parsed.scope || ''}`,
          card.url ? `Teamhood: ${card.url}` : '',
        ].filter(Boolean).join('\n'),
        line_items: [{
          name: lineItemName || '- Design & Analysis (UK)',
          description: lineItemDescription || `${parsed.scope || card.title}\n${parsed.siteName || ''} - ${card.displayId}`,
          quantity: quantity || 1,
          rate: rate || 0,
        }],
      },
    };

    let tagRemoved = false;
    try {
      await api.removeTag(cardId, 'Price Required');
      tagRemoved = true;
    } catch (tagErr) {
      console.warn(`[approve] Could not remove tag from ${card.displayId}: ${tagErr.message}`);
    }

    res.json({
      success: true,
      message: tagRemoved
        ? `Approved. Tag removed from ${card.displayId}.`
        : `Approved. Note: could not remove "Price Required" tag automatically — please remove it manually in Teamhood.`,
      tagRemoved,
      cardId,
      displayId: card.displayId,
      quoteData,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// New API endpoints
// ---------------------------------------------------------------------------

// Live estimates from local quote reference DB
app.get('/api/live/estimates', async (_req, res) => {
  try {
    const { status, client, salesperson, date_start, date_end, search } = _req.query;
    let estimates = zoho.loadQuoteDb();

    if (status) estimates = estimates.filter(e => e.status === status);
    if (client) estimates = estimates.filter(e => e.client === client);
    if (salesperson) estimates = estimates.filter(e => e.salesperson === salesperson);
    if (date_start) estimates = estimates.filter(e => e.date >= date_start);
    if (date_end) estimates = estimates.filter(e => e.date <= date_end);
    if (search) {
      const s = search.toLowerCase();
      estimates = estimates.filter(e =>
        (e.estimate_number || '').toLowerCase().includes(s) ||
        (e.client || '').toLowerCase().includes(s) ||
        (e.project || '').toLowerCase().includes(s) ||
        (e.reference || '').toLowerCase().includes(s) ||
        e.line_items.some(li => (li.description || '').toLowerCase().includes(s))
      );
    }

    res.json({ success: true, estimates, total: estimates.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dashboard summary — all data in one call
app.get('/api/dashboard/summary', async (_req, res) => {
  try {
    const { from_date, to_date, client, salesperson } = _req.query;
    const db = zoho.loadQuoteDb();

    // Apply date filters
    let filtered = db;
    if (from_date) filtered = filtered.filter(e => e.date >= from_date);
    if (to_date) filtered = filtered.filter(e => e.date <= to_date);
    if (client) filtered = filtered.filter(e => e.client === client);
    if (salesperson) filtered = filtered.filter(e => e.salesperson === salesperson);

    // KPIs
    const totalQuotes = filtered.length;
    const invoiced = filtered.filter(e => e.status === 'invoiced');
    const sent = filtered.filter(e => e.status === 'sent');
    const accepted = filtered.filter(e => e.status === 'accepted');
    const totalRevenue = invoiced.reduce((s, e) => s + (e.total || 0), 0);
    const totalSent = sent.reduce((s, e) => s + (e.total || 0), 0);
    const totalAccepted = accepted.reduce((s, e) => s + (e.total || 0), 0);
    const allTotals = filtered.map(e => e.total || 0).filter(t => t > 0);
    const avgQuoteValue = allTotals.length ? Math.round(allTotals.reduce((a, b) => a + b, 0) / allTotals.length) : 0;
    const conversionRate = (sent.length + invoiced.length + accepted.length) > 0
      ? Math.round((invoiced.length / (sent.length + invoiced.length + accepted.length)) * 100)
      : 0;

    // Sales by customer (top 20)
    const byCustomer = {};
    for (const e of filtered) {
      if (!e.client) continue;
      if (!byCustomer[e.client]) byCustomer[e.client] = { client: e.client, total: 0, count: 0 };
      byCustomer[e.client].total += e.total || 0;
      byCustomer[e.client].count++;
    }
    const salesByCustomer = Object.values(byCustomer).sort((a, b) => b.total - a.total).slice(0, 20);

    // Sales by salesperson
    const bySalesperson = {};
    for (const e of filtered) {
      const sp = e.salesperson || 'Unassigned';
      if (!bySalesperson[sp]) bySalesperson[sp] = { salesperson: sp, total: 0, count: 0 };
      bySalesperson[sp].total += e.total || 0;
      bySalesperson[sp].count++;
    }
    const salesBySalesperson = Object.values(bySalesperson).sort((a, b) => b.total - a.total);

    // Monthly breakdown
    const byMonth = {};
    for (const e of filtered) {
      if (!e.date) continue;
      const month = e.date.substring(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = { month, total: 0, count: 0 };
      byMonth[month].total += e.total || 0;
      byMonth[month].count++;
    }
    const monthlySales = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

    // Pipeline by status
    const byStatus = {};
    for (const e of filtered) {
      const st = e.status || 'unknown';
      if (!byStatus[st]) byStatus[st] = { status: st, total: 0, count: 0 };
      byStatus[st].total += e.total || 0;
      byStatus[st].count++;
    }
    const pipeline = Object.values(byStatus);

    // Unique filter options (for dropdown population)
    const clients = [...new Set(db.map(e => e.client).filter(Boolean))].sort();
    const salespersons = [...new Set(db.map(e => e.salesperson).filter(Boolean))].sort();

    res.json({
      success: true,
      kpis: {
        totalQuotes,
        totalRevenue,
        totalSent,
        totalAccepted,
        avgQuoteValue,
        conversionRate,
        outstandingPipeline: totalSent + totalAccepted,
      },
      salesByCustomer,
      salesBySalesperson,
      monthlySales,
      pipeline,
      filterOptions: { clients, salespersons },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Shared page shell
// ---------------------------------------------------------------------------

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f1117'/%3E%3Ctext x='16' y='23' text-anchor='middle' font-family='-apple-system,BlinkMacSystemFont,sans-serif' font-size='22' font-weight='800' fill='%2358a6ff'%3EN%3C/text%3E%3C/svg%3E";

function pageShell(title, activeNav, headExtra, bodyContent) {
  const navItems = [
    { key: 'home', label: 'Home', href: '/' },
    { key: 'pricing', label: 'Pricing', href: '/pricing' },
    { key: 'live', label: 'Live Quotes', href: '/live' },
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  ];
  const navHtml = navItems.map(n =>
    `<a href="${n.href}" class="nav-link${n.key === activeNav ? ' nav-active' : ''}">${n.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Node Group — ${title}</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Header & Nav */
    .site-header { background: #161b22; border-bottom: 1px solid #30363d; padding: 0 24px; display: flex; align-items: center; height: 56px; gap: 20px; }
    .logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .logo:hover { text-decoration: none; }
    .logo-mark { width: 32px; height: 32px; background: #0f1117; border: 2px solid #58a6ff; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 800; color: #58a6ff; }
    .logo-text { font-size: 15px; font-weight: 700; color: #fff; }
    .nav { display: flex; gap: 4px; margin-left: 24px; }
    .nav-link { padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; color: #8b949e; transition: all 0.15s; }
    .nav-link:hover { color: #e1e4e8; background: #1c2128; text-decoration: none; }
    .nav-active { color: #58a6ff; background: rgba(88,166,255,0.1); }

    /* Page content */
    .page { padding: 24px; max-width: 1400px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 4px; color: #fff; }
    .subtitle { color: #8b949e; margin-bottom: 20px; font-size: 14px; }

    /* Stat cards */
    .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 20px; min-width: 140px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #58a6ff; }
    .stat-label { font-size: 12px; color: #8b949e; margin-top: 4px; }

    /* Filters */
    .filters { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
    .filters input, .filters select { background: #161b22; border: 1px solid #30363d; color: #e1e4e8; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
    .filters input[type="text"] { width: 250px; }
    .filters input[type="date"] { width: 160px; }
    .btn { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; }
    .btn:hover { background: #2ea043; }
    .btn-secondary { background: #30363d; }
    .btn-secondary:hover { background: #484f58; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; background: #161b22; border-radius: 8px; overflow: hidden; }
    thead { background: #1c2128; }
    th { text-align: left; padding: 12px 16px; font-size: 12px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #30363d; cursor: default; }
    th.sortable { cursor: pointer; }
    th.sortable:hover { color: #e1e4e8; }
    td { padding: 12px 16px; border-bottom: 1px solid #21262d; font-size: 13px; vertical-align: top; }
    tr:hover { background: #1c2128; }

    /* Badges & tags */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge-draft { background: #30363d; color: #8b949e; }
    .badge-sent { background: #0c2d6b; color: #58a6ff; }
    .badge-accepted { background: #1f3a2e; color: #3fb950; }
    .badge-invoiced { background: #3b2e08; color: #d29922; }
    .badge-declined { background: #3d1117; color: #f85149; }
    .badge-expired { background: #2d1a00; color: #db6d28; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .tag-keywords { background: #1f3a2e; color: #3fb950; }

    /* Common elements */
    .client-code { font-weight: 700; color: #58a6ff; }
    .scope { color: #c9d1d9; max-width: 300px; }
    .rate { font-weight: 700; font-size: 15px; }
    .rate-range { font-size: 11px; color: #8b949e; }
    .match { font-size: 11px; color: #8b949e; }
    .match-score { color: #3fb950; font-weight: 600; }
    .assignee { color: #d2a8ff; font-size: 12px; }
    .unmapped { color: #f85149; font-size: 11px; }
    .btn-approve { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; }
    .btn-approve:hover { background: #2ea043; }
    .btn-approve:disabled { background: #21262d; color: #484f58; cursor: not-allowed; }
    .btn-approve.approved { background: #1f6feb; cursor: default; }
    .rate-input { background: #0d1117; border: 1px solid #30363d; color: #e1e4e8; padding: 4px 8px; border-radius: 4px; width: 80px; font-size: 14px; text-align: right; }
    .loading { text-align: center; padding: 60px; color: #8b949e; font-size: 16px; }
    .error { background: #3d1117; border: 1px solid #f85149; color: #f85149; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
    .success-msg { font-size: 11px; color: #3fb950; margin-top: 4px; }
    .expand-btn { cursor: pointer; color: #58a6ff; font-size: 12px; }
    .detail-row { display: none; }
    .detail-row.open { display: table-row; }
    .detail-cell { background: #0d1117; padding: 16px !important; }
  </style>
  ${headExtra || ''}
</head>
<body>
  <header class="site-header">
    <a href="/" class="logo">
      <div class="logo-mark">N</div>
      <span class="logo-text">Node Group</span>
    </a>
    <nav class="nav">${navHtml}</nav>
  </header>
  <div class="page">
    ${bodyContent}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

function landingPage() {
  return `
    <div style="max-width:960px;margin:60px auto 0;">
      <h1 style="font-size:28px;margin-bottom:8px;">Node Group Portal</h1>
      <p class="subtitle">Scaffold design management tools</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-top:32px;">

        <a href="/pricing" style="text-decoration:none;" class="tile">
          <div class="tile-card">
            <div class="tile-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div class="tile-title">Pricing</div>
            <div class="tile-desc">Review Teamhood cards tagged "Price Required" and approve for Zoho estimates</div>
          </div>
        </a>

        <a href="/live" style="text-decoration:none;" class="tile">
          <div class="tile-card">
            <div class="tile-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div class="tile-title">Live Quotes</div>
            <div class="tile-desc">Browse all estimates with status tracking, client filtering, and search</div>
          </div>
        </a>

        <a href="/dashboard" style="text-decoration:none;" class="tile">
          <div class="tile-card">
            <div class="tile-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <div class="tile-title">Dashboard</div>
            <div class="tile-desc">Financial overview with sales charts, KPIs, and salesperson performance</div>
          </div>
        </a>

      </div>
    </div>
    <style>
      .tile-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 32px; transition: all 0.2s; }
      .tile-card:hover { border-color: #58a6ff; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(88,166,255,0.1); }
      .tile-icon { margin-bottom: 16px; }
      .tile-title { font-size: 18px; font-weight: 600; color: #fff; margin-bottom: 8px; }
      .tile-desc { font-size: 13px; color: #8b949e; line-height: 1.5; }
    </style>`;
}

app.get('/', (_req, res) => {
  res.send(pageShell('Home', 'home', '', landingPage()));
});

// ---------------------------------------------------------------------------
// Pricing page (existing quote dashboard)
// ---------------------------------------------------------------------------

function pricingPage() {
  return `
  <h1>Pricing</h1>
  <p class="subtitle">Teamhood "Price Required" cards ready for Zoho estimates</p>

  <div class="stats" id="stats"></div>

  <div class="filters">
    <input type="text" id="search" placeholder="Search cards..." oninput="filterTable()">
    <select id="clientFilter" onchange="filterTable()"><option value="">All clients</option></select>
    <select id="assigneeFilter" onchange="filterTable()"><option value="">All assignees</option></select>
  </div>

  <div id="error"></div>
  <div id="content"><div class="loading">Loading quotes...</div></div>

  <script>
    let allQuotes = [];

    async function loadQuotes() {
      try {
        const res = await fetch('/api/quotes');
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        allQuotes = data.quotes;
        renderStats();
        populateFilters();
        renderTable();
      } catch (err) {
        document.getElementById('error').innerHTML = '<div class="error">' + err.message + '</div>';
        document.getElementById('content').innerHTML = '';
      }
    }

    function renderStats() {
      const total = allQuotes.length;
      const withPrice = allQuotes.filter(q => q.suggestedRate).length;
      const unmapped = allQuotes.filter(q => !q.zohoCustomerName).length;
      const clients = new Set(allQuotes.map(q => q.zohoCustomerName || q.clientCode)).size;
      const totalValue = allQuotes.reduce((sum, q) => sum + (q.suggestedRate?.median || 0), 0);

      document.getElementById('stats').innerHTML =
        '<div class="stat"><div class="stat-value">' + total + '</div><div class="stat-label">Cards to Quote</div></div>' +
        '<div class="stat"><div class="stat-value">' + withPrice + '</div><div class="stat-label">With Pricing</div></div>' +
        '<div class="stat"><div class="stat-value">' + clients + '</div><div class="stat-label">Clients</div></div>' +
        '<div class="stat"><div class="stat-value">&pound;' + totalValue.toLocaleString() + '</div><div class="stat-label">Est. Total Value</div></div>' +
        (unmapped > 0 ? '<div class="stat"><div class="stat-value" style="color:#f85149">' + unmapped + '</div><div class="stat-label">Unmapped Clients</div></div>' : '');
    }

    function populateFilters() {
      const clients = [...new Set(allQuotes.map(q => q.zohoCustomerName || q.clientCode).filter(Boolean))].sort();
      const assignees = [...new Set(allQuotes.map(q => q.assignedUserName).filter(Boolean))].sort();
      const cf = document.getElementById('clientFilter');
      const af = document.getElementById('assigneeFilter');
      clients.forEach(c => { const o = document.createElement('option'); o.value = c; o.text = c; cf.add(o); });
      assignees.forEach(a => { const o = document.createElement('option'); o.value = a; o.text = a; af.add(o); });
    }

    function filterTable() {
      const search = document.getElementById('search').value.toLowerCase();
      const client = document.getElementById('clientFilter').value;
      const assignee = document.getElementById('assigneeFilter').value;
      document.querySelectorAll('.quote-row, .detail-row').forEach(row => {
        const q = allQuotes.find(q => q.id === row.dataset.id);
        if (!q) return;
        const matchSearch = !search || (q.title + ' ' + q.scope + ' ' + q.displayId + ' ' + (q.zohoCustomerName || '')).toLowerCase().includes(search);
        const matchClient = !client || (q.zohoCustomerName || q.clientCode) === client;
        const matchAssignee = !assignee || q.assignedUserName === assignee;
        const visible = matchSearch && matchClient && matchAssignee;
        row.style.display = visible ? '' : 'none';
        const detailRow = document.querySelector('.detail-row[data-id="' + q.id + '"]');
        if (detailRow && !visible) detailRow.classList.remove('open');
      });
    }

    function toggleDetail(id) {
      const row = document.querySelector('.detail-row[data-id="' + id + '"]');
      if (row) row.classList.toggle('open');
    }

    async function approveQuote(id, btn) {
      const q = allQuotes.find(q => q.id === id);
      if (!q) return;

      const rateInput = document.getElementById('rate-' + id);
      const rate = parseFloat(rateInput?.value) || 0;

      if (rate <= 0) {
        alert('Please enter a rate before approving.');
        return;
      }

      if (!q.zohoCustomerName) {
        alert('Cannot approve — client code "' + q.clientCode + '" is not mapped in client-identifiers.txt');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        const res = await fetch('/api/quotes/' + id + '/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rate,
            quantity: 1,
            customerName: q.zohoCustomerName,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        btn.textContent = 'Approved';
        btn.classList.add('approved');

        const msgEl = document.createElement('div');
        msgEl.className = 'success-msg';
        msgEl.textContent = data.tagRemoved
          ? 'Done! Tag removed, quote ready for Zoho.'
          : 'Approved. Remove "Price Required" tag manually in Teamhood.';
        btn.parentElement.appendChild(msgEl);

      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Approve';
        alert('Error: ' + err.message);
      }
    }

    function renderTable() {
      let html = '<table><thead><tr>' +
        '<th></th><th>Card</th><th>Client</th><th>Site</th><th>Scope</th><th>Assignee</th>' +
        '<th>Keywords</th><th>Suggested Rate</th><th>Top Match</th><th>Rate</th><th></th>' +
        '</tr></thead><tbody>';

      for (const q of allQuotes) {
        const rate = q.suggestedRate;
        const rateDisplay = rate ? '&pound;' + rate.median : '-';
        const rangeDisplay = rate ? '&pound;' + rate.min + ' - &pound;' + rate.max : '';
        const match = q.topMatch;
        const matchDisplay = match ? match.estimateNumber + ' (&pound;' + match.total + ')' : '-';
        const matchScoreDisplay = match ? '<span class="match-score">' + match.matchScore + '</span>' : '';
        const kwDisplay = (q.matchedKeywords || []).map(k => '<span class="tag tag-keywords">' + k + '</span>').join(' ');
        const clientDisplay = q.zohoCustomerName
          ? '<span class="client-code">' + q.clientCode + '</span> ' + q.zohoCustomerName
          : '<span class="client-code">' + (q.clientCode || '?') + '</span> <span class="unmapped">unmapped</span>';
        const defaultRate = rate?.median || 0;

        html += '<tr class="quote-row" data-id="' + q.id + '">' +
          '<td><span class="expand-btn" onclick="toggleDetail(\\'' + q.id + '\\')">details</span></td>' +
          '<td><a href="' + (q.url || '#') + '" target="_blank">' + (q.displayId || '') + '</a></td>' +
          '<td>' + clientDisplay + '</td>' +
          '<td>' + (q.siteName || '-') + '</td>' +
          '<td class="scope">' + (q.scope || '-') + '</td>' +
          '<td class="assignee">' + (q.assignedUserName || '-') + '</td>' +
          '<td>' + kwDisplay + '</td>' +
          '<td><span class="rate">' + rateDisplay + '</span><br><span class="rate-range">' + rangeDisplay + '</span></td>' +
          '<td class="match">' + matchDisplay + '<br>' + matchScoreDisplay + '</td>' +
          '<td><input type="number" class="rate-input" id="rate-' + q.id + '" value="' + defaultRate + '" min="0" step="25"></td>' +
          '<td><button class="btn-approve" onclick="approveQuote(\\'' + q.id + '\\', this)">Approve</button></td>' +
          '</tr>';

        html += '<tr class="detail-row" data-id="' + q.id + '"><td colspan="11" class="detail-cell">';
        html += '<strong>Custom Fields:</strong> ' + (q.customFields || []).map(cf => cf.name + ': ' + cf.value).join(' | ');
        if (q.topMatch?.reference) {
          html += '<br><strong>Top Match Reference:</strong> ' + q.topMatch.reference;
        }
        html += '</td></tr>';
      }

      html += '</tbody></table>';
      document.getElementById('content').innerHTML = html;
    }

    loadQuotes();
  </script>`;
}

app.get('/pricing', (_req, res) => {
  res.send(pageShell('Pricing', 'pricing', '', pricingPage()));
});

// ---------------------------------------------------------------------------
// Live Quotes page
// ---------------------------------------------------------------------------

function liveQuotesPage() {
  return `
  <h1>Live Quotes</h1>
  <p class="subtitle">All estimates from the quote reference database</p>

  <div class="stats" id="live-stats"></div>

  <div class="filters">
    <input type="text" id="liveSearch" placeholder="Search quotes..." oninput="applyFilters()">
    <select id="statusFilter" onchange="applyFilters()">
      <option value="">All statuses</option>
      <option value="draft">Draft</option>
      <option value="sent">Sent</option>
      <option value="accepted">Accepted</option>
      <option value="invoiced">Invoiced</option>
      <option value="declined">Declined</option>
      <option value="expired">Expired</option>
    </select>
    <select id="clientFilter" onchange="applyFilters()"><option value="">All clients</option></select>
    <select id="spFilter" onchange="applyFilters()"><option value="">All salespersons</option></select>
    <input type="date" id="dateFrom" onchange="applyFilters()" title="From date">
    <input type="date" id="dateTo" onchange="applyFilters()" title="To date">
    <button class="btn btn-secondary" onclick="resetFilters()">Reset</button>
  </div>

  <div id="error"></div>
  <div id="content"><div class="loading">Loading estimates...</div></div>

  <script>
    let allEstimates = [];
    let filtered = [];

    async function loadEstimates() {
      try {
        const res = await fetch('/api/live/estimates');
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        allEstimates = data.estimates;
        populateFilters();
        applyFilters();
      } catch (err) {
        document.getElementById('error').innerHTML = '<div class="error">' + err.message + '</div>';
        document.getElementById('content').innerHTML = '';
      }
    }

    function populateFilters() {
      const clients = [...new Set(allEstimates.map(e => e.client).filter(Boolean))].sort();
      const sps = [...new Set(allEstimates.map(e => e.salesperson).filter(Boolean))].sort();
      const cf = document.getElementById('clientFilter');
      const sf = document.getElementById('spFilter');
      clients.forEach(c => { const o = document.createElement('option'); o.value = c; o.text = c; cf.add(o); });
      sps.forEach(s => { const o = document.createElement('option'); o.value = s; o.text = s; sf.add(o); });
    }

    function applyFilters() {
      const search = document.getElementById('liveSearch').value.toLowerCase();
      const status = document.getElementById('statusFilter').value;
      const client = document.getElementById('clientFilter').value;
      const sp = document.getElementById('spFilter').value;
      const dateFrom = document.getElementById('dateFrom').value;
      const dateTo = document.getElementById('dateTo').value;

      filtered = allEstimates.filter(e => {
        if (status && e.status !== status) return false;
        if (client && e.client !== client) return false;
        if (sp && e.salesperson !== sp) return false;
        if (dateFrom && e.date < dateFrom) return false;
        if (dateTo && e.date > dateTo) return false;
        if (search) {
          const haystack = [e.estimate_number, e.client, e.project, e.reference,
            ...e.line_items.map(li => li.description || '')].join(' ').toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });

      renderStats();
      renderTable();
    }

    function resetFilters() {
      document.getElementById('liveSearch').value = '';
      document.getElementById('statusFilter').value = '';
      document.getElementById('clientFilter').value = '';
      document.getElementById('spFilter').value = '';
      document.getElementById('dateFrom').value = '';
      document.getElementById('dateTo').value = '';
      applyFilters();
    }

    function renderStats() {
      const total = filtered.length;
      const totalValue = filtered.reduce((s, e) => s + (e.total || 0), 0);
      const statuses = {};
      filtered.forEach(e => { statuses[e.status] = (statuses[e.status] || 0) + 1; });
      const clients = new Set(filtered.map(e => e.client).filter(Boolean)).size;

      document.getElementById('live-stats').innerHTML =
        '<div class="stat"><div class="stat-value">' + total + '</div><div class="stat-label">Estimates</div></div>' +
        '<div class="stat"><div class="stat-value">&pound;' + totalValue.toLocaleString(undefined, {maximumFractionDigits:0}) + '</div><div class="stat-label">Total Value</div></div>' +
        '<div class="stat"><div class="stat-value">' + clients + '</div><div class="stat-label">Clients</div></div>' +
        (statuses.sent ? '<div class="stat"><div class="stat-value" style="color:#58a6ff">' + statuses.sent + '</div><div class="stat-label">Sent</div></div>' : '') +
        (statuses.accepted ? '<div class="stat"><div class="stat-value" style="color:#3fb950">' + statuses.accepted + '</div><div class="stat-label">Accepted</div></div>' : '') +
        (statuses.invoiced ? '<div class="stat"><div class="stat-value" style="color:#d29922">' + statuses.invoiced + '</div><div class="stat-label">Invoiced</div></div>' : '') +
        (statuses.draft ? '<div class="stat"><div class="stat-value" style="color:#8b949e">' + statuses.draft + '</div><div class="stat-label">Draft</div></div>' : '');
    }

    function renderTable() {
      if (filtered.length === 0) {
        document.getElementById('content').innerHTML = '<div class="loading">No estimates match your filters.</div>';
        return;
      }

      let html = '<table><thead><tr>' +
        '<th>Quote #</th><th>Date</th><th>Client</th><th>Project</th><th>Salesperson</th>' +
        '<th>Status</th><th style="text-align:right">Sub Total</th><th style="text-align:right">VAT</th><th style="text-align:right">Total</th>' +
        '</tr></thead><tbody>';

      for (const e of filtered) {
        const badgeClass = 'badge badge-' + (e.status || 'draft');
        html += '<tr>' +
          '<td><strong>' + (e.estimate_number || '-') + '</strong></td>' +
          '<td>' + (e.date || '-') + '</td>' +
          '<td>' + (e.client || '-') + '</td>' +
          '<td style="max-width:250px;color:#c9d1d9;">' + (e.project || e.reference || '-') + '</td>' +
          '<td class="assignee">' + (e.salesperson || '-') + '</td>' +
          '<td><span class="' + badgeClass + '">' + (e.status || 'draft') + '</span></td>' +
          '<td style="text-align:right">&pound;' + (e.sub_total || 0).toLocaleString() + '</td>' +
          '<td style="text-align:right">&pound;' + (e.tax_total || 0).toLocaleString() + '</td>' +
          '<td style="text-align:right;font-weight:700">&pound;' + (e.total || 0).toLocaleString() + '</td>' +
          '</tr>';
      }

      html += '</tbody></table>';
      document.getElementById('content').innerHTML = html;
    }

    loadEstimates();
  </script>`;
}

app.get('/live', (_req, res) => {
  res.send(pageShell('Live Quotes', 'live', '', liveQuotesPage()));
});

// ---------------------------------------------------------------------------
// Financial Dashboard page
// ---------------------------------------------------------------------------

function dashboardPage() {
  const chartCdn = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>';
  const body = `
  <h1>Dashboard</h1>
  <p class="subtitle">Financial overview from quote reference data</p>

  <div class="filters" id="dash-filters">
    <input type="date" id="dashFrom" title="From date">
    <input type="date" id="dashTo" title="To date">
    <select id="dashClient"><option value="">All clients</option></select>
    <select id="dashSp"><option value="">All salespersons</option></select>
    <button class="btn" onclick="loadDashboard()">Apply</button>
    <button class="btn btn-secondary" onclick="resetDash()">Reset</button>
  </div>

  <div class="stats" id="dash-kpis"></div>

  <div id="dash-error"></div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;" id="charts-grid">
    <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;">
      <h3 style="font-size:14px;color:#8b949e;margin-bottom:12px;">Sales by Customer (Top 15)</h3>
      <canvas id="chartCustomer"></canvas>
    </div>
    <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;">
      <h3 style="font-size:14px;color:#8b949e;margin-bottom:12px;">Sales by Salesperson</h3>
      <canvas id="chartSalesperson"></canvas>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
    <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;">
      <h3 style="font-size:14px;color:#8b949e;margin-bottom:12px;">Monthly Revenue</h3>
      <canvas id="chartMonthly"></canvas>
    </div>
    <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;">
      <h3 style="font-size:14px;color:#8b949e;margin-bottom:12px;">Quote Pipeline</h3>
      <canvas id="chartPipeline"></canvas>
    </div>
  </div>

  <h3 style="font-size:14px;color:#8b949e;margin-bottom:12px;">Sales by Customer</h3>
  <div id="customer-table"></div>

  <script>
    // Chart.js dark theme defaults
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#30363d';
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    let charts = {};
    let dashData = null;

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const STATUS_COLORS = {
      draft: '#484f58', sent: '#58a6ff', accepted: '#3fb950',
      invoiced: '#d29922', declined: '#f85149', expired: '#db6d28'
    };
    const SP_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#d2a8ff', '#db6d28'];

    async function loadDashboard() {
      try {
        const params = new URLSearchParams();
        const from = document.getElementById('dashFrom').value;
        const to = document.getElementById('dashTo').value;
        const client = document.getElementById('dashClient').value;
        const sp = document.getElementById('dashSp').value;
        if (from) params.set('from_date', from);
        if (to) params.set('to_date', to);
        if (client) params.set('client', client);
        if (sp) params.set('salesperson', sp);

        const res = await fetch('/api/dashboard/summary?' + params.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        dashData = data;

        renderKpis();
        renderCharts();
        renderCustomerTable();
        populateDashFilters();
      } catch (err) {
        document.getElementById('dash-error').innerHTML = '<div class="error">' + err.message + '</div>';
      }
    }

    function populateDashFilters() {
      if (!dashData?.filterOptions) return;
      const cf = document.getElementById('dashClient');
      const sf = document.getElementById('dashSp');
      // Only populate if empty (first load)
      if (cf.options.length <= 1) {
        dashData.filterOptions.clients.forEach(c => {
          const o = document.createElement('option'); o.value = c; o.text = c; cf.add(o);
        });
      }
      if (sf.options.length <= 1) {
        dashData.filterOptions.salespersons.forEach(s => {
          const o = document.createElement('option'); o.value = s; o.text = s; sf.add(o);
        });
      }
    }

    function resetDash() {
      document.getElementById('dashFrom').value = '';
      document.getElementById('dashTo').value = '';
      document.getElementById('dashClient').value = '';
      document.getElementById('dashSp').value = '';
      loadDashboard();
    }

    function renderKpis() {
      const k = dashData.kpis;
      document.getElementById('dash-kpis').innerHTML =
        '<div class="stat"><div class="stat-value">&pound;' + k.totalRevenue.toLocaleString() + '</div><div class="stat-label">Invoiced Revenue</div></div>' +
        '<div class="stat"><div class="stat-value">' + k.totalQuotes + '</div><div class="stat-label">Total Quotes</div></div>' +
        '<div class="stat"><div class="stat-value" style="color:#3fb950">' + k.conversionRate + '%</div><div class="stat-label">Conversion Rate</div></div>' +
        '<div class="stat"><div class="stat-value">&pound;' + k.avgQuoteValue.toLocaleString() + '</div><div class="stat-label">Avg Quote Value</div></div>' +
        '<div class="stat"><div class="stat-value" style="color:#d29922">&pound;' + k.outstandingPipeline.toLocaleString() + '</div><div class="stat-label">Outstanding Pipeline</div></div>';
    }

    function destroyChart(key) {
      if (charts[key]) { charts[key].destroy(); delete charts[key]; }
    }

    function renderCharts() {
      // Sales by Customer — horizontal bar
      destroyChart('customer');
      const custData = dashData.salesByCustomer.slice(0, 15);
      charts.customer = new Chart(document.getElementById('chartCustomer'), {
        type: 'bar',
        data: {
          labels: custData.map(c => c.client.length > 25 ? c.client.substring(0, 25) + '...' : c.client),
          datasets: [{
            label: 'Total (\\u00a3)',
            data: custData.map(c => c.total),
            backgroundColor: '#58a6ff',
            borderRadius: 4,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { callback: v => '\\u00a3' + v.toLocaleString() }, grid: { color: '#21262d' } },
            y: { grid: { display: false } }
          }
        }
      });

      // Sales by Salesperson — doughnut
      destroyChart('salesperson');
      const spData = dashData.salesBySalesperson;
      charts.salesperson = new Chart(document.getElementById('chartSalesperson'), {
        type: 'doughnut',
        data: {
          labels: spData.map(s => s.salesperson),
          datasets: [{
            data: spData.map(s => s.total),
            backgroundColor: SP_COLORS.slice(0, spData.length),
            borderColor: '#161b22',
            borderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } },
            tooltip: { callbacks: { label: ctx => ctx.label + ': \\u00a3' + ctx.parsed.toLocaleString() } }
          }
        }
      });

      // Monthly Revenue — line with area fill
      destroyChart('monthly');
      const monthData = dashData.monthlySales;
      charts.monthly = new Chart(document.getElementById('chartMonthly'), {
        type: 'line',
        data: {
          labels: monthData.map(m => {
            const parts = m.month.split('-');
            return MONTH_NAMES[parseInt(parts[1], 10) - 1] + ' ' + parts[0].substring(2);
          }),
          datasets: [{
            label: 'Revenue (\\u00a3)',
            data: monthData.map(m => m.total),
            borderColor: '#58a6ff',
            backgroundColor: 'rgba(88,166,255,0.1)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#58a6ff',
          }, {
            label: 'Quote Count',
            data: monthData.map(m => m.count),
            borderColor: '#3fb950',
            backgroundColor: 'transparent',
            borderDash: [4, 4],
            tension: 0.3,
            pointBackgroundColor: '#3fb950',
            yAxisID: 'y1',
          }]
        },
        options: {
          responsive: true,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => ctx.datasetIndex === 0
                  ? 'Revenue: \\u00a3' + ctx.parsed.y.toLocaleString()
                  : 'Quotes: ' + ctx.parsed.y
              }
            }
          },
          scales: {
            y: { ticks: { callback: v => '\\u00a3' + v.toLocaleString() }, grid: { color: '#21262d' } },
            y1: { position: 'right', grid: { display: false }, ticks: { color: '#3fb950' } },
            x: { grid: { color: '#21262d' } }
          }
        }
      });

      // Pipeline — bar by status
      destroyChart('pipeline');
      const pipeData = dashData.pipeline;
      const statusOrder = ['draft', 'sent', 'accepted', 'invoiced', 'declined', 'expired'];
      const orderedPipe = statusOrder.map(s => pipeData.find(p => p.status === s)).filter(Boolean);
      charts.pipeline = new Chart(document.getElementById('chartPipeline'), {
        type: 'bar',
        data: {
          labels: orderedPipe.map(p => p.status.charAt(0).toUpperCase() + p.status.slice(1)),
          datasets: [{
            label: 'Value (\\u00a3)',
            data: orderedPipe.map(p => p.total),
            backgroundColor: orderedPipe.map(p => STATUS_COLORS[p.status] || '#484f58'),
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { ticks: { callback: v => '\\u00a3' + v.toLocaleString() }, grid: { color: '#21262d' } },
            x: { grid: { display: false } }
          }
        }
      });
    }

    function renderCustomerTable() {
      const data = dashData.salesByCustomer;
      let html = '<table><thead><tr>' +
        '<th>Customer</th><th style="text-align:right">Quotes</th><th style="text-align:right">Total Value</th>' +
        '<th style="text-align:right">Avg Value</th></tr></thead><tbody>';
      for (const c of data) {
        const avg = c.count > 0 ? Math.round(c.total / c.count) : 0;
        html += '<tr><td><strong>' + c.client + '</strong></td>' +
          '<td style="text-align:right">' + c.count + '</td>' +
          '<td style="text-align:right;font-weight:700">&pound;' + c.total.toLocaleString() + '</td>' +
          '<td style="text-align:right">&pound;' + avg.toLocaleString() + '</td></tr>';
      }
      html += '</tbody></table>';
      document.getElementById('customer-table').innerHTML = html;
    }

    // Set default date range to current year
    const now = new Date();
    document.getElementById('dashFrom').value = now.getFullYear() + '-01-01';

    loadDashboard();
  </script>
  <style>
    #charts-grid canvas, #charts-grid + div canvas { max-height: 320px; }
    @media (max-width: 900px) {
      #charts-grid, #charts-grid + div { grid-template-columns: 1fr !important; }
    }
  </style>`;

  return body;
}

app.get('/dashboard', (_req, res) => {
  res.send(pageShell('Dashboard', 'dashboard', '<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>', dashboardPage()));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(DASH_PORT, () => {
  console.log('[portal] Running on http://localhost:' + DASH_PORT);
  console.log('[portal] Pages: / /pricing /live /dashboard');
  console.log('[portal] API: /api/quotes /api/live/estimates /api/dashboard/summary');
});
