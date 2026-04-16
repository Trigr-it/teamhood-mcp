import * as api from '../teamhood-api.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const boardToolDefs = [
  {
    name: 'get_board_statuses',
    description: 'Get all statuses (columns) for the Teamhood board. Returns id, name, and order for each status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_board_rows',
    description: 'Get all rows (swimlanes) for the Teamhood board.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_board_metadata',
    description: 'Get board metadata including workspace details, settings, and configuration.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleBoardTool(name, _args) {
  switch (name) {
    case 'get_board_statuses':
      return await api.getBoardStatuses();

    case 'get_board_rows':
      return await api.getBoardRows();

    case 'get_board_metadata':
      return await api.getBoardMetadata();

    default:
      throw new Error(`Unknown board tool: ${name}`);
  }
}
