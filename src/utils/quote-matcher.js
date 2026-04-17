import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUOTE_DB_PATH = process.env.QUOTE_DB_PATH || join(__dirname, '../../../Zoho-Plug/quote_reference_db.json');

let quoteDb = null;

function loadQuoteDb() {
  if (quoteDb) return quoteDb;
  try {
    const text = readFileSync(QUOTE_DB_PATH, 'utf-8');
    quoteDb = JSON.parse(text);
  } catch (err) {
    console.warn(`[quote-matcher] Could not read ${QUOTE_DB_PATH}: ${err.message}`);
    quoteDb = [];
  }
  return quoteDb;
}

/**
 * Extract scoring keywords from a scope/title string.
 */
const SCOPE_KEYWORDS = [
  'perimeter', 'birdcage', 'gantry', 'cantilever', 'hoist', 'crash deck',
  'lifting', 'stair', 'haki', 'cuplok', 'layher', 'tube and fitting',
  'mcwp', 'loading bay', 'protection fan', 'temporary roof', 'shrink wrap',
  'bridging', 'access scaffold', 'independent', 'protection deck', 'ramp',
  'cat iii', 'cat 3', 'niko', 'maber', 'stros',
];

function extractKeywords(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return SCOPE_KEYWORDS.filter(kw => lower.includes(kw));
}

/**
 * Score how similar a past quote is to a given scope.
 * Returns 0-1 (1 = perfect match).
 */
function scoreMatch(scopeKeywords, quote) {
  if (scopeKeywords.length === 0) return 0;

  // Build combined text from quote reference + line item descriptions
  const quoteText = [
    quote.reference || '',
    ...quote.line_items.map(li => li.description || ''),
    ...quote.line_items.map(li => li.name || ''),
  ].join(' ').toLowerCase();

  let hits = 0;
  for (const kw of scopeKeywords) {
    if (quoteText.includes(kw)) hits++;
  }

  return hits / scopeKeywords.length;
}

/**
 * Find similar past quotes for a given card scope.
 *
 * @param {string} title - Full card title
 * @param {string} scope - Scope description from parsed title
 * @param {string} clientCode - Client code (e.g. "PRO")
 * @param {string} clientName - Full Zoho customer name
 * @param {number} limit - Max results to return
 * @returns {{ suggestedRate, similarQuotes[] }}
 */
export function findSimilarQuotes(title, scope, clientName, limit = 5) {
  const db = loadQuoteDb();
  const searchText = `${title} ${scope}`;
  const keywords = extractKeywords(searchText);

  if (keywords.length === 0) {
    return {
      keywords: [],
      suggestedRate: null,
      similarQuotes: [],
      message: 'No recognisable scope keywords found in card title.',
    };
  }

  // Score all quotes
  const scored = [];
  for (const quote of db) {
    // Skip declined/expired quotes
    if (quote.status === 'declined' || quote.status === 'expired') continue;

    const score = scoreMatch(keywords, quote);
    if (score > 0) {
      // Boost score if same client
      const clientBoost = (clientName && quote.client && quote.client.toLowerCase().includes(clientName.toLowerCase().split(' ')[0])) ? 0.15 : 0;
      scored.push({ quote, score: score + clientBoost });
    }
  }

  // Sort by score descending, then by date descending (prefer recent)
  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score;
    return (b.quote.date || '').localeCompare(a.quote.date || '');
  });

  const topMatches = scored.slice(0, limit);

  // Calculate suggested rate from top matches
  let suggestedRate = null;
  if (topMatches.length > 0) {
    const rates = topMatches
      .flatMap(m => m.quote.line_items.filter(li => li.rate > 0).map(li => li.rate));
    if (rates.length > 0) {
      suggestedRate = {
        average: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
        min: Math.min(...rates),
        max: Math.max(...rates),
        median: rates.sort((a, b) => a - b)[Math.floor(rates.length / 2)],
      };
    }
  }

  return {
    keywords,
    suggestedRate,
    similarQuotes: topMatches.map(({ quote, score }) => ({
      estimateNumber: quote.estimate_number,
      date: quote.date,
      client: quote.client,
      project: quote.project,
      reference: quote.reference,
      status: quote.status,
      matchScore: Math.round(score * 100) + '%',
      lineItems: quote.line_items.map(li => ({
        name: li.name,
        description: (li.description || '').slice(0, 150),
        quantity: li.quantity,
        rate: li.rate,
        total: li.total,
      })),
      subTotal: quote.sub_total,
      total: quote.total,
    })),
  };
}

/**
 * Force reload the database (call after sync).
 */
export function reloadQuoteDb() {
  quoteDb = null;
  return loadQuoteDb();
}
