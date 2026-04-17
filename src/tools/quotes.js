import * as api from '../teamhood-api.js';
import { parseCardTitle } from '../utils/title-parser.js';
import { lookupClient } from '../utils/client-lookup.js';
import { findSimilarQuotes } from '../utils/quote-matcher.js';

// Client codes excluded from the quote workflow
const EXCLUDED_CLIENT_CODES = new Set(['BFT']);

// ---------------------------------------------------------------------------
// Tool definitions (MCP schema)
// ---------------------------------------------------------------------------

export const quoteToolDefs = [
  {
    name: 'list_price_required',
    description: 'List all Teamhood cards tagged "Price Required" that need quotes. Returns card details including parsed client code, Zoho customer name, site name, scope, and suggested pricing from similar past quotes.',
    inputSchema: {
      type: 'object',
      properties: {
        include_completed: {
          type: 'boolean',
          description: 'Include completed cards (default: false)',
        },
      },
    },
  },
  {
    name: 'prepare_quote_data',
    description: 'Extract and format all data from a Teamhood card needed to create a Zoho draft estimate. Includes suggested pricing from similar past quotes in the reference database. Use the returned zohoCustomerName to search Zoho contacts for the customer_id, then call create_estimate with the returned estimateData.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'string',
          description: 'Teamhood card UUID or display ID (e.g. "ROWO-13214")',
        },
      },
      required: ['card_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleQuoteTool(name, args) {
  switch (name) {
    case 'list_price_required':
      return await listPriceRequired(args);

    case 'prepare_quote_data':
      return await prepareQuoteData(args);

    default:
      throw new Error(`Unknown quote tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// list_price_required
// ---------------------------------------------------------------------------

async function listPriceRequired({ include_completed = false } = {}) {
  // Use server-side tag filter — fetches ~65 items instead of 5000
  const filters = {
    parent_only: true,
    serverTag: 'Price Required',
  };
  if (!include_completed) filters.completed = false;

  const cards = await api.listCards(filters);

  const priceRequired = cards.filter(card => {
    // Exclude filtered client codes (e.g. BFT)
    const parsed = parseCardTitle(card.title);
    if (parsed.clientCode && EXCLUDED_CLIENT_CODES.has(parsed.clientCode)) return false;
    return true;
  });

  return priceRequired.map(card => {
    const parsed = parseCardTitle(card.title);
    const client = lookupClient(parsed.clientCode);
    const pricing = findSimilarQuotes(card.title, parsed.scope, client?.customerName, 3);

    return {
      id: card.id,
      displayId: card.displayId,
      title: card.title,
      clientCode: parsed.clientCode,
      zohoCustomerName: client ? client.customerName : null,
      siteName: parsed.siteName,
      scope: parsed.scope,
      assignedUserName: card.assignedUserName,
      suggestedRate: pricing.suggestedRate,
      matchedKeywords: pricing.keywords,
      topMatch: pricing.similarQuotes[0] ? {
        estimateNumber: pricing.similarQuotes[0].estimateNumber,
        reference: pricing.similarQuotes[0].reference,
        total: pricing.similarQuotes[0].total,
        matchScore: pricing.similarQuotes[0].matchScore,
      } : null,
      customFields: card.customFields,
      completed: card.completed,
      url: card.url,
    };
  });
}

// ---------------------------------------------------------------------------
// prepare_quote_data
// ---------------------------------------------------------------------------

async function prepareQuoteData({ card_id }) {
  // 1. Fetch the Teamhood card
  const card = await api.getCard(card_id);
  if (!card) throw new Error(`Card not found: ${card_id}`);

  // 2. Parse the title
  const parsed = parseCardTitle(card.title);
  if (!parsed.clientCode) {
    throw new Error(`Could not parse client code from card title: "${card.title}". Expected format: [XXX### - Site Name] Description`);
  }

  // 3. Look up client from client-identifiers.txt
  const client = lookupClient(parsed.clientCode);
  if (!client) {
    throw new Error(`Client code "${parsed.clientCode}" not found in client-identifiers.txt. Please add it to the file.`);
  }

  // 4. Extract useful custom fields
  const customFieldMap = {};
  for (const cf of (card.customFields || [])) {
    if (cf.value) customFieldMap[cf.name] = cf.value;
  }

  // 5. Find similar past quotes for pricing
  const pricing = findSimilarQuotes(card.title, parsed.scope, client.customerName, 5);

  // 6. Build notes block for the estimate
  const notesParts = [];
  if (parsed.scope) notesParts.push(`Scope: ${parsed.scope}`);
  if (customFieldMap['Client Contact']) notesParts.push(`Client Contact: ${customFieldMap['Client Contact']}`);
  if (customFieldMap['Drawing Ref']) notesParts.push(`Drawing Ref: ${customFieldMap['Drawing Ref']}`);
  if (customFieldMap['3D Model']) notesParts.push(`3D Model: ${customFieldMap['3D Model']}`);
  if (card.description) notesParts.push(`\nDescription:\n${card.description}`);
  if (card.url) notesParts.push(`\nTeamhood: ${card.url}`);

  // 7. Build suggested line items using pricing data
  const suggestedRate = pricing.suggestedRate?.median || pricing.suggestedRate?.average || 0;

  // 8. Return everything needed to create the Zoho estimate
  return {
    // Card identifiers
    cardId: card.id,
    displayId: card.displayId,
    cardUrl: card.url,

    // Parsed title components
    clientCode: parsed.clientCode,
    siteName: parsed.siteName,
    scope: parsed.scope,

    // Zoho customer (from client-identifiers.txt)
    zohoCustomerName: client.customerName,
    zohoLookup: {
      instruction: `Search Zoho contacts for "${client.customerName}" to get the customer_id, then create the estimate.`,
    },

    // Pricing intelligence from reference database
    pricing: {
      suggestedRate: pricing.suggestedRate,
      matchedKeywords: pricing.keywords,
      similarQuotes: pricing.similarQuotes,
    },

    // Ready-to-use estimate data (just needs customer_id added)
    estimateData: {
      reference_number: card.displayId,
      notes: notesParts.join('\n'),
      line_items: [{
        name: '- Design & Analysis (UK)',
        description: `${parsed.scope || card.title}\n${parsed.siteName || ''} - ${card.displayId}`,
        quantity: 1,
        rate: suggestedRate,
      }],
    },

    // Additional context
    assignedTo: card.assignedUserName,
    customFields: customFieldMap,
  };
}
