import * as api from '../teamhood-api.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const relationshipToolDefs = [
  {
    name: 'get_card_children',
    description: 'Get all child cards (subtasks) of a Teamhood card.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'string',
          description: 'Parent card UUID or display ID',
        },
      },
      required: ['card_id'],
    },
  },
  {
    name: 'get_card_parent',
    description: 'Get the parent card of a Teamhood card, if it exists.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'string',
          description: 'Child card UUID or display ID',
        },
      },
      required: ['card_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleRelationshipTool(name, args) {
  switch (name) {
    case 'get_card_children':
      return await api.getCardChildren(args.card_id);

    case 'get_card_parent':
      return await api.getCardParent(args.card_id);

    default:
      throw new Error(`Unknown relationship tool: ${name}`);
  }
}
