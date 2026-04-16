# teamhood-mcp

MCP server for Teamhood project management. Exposes Teamhood cards, users, board structure, and custom fields as MCP tools for use with Claude and other MCP-compatible clients.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Teamhood API key and IDs
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TEAMHOOD_API_KEY` | Yes | Your Teamhood API key |
| `TEAMHOOD_API_BASE_URL` | No | API base URL (default: `https://api.teamhood.com/api`) |
| `TEAMHOOD_WORKSPACE_ID` | Yes | Your workspace UUID |
| `TEAMHOOD_BOARD_ID` | Yes | Your board UUID |
| `PORT` | No | Server port (default: `3000`) |

### Finding Your IDs

- **Workspace ID**: Go to Teamhood settings or check the API response from `/workspaces`
- **Board ID**: Found in board settings or the board URL
- **API Key**: Generate from Teamhood workspace settings under API/Integrations

## Run

```bash
npm start
```

The server starts on port 3000 (or `$PORT`) with:
- **SSE endpoint**: `GET /sse` — connect MCP clients here
- **Message endpoint**: `POST /message?sessionId=...` — MCP message relay
- **Health check**: `GET /health` — server status and config validation

## Tools (17 total)

### Cards
| Tool | Description |
|---|---|
| `get_card` | Get card by UUID or display ID (e.g. "ROWO-13383") |
| `get_card_by_url` | Get card from a Teamhood URL |
| `list_cards` | List cards with filters (status, assignee, tags, archived) |
| `search_cards` | Search cards by title/description |
| `create_card` | Create a new card |
| `update_card` | Update an existing card |

### Users
| Tool | Description |
|---|---|
| `list_users` | List all workspace users |
| `get_user_by_name` | Find user by name (fuzzy match) |
| `get_user_by_email` | Find user by email |

### Board Structure
| Tool | Description |
|---|---|
| `get_board_statuses` | Get all board statuses/columns |
| `get_board_rows` | Get all board rows/swimlanes |
| `get_board_metadata` | Get board configuration and details |

### Attachments
| Tool | Description |
|---|---|
| `get_card_attachments` | Get files attached to a card |

### Custom Fields
| Tool | Description |
|---|---|
| `get_card_custom_field` | Get a specific custom field value |
| `extract_project_info` | Extract structured project data for quotes |

### Relationships
| Tool | Description |
|---|---|
| `get_card_children` | Get subtasks of a card |
| `get_card_parent` | Get parent of a subtask |

## Testing

```bash
npm test
```

Runs validation tests. With a valid `.env` configuration, also runs live API tests.

## Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project and connect the repo
3. Add environment variables in Railway dashboard
4. Railway auto-detects the `railway.json` config and deploys

The deployed server URL will be your MCP endpoint. Connect to it at `https://your-app.railway.app/sse`.

## MCP Client Configuration

Add to your Claude Desktop `claude_desktop_config.json` or Claude Code MCP settings:

```json
{
  "mcpServers": {
    "teamhood": {
      "url": "https://your-deployed-url.railway.app/sse"
    }
  }
}
```

## Architecture

```
src/
  index.js              # Express server + MCP SSE transport
  teamhood-api.js       # API client (auth, pagination, caching, ID resolution)
  tools/
    cards.js            # Card CRUD tools
    users.js            # User lookup tools
    board.js            # Board structure tools
    attachments.js      # Attachment tools
    custom-fields.js    # Custom field + project info extraction
    relationships.js    # Parent/child relationship tools
  utils/
    html-strip.js       # HTML → plain text conversion
    id-resolver.js      # Display ID ↔ UUID resolution + caching
```

### Key design decisions

- **5-minute cache** on board metadata (statuses, users, rows) to reduce API calls
- **Automatic pagination** with a 1000-item safety cap
- **Display ID resolution** accepts both UUIDs and display IDs (like "ROWO-13383") with caching
- **HTML stripping** on card descriptions by default
- **PUT-based updates** that merge with existing card data to prevent field loss
