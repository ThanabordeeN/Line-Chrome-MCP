export function buildOpenApi(port: number) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Line Chrome MCP Gateway API',
      version: '0.1.0',
      description: 'Local REST API for the LINE Chrome adapter. MCP is exposed separately at /mcp.'
    },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    paths: {
      '/v1/health': { get: { summary: 'Process health' } },
      '/v1/status': { get: { summary: 'LINE/CDP status' } },
      '/v1/capabilities': { get: { summary: 'Adapter capabilities' } },
      '/v1/chats': { get: { summary: 'List/search chats' } },
      '/v1/chats/{chat_id}/messages': {
        get: { summary: 'Read chat messages' },
        post: { summary: 'Queue a text message' }
      },
      '/v1/operations/{operation_id}': { get: { summary: 'Get operation state' } },
      '/v1/events': { get: { summary: 'SSE gateway event stream' } }
    }
  };
}
