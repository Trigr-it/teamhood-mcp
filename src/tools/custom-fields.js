import * as api from '../teamhood-api.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const customFieldToolDefs = [
  {
    name: 'get_card_custom_field',
    description: 'Get the value of a specific custom field on a Teamhood card. Uses fuzzy name matching.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'string',
          description: 'Card UUID or display ID',
        },
        field_name: {
          type: 'string',
          description: 'Name of the custom field to retrieve (partial match supported)',
        },
      },
      required: ['card_id', 'field_name'],
    },
  },
  {
    name: 'extract_project_info',
    description: 'Extract structured project information from a Teamhood card for quote generation. Returns project name, client contact, drawing ref, category, 3D model URL, and description.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'string',
          description: 'Card UUID or display ID',
        },
      },
      required: ['card_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleCustomFieldTool(name, args) {
  switch (name) {
    case 'get_card_custom_field':
      return await api.getCardCustomField(args.card_id, args.field_name);

    case 'extract_project_info':
      return await api.extractProjectInfo(args.card_id);

    default:
      throw new Error(`Unknown custom field tool: ${name}`);
  }
}
