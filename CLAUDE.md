# Teamhood MCP Server

## Teamhood Open API Rules

### Base URL (Multi-Tenant)

Teamhood is multi-tenant. Every API request must use the tenant-specific subdomain:

```
https://api-YOURTENANT.teamhood.com
```

Example: tenant `node` → `https://api-node.teamhood.com`

**Never** use `https://api.teamhood.com/api` — that is not a valid endpoint.

### Authentication

All requests require the `X-ApiKey` header:

```
X-ApiKey: YOUR_API_KEY
```

API keys are found in **Integration Settings** inside the Teamhood web app.

### API Prefix

All endpoints are under `/api/v1/`. Always include this prefix.

### Endpoint Reference

#### Workspaces
- `GET /api/v1/workspaces` — list all workspaces
- `POST /api/v1/workspaces` — create workspace
- `GET /api/v1/workspaces/{workspaceId}` — get workspace details
- `PUT /api/v1/workspaces/{workspaceId}/users/{userId}` — update user in workspace
- `GET /api/v1/workspaces/{workspaceId}/boards` — list boards in workspace

#### Boards
- `GET /api/v1/boards/{boardId}/rows` — list rows in board
- `GET /api/v1/boards/{boardId}/statuses` — list statuses in board
- `POST /api/v1/boards` — create board

#### Items
- `GET /api/v1/items` — list items (requires `workspaceId` and `boardId` query params)
- `POST /api/v1/items` — create item (requires `workspaceId`, `boardId` in body)
- `GET /api/v1/items/{itemId}` — get single item
- `PUT /api/v1/items/{itemId}` — update item
- `DELETE /api/v1/items/{itemId}` — delete item
- `GET /api/v1/items/{itemId}/attachments` — list item attachments

#### Attachments
- `GET /api/v1/attachments/{id}` — get attachment metadata
- `PUT /api/v1/attachments/{id}` — update attachment
- `DELETE /api/v1/attachments/{id}` — delete attachment
- `GET /api/v1/attachments/{id}/content` — download attachment content
- `POST /api/v1/attachments` — upload attachment

#### Rows
- `POST /api/v1/rows` — create row

#### Templates
- `GET /api/v1/templates/workspace` — list workspace templates
- `GET /api/v1/templates/board` — list board templates

#### Timelogs
- `POST /api/v1/timelogs` — create timelog

#### Users
- `GET /api/v1/users` — list all users in account

### Response Envelope

List endpoints wrap results in a named key matching the resource type. Field names use `title` (not `name`) and `id`:

```json
// GET /api/v1/workspaces
{ "workspaces": [{ "id": "uuid", "displayId": "ROWO", "title": "Design - Live Projects" }] }
```

Always unwrap by finding the array value in the response object. Never assume the wrapper key is `items` — it varies (`workspaces`, `boards`, etc.).

### Key Patterns

1. **Items listing**: Items are fetched via `GET /api/v1/items?workspaceId=X&boardId=Y` — workspace and board are query params, not path segments.
2. **Item creation**: `POST /api/v1/items` with `workspaceId`, `boardId`, `rowId`, `statusId` in the JSON body.
3. **Board sub-resources** (rows, statuses): Use `GET /api/v1/boards/{boardId}/rows` and `/statuses` — these remain path-based.
4. **Users**: `GET /api/v1/users` is a flat endpoint — no workspace scoping needed.
5. **There is no** `GET /api/v1/boards/{boardId}` endpoint. To get board info, list boards via the workspace: `GET /api/v1/workspaces/{workspaceId}/boards`.
6. **There is no** `GET /api/v1/items/{itemId}/children` endpoint. To find child items, list all board items and filter by `parentId`.
7. **Field naming**: Teamhood uses `title` (not `name`) for workspace/board/item names, and `id` for UUIDs.
8. **Pagination**: The API ignores `page`/`pageSize` query params. It returns all items at once and provides `nextPageUrl` in the response for cursor-based pagination. The items envelope is `{ "items": [...], "nextPageUrl": "..." }`.
9. **Server-side filters**: The items endpoint supports `tags=Price Required`, `completed=false`, and `archived=false` as query params. Use these to reduce response size (e.g. `tags` filter: 65 items vs 5000 unfiltered).
10. **Write permissions**: The current API key is read-only for items. PUT `/api/v1/items/{itemId}` returns 500. Tag removal and card updates must be done manually in Teamhood.

### Create Item Example

```javascript
const payload = {
    title: "Sample Task",
    description: "Created via API",
    budget: 25.5,
    workspaceId: "YOUR_WORKSPACE_ID",
    boardId: "YOUR_BOARD_ID",
    rowId: "YOUR_ROW_ID",
    statusId: "YOUR_STATUS_ID",
    customFields: [
        { name: "Material", value: "PVC" },
        { name: "Length (m)", value: "3.3" }
    ]
};
```

### Teamhood → Zoho Quote Workflow

Cards tagged **"Price Required"** can be turned into Zoho draft estimates:

1. `list_price_required` — lists cards needing quotes, with parsed client code and site name
2. `prepare_quote_data` — extracts all data from a card for Zoho estimate creation

**Card title format**: `[PRO183 - One North Quay] Full perimeter access scaffold`
- `PRO` = client code → matches Zoho customer `designation` field
- `One North Quay` = site/project name
- Rest = scope description

**Client mapping**: `client-identifiers.txt` in project root maps 3-letter codes to Zoho customer names. Update this file when adding new clients.

**Flow**: Teamhood `prepare_quote_data` → looks up client code in `client-identifiers.txt` → returns Zoho customer name → Zoho `list_contacts` (search by name) → Zoho `create_estimate`

## Project Structure

- `src/teamhood-api.js` — API client with all Teamhood endpoint calls
- `src/tools/quotes.js` — Quote workflow tools (list_price_required, prepare_quote_data)
- `src/utils/title-parser.js` — Parses [XXX### - Site Name] format from card titles
- `src/utils/client-lookup.js` — Reads client-identifiers.txt to map codes to Zoho customer names
- `client-identifiers.txt` — Client code → Zoho customer name mapping (update when adding new clients)
- `src/` — MCP server implementation
- `discover-ids.js` — Utility to discover workspace/board UUIDs
- Deployed on Railway

## Development Notes

- Default tenant is `node` (base URL: `https://api-node.teamhood.com`)
- Environment variables: `TEAMHOOD_API_KEY`, `TEAMHOOD_API_BASE_URL`, `TEAMHOOD_WORKSPACE_ID`, `TEAMHOOD_BOARD_ID`
