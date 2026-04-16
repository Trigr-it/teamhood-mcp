import * as api from '../teamhood-api.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const attachmentToolDefs = [
  {
    name: 'get_card_attachments',
    description: 'Get all attachments for a Teamhood card. Returns file names, URLs, and metadata.',
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
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleAttachmentTool(name, args) {
  switch (name) {
    case 'get_card_attachments':
      return await api.getCardAttachments(args.card_id);

    default:
      throw new Error(`Unknown attachment tool: ${name}`);
  }
}
