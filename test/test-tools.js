/**
 * Test script for teamhood-mcp tools.
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in real values
 *   2. Run: node test/test-tools.js
 *
 * This tests against the live Teamhood API — requires valid credentials.
 */

import * as api from '../src/teamhood-api.js';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const SKIP = '\x1b[33mSKIP\x1b[0m';

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn) {
  try {
    const result = await fn();
    if (result === 'skip') {
      console.log(`  ${SKIP}  ${name}`);
      skipped++;
    } else {
      console.log(`  ${PASS}  ${name}`);
      passed++;
    }
  } catch (err) {
    console.log(`  ${FAIL}  ${name}`);
    console.log(`         ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== teamhood-mcp tool tests ===\n');

// Config check
const config = api.getConfig();
console.log('Config:', JSON.stringify(config, null, 2), '\n');

if (!config.apiKeySet) {
  console.log('API key not set. Set TEAMHOOD_API_KEY in .env to run live tests.\n');
  console.log('Running validation-only tests...\n');
}

// --- Board Structure ---
console.log('Board Structure:');

await test('get_board_metadata returns board info', async () => {
  if (!config.apiKeySet) return 'skip';
  const meta = await api.getBoardMetadata();
  assert(meta, 'Should return board metadata');
  assert(meta.board || meta.workspace, 'Should have board or workspace info');
});

await test('get_board_statuses returns array', async () => {
  if (!config.apiKeySet) return 'skip';
  const statuses = await api.getBoardStatuses();
  assert(Array.isArray(statuses), 'Should return array');
  assert(statuses.length > 0, 'Should have at least one status');
  assert(statuses[0].id, 'Status should have id');
  assert(statuses[0].name, 'Status should have name');
});

await test('get_board_rows returns array', async () => {
  if (!config.apiKeySet) return 'skip';
  const rows = await api.getBoardRows();
  assert(Array.isArray(rows), 'Should return array');
});

// --- Users ---
console.log('\nUsers:');

await test('list_users returns array of users', async () => {
  if (!config.apiKeySet) return 'skip';
  const users = await api.listUsers();
  assert(Array.isArray(users), 'Should return array');
  assert(users.length > 0, 'Should have at least one user');
  assert(users[0].id, 'User should have id');
  assert(users[0].name, 'User should have name');
});

await test('get_user_by_name finds a user', async () => {
  if (!config.apiKeySet) return 'skip';
  const users = await api.listUsers();
  if (users.length === 0) return 'skip';
  const user = await api.getUserByName(users[0].name.split(' ')[0]);
  assert(user.id, 'Found user should have id');
});

await test('get_user_by_name throws on no match', async () => {
  if (!config.apiKeySet) return 'skip';
  try {
    await api.getUserByName('zzz_nonexistent_user_zzz');
    throw new Error('Should have thrown');
  } catch (e) {
    assert(e.message.includes('No user found'), 'Should throw descriptive error');
  }
});

await test('get_user_by_email throws on no match', async () => {
  if (!config.apiKeySet) return 'skip';
  try {
    await api.getUserByEmail('nonexistent@example.com');
    throw new Error('Should have thrown');
  } catch (e) {
    assert(e.message.includes('No user found'), 'Should throw descriptive error');
  }
});

// --- Cards ---
console.log('\nCards:');

await test('list_cards returns array', async () => {
  if (!config.apiKeySet) return 'skip';
  const cards = await api.listCards();
  assert(Array.isArray(cards), 'Should return array');
  if (cards.length > 0) {
    assert(cards[0].id, 'Card should have id');
    assert(cards[0].title !== undefined, 'Card should have title');
  }
});

await test('list_cards returns only parents by default', async () => {
  if (!config.apiKeySet) return 'skip';
  const cards = await api.listCards();
  for (const card of cards) {
    assert(!card.parentId, 'Default list should only contain parent cards');
  }
});

await test('search_cards requires query', async () => {
  try {
    await api.searchCards('');
    throw new Error('Should have thrown');
  } catch (e) {
    assert(e.message.includes('required'), 'Should throw on empty query');
  }
});

await test('search_cards works with query', async () => {
  if (!config.apiKeySet) return 'skip';
  const cards = await api.searchCards('test');
  assert(Array.isArray(cards), 'Should return array');
});

// --- Card by ID ---
let sampleCardId = null;

await test('get first card for subsequent tests', async () => {
  if (!config.apiKeySet) return 'skip';
  const cards = await api.listCards();
  if (cards.length === 0) return 'skip';
  sampleCardId = cards[0].id;
  assert(sampleCardId, 'Should have a card ID');
});

await test('get_card by UUID', async () => {
  if (!sampleCardId) return 'skip';
  const card = await api.getCard(sampleCardId);
  assert(card.id === sampleCardId, 'Should return the correct card');
  assert(card.title !== undefined, 'Card should have title');
});

await test('get_card_children returns array', async () => {
  if (!sampleCardId) return 'skip';
  const children = await api.getCardChildren(sampleCardId);
  assert(Array.isArray(children), 'Should return array');
});

await test('get_card_parent handles root cards', async () => {
  if (!sampleCardId) return 'skip';
  const result = await api.getCardParent(sampleCardId);
  // Parent cards should return null parent or a parent card
  assert(result !== undefined, 'Should return a result');
});

await test('get_card_attachments returns array', async () => {
  if (!sampleCardId) return 'skip';
  const attachments = await api.getCardAttachments(sampleCardId);
  assert(Array.isArray(attachments), 'Should return array');
});

await test('extract_project_info returns structured data', async () => {
  if (!sampleCardId) return 'skip';
  const info = await api.extractProjectInfo(sampleCardId);
  assert(info.cardId, 'Should have cardId');
  assert(info.projectName !== undefined, 'Should have projectName');
  assert('clientContact' in info, 'Should have clientContact field');
  assert('drawingRef' in info, 'Should have drawingRef field');
  assert('category' in info, 'Should have category field');
  assert('modelUrl' in info, 'Should have modelUrl field');
  assert('description' in info, 'Should have description field');
});

// --- Input validation ---
console.log('\nInput Validation:');

await test('get_card rejects invalid ID format', async () => {
  try {
    await api.getCard('not-valid!!!');
    throw new Error('Should have thrown');
  } catch (e) {
    assert(e.message.includes('Invalid card identifier'), 'Should give descriptive error');
  }
});

await test('create_card requires title', async () => {
  try {
    await api.createCard({});
    throw new Error('Should have thrown');
  } catch (e) {
    assert(e.message.includes('title'), 'Should mention title requirement');
  }
});

await test('get_card_custom_field requires field name', async () => {
  try {
    await api.getCardCustomField('some-id', '');
    throw new Error('Should have thrown');
  } catch (e) {
    assert(e.message.includes('required'), 'Should mention requirement');
  }
});

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
process.exit(failed > 0 ? 1 : 0);
