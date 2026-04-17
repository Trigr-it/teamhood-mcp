import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';

import { cardToolDefs, handleCardTool } from './tools/cards.js';
import { userToolDefs, handleUserTool } from './tools/users.js';
import { boardToolDefs, handleBoardTool } from './tools/board.js';
import { attachmentToolDefs, handleAttachmentTool } from './tools/attachments.js';
import { customFieldToolDefs, handleCustomFieldTool } from './tools/custom-fields.js';
import { relationshipToolDefs, handleRelationshipTool } from './tools/relationships.js';
import { quoteToolDefs, handleQuoteTool } from './tools/quotes.js';
import { getConfig } from './teamhood-api.js';

// ---------------------------------------------------------------------------
// All tool definitions
// ---------------------------------------------------------------------------

const allToolDefs = [
  ...cardToolDefs,
  ...userToolDefs,
  ...boardToolDefs,
  ...attachmentToolDefs,
  ...customFieldToolDefs,
  ...relationshipToolDefs,
  ...quoteToolDefs,
];

// Map tool names to their handler functions
const toolHandlers = new Map();
for (const def of cardToolDefs) toolHandlers.set(def.name, handleCardTool);
for (const def of userToolDefs) toolHandlers.set(def.name, handleUserTool);
for (const def of boardToolDefs) toolHandlers.set(def.name, handleBoardTool);
for (const def of attachmentToolDefs) toolHandlers.set(def.name, handleAttachmentTool);
for (const def of customFieldToolDefs) toolHandlers.set(def.name, handleCustomFieldTool);
for (const def of relationshipToolDefs) toolHandlers.set(def.name, handleRelationshipTool);
for (const def of quoteToolDefs) toolHandlers.set(def.name, handleQuoteTool);

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Track active SSE transports by session ID
const transports = new Map();

// Health check
app.get('/health', (_req, res) => {
  const config = getConfig();
  res.json({
    status: 'ok',
    server: 'teamhood-mcp',
    version: '1.0.0',
    tools: allToolDefs.length,
    config: {
      apiKeySet: config.apiKeySet,
      baseUrl: config.baseUrl,
      workspaceId: config.workspaceId,
      boardId: config.boardId,
    },
  });
});

// SSE endpoint — each connection creates a new MCP server + transport
app.get('/sse', async (req, res) => {
  console.log('[mcp] New SSE connection');

  const transport = new SSEServerTransport('/message', res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  const server = new Server(
    { name: 'teamhood-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefs,
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers.get(name);

    if (!handler) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    try {
      const result = await handler(name, args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      console.error(`[mcp] Tool "${name}" error:`, err.message);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  });

  // Clean up on disconnect
  res.on('close', () => {
    console.log(`[mcp] SSE session ${sessionId} disconnected`);
    transports.delete(sessionId);
    server.close().catch(() => {});
  });

  await server.connect(transport);
  console.log(`[mcp] SSE session ${sessionId} connected`);
});

// Message endpoint for client → server communication
app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).json({ error: 'Session not found. Connect to /sse first.' });
    return;
  }

  await transport.handlePostMessage(req, res);
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  const config = getConfig();
  console.log(`[teamhood-mcp] Server running on port ${PORT}`);
  console.log(`[teamhood-mcp] SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`[teamhood-mcp] Health check: http://localhost:${PORT}/health`);
  console.log(`[teamhood-mcp] API key: ${config.apiKeySet ? 'set' : 'NOT SET'}`);
  console.log(`[teamhood-mcp] Board ID: ${config.boardId}`);
  console.log(`[teamhood-mcp] Tools registered: ${allToolDefs.length}`);
});
