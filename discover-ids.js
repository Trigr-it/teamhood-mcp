/**
 * Quick utility to discover your Teamhood workspace and board UUIDs.
 *
 * Usage:
 *   TEAMHOOD_API_KEY=your-key-here node discover-ids.js
 *
 * If you know your tenant name, also set:
 *   TEAMHOOD_API_BASE_URL=https://api-YOURTENANT.teamhood.com
 */

const API_KEY = process.env.TEAMHOOD_API_KEY;
const BASE = (process.env.TEAMHOOD_API_BASE_URL || 'https://api-node.teamhood.com').replace(/\/+$/, '');

if (!API_KEY) {
  console.error('Set TEAMHOOD_API_KEY environment variable first.');
  process.exit(1);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-ApiKey': API_KEY, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`  ${res.status} ${res.statusText} — ${path}`);
    if (text) console.error(`  ${text.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

/** Unwrap Teamhood responses: { "workspaces": [...] } → [...], or plain array */
function unwrap(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    // If the response is a wrapper with a single array value, unwrap it
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [data];
}

console.log(`\n=== Teamhood ID Discovery ===`);
console.log(`Base URL: ${BASE}\n`);

// List workspaces
console.log('Workspaces:');
const workspaces = await get('/api/v1/workspaces');
if (!workspaces) {
  console.error('\nCould not list workspaces. Check your API key and base URL.');
  console.error('Your base URL should be: https://api-YOURTENANT.teamhood.com');
  console.error('(Check your Teamhood URL — if it\'s "node.teamhood.com", tenant is "node")\n');
  process.exit(1);
}

const wsList = unwrap(workspaces);

for (const ws of wsList) {
  console.log(`\n  Workspace: ${ws.title || ws.name || '(unnamed)'}`);
  console.log(`  ID:        ${ws.id}`);
  console.log(`  Display:   ${ws.displayId || '-'}`);

  if (!ws.id) {
    console.error('  Could not determine workspace ID');
    continue;
  }

  // List boards in this workspace
  const boards = await get(`/api/v1/workspaces/${ws.id}/boards`);
  if (boards) {
    const boardList = unwrap(boards);
    console.log(`  Boards:`);
    for (const b of boardList) {
      console.log(`    ${b.title || b.name || '(unnamed)'}  →  ${b.id}`);
    }
  }
}

console.log('\n--- Copy these into your .env or Railway environment variables ---');
if (wsList.length > 0 && wsList[0].id) {
  console.log(`  TEAMHOOD_WORKSPACE_ID=${wsList[0].id}`);
}
console.log('  TEAMHOOD_BOARD_ID=<board UUID from above>');
console.log('  TEAMHOOD_API_BASE_URL=' + BASE);
console.log();
