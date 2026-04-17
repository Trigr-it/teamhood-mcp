import * as api from '../teamhood-api.js';
import { extractDisplayIdFromUrl } from '../utils/id-resolver.js';

// ---------------------------------------------------------------------------
// Tool definitions (MCP schema)
// ---------------------------------------------------------------------------

export const cardToolDefs = [
  {
    name: 'get_card',
    description: 'Get a Teamhood card by its ID (UUID or display ID like "ROWO-13383"). Returns all card fields including title, description, status, owner, tags, and custom fields.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'string',
          description: 'Card UUID or display ID (e.g. "ROWO-13383")',
        },
      },
      required: ['card_id'],
    },
  },
  {
    name: 'get_card_by_url',
    description: 'Get a Teamhood card by its URL. Extracts the display ID from the URL and fetches the card.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Teamhood card URL (e.g. "https://node.teamhood.com/ROWO/Board/LIPR/ROWO-13383")',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_cards',
    description: 'List Teamhood cards with optional filters. Returns parent-level cards by default. Automatically handles pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status name or ID',
        },
        assignee_id: {
          type: 'string',
          description: 'Filter by assignee user ID',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (cards matching any tag are returned)',
        },
        archived: {
          type: 'boolean',
          description: 'Include archived cards (default: false)',
        },
        parent_only: {
          type: 'boolean',
          description: 'Return only parent cards, not subtasks (default: true)',
        },
      },
    },
  },
  {
    name: 'search_cards',
    description: 'Search Teamhood cards by title and description. Returns matching cards with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (matches against title and description)',
        },
        archived: {
          type: 'boolean',
          description: 'Include archived cards (default: false)',
        },
        parent_only: {
          type: 'boolean',
          description: 'Return only parent cards (default: true)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_card',
    description: 'Create a new Teamhood card on the board.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Card title',
        },
        statusId: {
          type: 'string',
          description: 'Status ID to place the card in',
        },
        assignedUserId: {
          type: 'string',
          description: 'User ID to assign the card to',
        },
        description: {
          type: 'string',
          description: 'Card description (supports HTML)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply to the card',
        },
        customFields: {
          type: 'array',
          description: 'Custom field values to set',
        },
        parentId: {
          type: 'string',
          description: 'Parent card ID to create this as a subtask',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_card',
    description: 'Update an existing Teamhood card. Uses PUT (full replace merged with current values).',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'string',
          description: 'Card UUID or display ID',
        },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        statusId: { type: 'string', description: 'New status ID' },
        assignedUserId: { type: 'string', description: 'New assignee user ID' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
      },
      required: ['card_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleCardTool(name, args) {
  switch (name) {
    case 'get_card':
      return await api.getCard(args.card_id);

    case 'get_card_by_url': {
      const displayId = extractDisplayIdFromUrl(args.url);
      if (!displayId) throw new Error(`Could not extract a card display ID from URL: ${args.url}`);
      return await api.getCard(displayId);
    }

    case 'list_cards':
      return await api.listCards({
        status: args.status,
        assignee_id: args.assignee_id,
        tags: args.tags,
        archived: args.archived,
        parent_only: args.parent_only,
      });

    case 'search_cards':
      return await api.searchCards(args.query, {
        archived: args.archived,
        parent_only: args.parent_only,
      });

    case 'create_card':
      return await api.createCard({
        title: args.title,
        statusId: args.statusId,
        assignedUserId: args.assignedUserId,
        description: args.description,
        tags: args.tags,
        customFields: args.customFields,
        parentId: args.parentId,
      });

    case 'update_card': {
      const { card_id, ...fields } = args;
      return await api.updateCard(card_id, fields);
    }

    default:
      throw new Error(`Unknown card tool: ${name}`);
  }
}
