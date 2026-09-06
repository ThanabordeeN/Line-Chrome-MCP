# Line Chrome MCP

Local gateway that turns the LINE Chrome Extension UI into a stable automation surface:

- REST API (`/v1`)
- Server-Sent Events for gateway events (`/v1/events`)
- MCP Streamable HTTP (`/mcp`, including SSE streaming when the protocol uses a stream)
- MCP stdio (`line-mcp`) implemented as a thin proxy over the local REST gateway

The DOM/CDP adapter is intentionally hidden behind the messaging core. MCP clients and REST callers never depend on LINE CSS class names or DOM implementation details.

## Status

This is an initial working prototype built from the observed LINE Extension DOM contract. It supports:

- chat listing/search
- reading text/image/sticker message metadata
- virtualized chat/message scrolling
- incoming message events for the currently rendered active chat
- visible chat-list change events
- queued/idempotent text sending with post-send message-ID verification
- REST + MCP stdio + MCP Streamable HTTP

Not yet implemented: reply sending, file/image upload, reactions, durable storage, and full background message capture for chats that are never rendered by the LINE UI.

## Requirements

- Node.js 20+
- Chromium/Chrome with the LINE Chrome Extension installed and logged in
- a dedicated Chrome profile launched with DevTools remote debugging enabled

Chrome 136+ does not allow remote debugging against the normal default user-data directory. Use a dedicated profile.

Example:

```bash
google-chrome \
  --user-data-dir="$HOME/.line-mcp-profile" \
  --remote-debugging-port=9222
```

Open LINE in that profile and log in.

## Install

```bash
npm install
npm run build
```

Copy `.env.example` values into your environment as needed. The defaults are:

```text
LINE_CDP_URL=http://127.0.0.1:9222
LINE_EXTENSION_ID=ophjlpahpchlmihnnnihgmmeilfjmjjc
LINE_GATEWAY_HOST=127.0.0.1
LINE_GATEWAY_PORT=8787
```

`LINE_EXTENSION_ID` can be omitted; the adapter will then look for a Chrome extension page containing LINE-specific ARIA/DOM markers.

## Start the gateway

```bash
npm start
```

Development mode:

```bash
npm run dev
```

Endpoints:

```text
REST API:           http://127.0.0.1:8787/v1
OpenAPI metadata:   http://127.0.0.1:8787/openapi.json
Event SSE:          http://127.0.0.1:8787/v1/events
MCP HTTP:           http://127.0.0.1:8787/mcp
```

## REST API

### Health / status

```bash
curl http://127.0.0.1:8787/v1/health
curl http://127.0.0.1:8787/v1/status
curl http://127.0.0.1:8787/v1/capabilities
```

### Chats

```bash
curl 'http://127.0.0.1:8787/v1/chats?limit=50'
curl 'http://127.0.0.1:8787/v1/chats?q=Pai'
curl 'http://127.0.0.1:8787/v1/chats?unread=true'
```

### Messages

```bash
curl 'http://127.0.0.1:8787/v1/chats/CHAT_ID/messages?limit=50'
```

Older page:

```bash
curl 'http://127.0.0.1:8787/v1/chats/CHAT_ID/messages?limit=50&before=MESSAGE_ID'
```

### Send text

```bash
curl -X POST 'http://127.0.0.1:8787/v1/chats/CHAT_ID/messages' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: workflow-run-123' \
  -d '{"text":"ทดสอบส่งจาก API"}'
```

The request returns `202 Accepted` with an operation. Poll it:

```bash
curl http://127.0.0.1:8787/v1/operations/OPERATION_ID
```

UI write operations are serialized so two agents cannot switch LINE chats and type at the same time.

## Gateway event SSE

```bash
curl -N http://127.0.0.1:8787/v1/events
```

Current event families include:

```text
message.created
message.sent
chat.updated
operation.created
operation.started
operation.succeeded
operation.failed
```

`message.created` is generated for newly rendered messages in the active chat. `chat.updated` is generated when a visible chat-row preview/unread state changes.

## MCP Streamable HTTP

Use:

```text
http://127.0.0.1:8787/mcp
```

This uses the current MCP Streamable HTTP server entry. Streaming responses use SSE when required by MCP. It is not the deprecated legacy standalone HTTP+SSE transport.

Tools:

```text
line_get_status
line_get_capabilities
line_search_chats
line_get_messages
line_send_message
line_get_operation
```

## MCP stdio

The stdio process does not own Chrome or LINE. It calls the already-running gateway over localhost, so multiple MCP hosts do not create competing LINE sessions.

```bash
LINE_GATEWAY_URL=http://127.0.0.1:8787 node dist/mcp/stdio.js
```

Example MCP host configuration:

```json
{
  "mcpServers": {
    "line": {
      "command": "node",
      "args": ["/absolute/path/to/Line-Chrome-MCP/dist/mcp/stdio.js"],
      "env": {
        "LINE_GATEWAY_URL": "http://127.0.0.1:8787"
      }
    }
  }
}
```

## Authentication / remote binding

By default the service binds to `127.0.0.1` without authentication.

If `LINE_GATEWAY_HOST` is changed to a non-loopback address, startup is refused unless `LINE_GATEWAY_TOKEN` is set.

Then use:

```text
Authorization: Bearer <token>
```

The same token is used by `line-mcp` via `LINE_GATEWAY_TOKEN`.

## Architecture

```text
LINE Chrome Extension
        │
        │ DOM / CDP
        ▼
ChromeLineAdapter
        │
        ▼
MessagingGateway
  ├─ serialized UI queue
  ├─ operations + idempotency
  └─ event bus
        │
        ├─ REST /v1
        ├─ SSE /v1/events
        └─ MCP /mcp

MCP stdio client
        │ stdin/stdout
        ▼
line-mcp thin proxy
        │ REST localhost
        ▼
MessagingGateway
```

## DOM strategy

The adapter avoids generated CSS module names wherever possible and targets observed semantic markers such as:

```text
button[aria-label="Go chatroom"]
div[data-is-dropzone="true"][data-mid]
[data-message-id]
[data-message-select-id]
[data-timestamp]
[data-is-message-text="true"]
textarea-ex[placeholder="Enter a message"]
```

LINE uses virtualized lists, so chat enumeration and history reads scroll and deduplicate by stable IDs instead of assuming the entire history exists in `document.body` at once.

## Security note

This project automates an already logged-in personal LINE client. Treat the gateway as sensitive local software. Do not expose it to a network without authentication and additional access controls appropriate to your environment.
