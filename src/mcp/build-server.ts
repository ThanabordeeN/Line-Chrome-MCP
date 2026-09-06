import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpGateway } from './types.js';

function jsonResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>
  };
}

export function buildMcpServer(gateway: McpGateway): McpServer {
  const server = new McpServer({ name: 'line-chrome-mcp', version: '0.1.0' });

  server.registerTool(
    'line_get_status',
    {
      description: 'Get the LINE gateway, Chrome CDP, and active LINE page status.',
      inputSchema: z.object({})
    },
    async () => jsonResult(await gateway.status())
  );

  server.registerTool(
    'line_get_capabilities',
    {
      description: 'Get capabilities currently implemented by the active LINE adapter.',
      inputSchema: z.object({})
    },
    async () => jsonResult(await gateway.capabilities())
  );

  server.registerTool(
    'line_search_chats',
    {
      description: 'List or search LINE chats. Chat IDs returned here are used by message tools.',
      inputSchema: z.object({
        query: z.string().optional(),
        unread_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional()
      })
    },
    async ({ query, unread_only, limit }) => {
      const chats = await gateway.listChats({
        ...(query ? { query } : {}),
        ...(unread_only !== undefined ? { unreadOnly: unread_only } : {}),
        ...(limit ? { limit } : {})
      });
      return jsonResult({ chats });
    }
  );

  server.registerTool(
    'line_get_messages',
    {
      description: 'Read messages from a LINE chat. Use before as a cursor for older history.',
      inputSchema: z.object({
        chat_id: z.string().min(1),
        limit: z.number().int().min(1).max(500).optional(),
        before: z.string().optional()
      })
    },
    async ({ chat_id, limit, before }) => {
      const page = await gateway.getMessages(chat_id, {
        ...(limit ? { limit } : {}),
        ...(before ? { before } : {})
      });
      return jsonResult(page);
    }
  );

  server.registerTool(
    'line_send_message',
    {
      description: 'Queue a text message to a LINE chat. Returns an operation that can be polled with line_get_operation.',
      inputSchema: z.object({
        chat_id: z.string().min(1),
        text: z.string().min(1).max(10000),
        reply_to: z.string().optional(),
        idempotency_key: z.string().min(1).max(200).optional()
      })
    },
    async ({ chat_id, text, reply_to, idempotency_key }) => {
      const operation = await gateway.sendMessage({
        chatId: chat_id,
        text,
        ...(reply_to ? { replyTo: reply_to } : {}),
        ...(idempotency_key ? { idempotencyKey: idempotency_key } : {})
      });
      return jsonResult(operation);
    }
  );

  server.registerTool(
    'line_get_operation',
    {
      description: 'Get the current state and result of an asynchronous gateway operation.',
      inputSchema: z.object({ operation_id: z.string().min(1) })
    },
    async ({ operation_id }) => {
      const operation = await gateway.getOperation(operation_id);
      return jsonResult(operation ?? { error: 'OPERATION_NOT_FOUND', operation_id });
    }
  );

  return server;
}
