import * as api from '../teamhood-api.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const userToolDefs = [
  {
    name: 'list_users',
    description: 'List all users in the Teamhood workspace. Returns id, name, and email for each user.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_user_by_name',
    description: 'Find a Teamhood user by name (fuzzy/partial match).',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'User name to search for (partial match supported)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_user_by_email',
    description: 'Find a Teamhood user by their email address (exact match).',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'User email address',
        },
      },
      required: ['email'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleUserTool(name, args) {
  switch (name) {
    case 'list_users': {
      const users = await api.listUsers();
      if (!users.length) return { users: [], message: 'No users returned — the API key may not have permission for the users endpoint.' };
      return users;
    }

    case 'get_user_by_name':
      return await api.getUserByName(args.name);

    case 'get_user_by_email':
      return await api.getUserByEmail(args.email);

    default:
      throw new Error(`Unknown user tool: ${name}`);
  }
}
