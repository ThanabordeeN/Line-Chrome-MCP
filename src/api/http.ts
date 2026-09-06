import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { GatewayError, asGatewayError } from '../core/errors.js';
import type { MessagingGateway } from '../core/gateway.js';
import type { GatewayConfig } from '../config.js';
import { buildMcpServer } from '../mcp/build-server.js';
import type { McpGateway } from '../mcp/types.js';
import { buildOpenApi } from './openapi.js';

interface ApiServer {
  close(): Promise<void>;
  address: string;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function problem(res: ServerResponse, error: GatewayError, instance: string): void {
  const payload = {
    type: `urn:line-chrome-mcp:problem:${error.code.toLowerCase().replaceAll('_', '-')}`,
    title: error.message,
    status: error.status,
    detail: error.message,
    instance,
    code: error.code
  };
  const body = JSON.stringify(payload);
  res.writeHead(error.status, {
    'content-type': 'application/problem+json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function bodyJson(req: IncomingMessage, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new GatewayError('REQUEST_TOO_LARGE', 'Request body exceeds 1 MB.', 413);
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('body must be an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new GatewayError('INVALID_JSON', 'Request body must be a valid JSON object.', 400);
  }
}

function bearer(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return undefined;
  return auth.slice('Bearer '.length);
}

function authorize(req: IncomingMessage, config: GatewayConfig): void {
  if (!config.token) return;
  if (bearer(req) !== config.token) throw new GatewayError('UNAUTHORIZED', 'A valid Bearer token is required.', 401);
}

function boolParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new GatewayError('INVALID_QUERY', `Invalid boolean value: ${value}`, 400);
}

function intParam(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) {
    throw new GatewayError('INVALID_QUERY', `Expected integer between 1 and ${max}.`, 400);
  }
  return parsed;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function validateRemoteSafety(config: GatewayConfig): void {
  if (!isLoopbackHost(config.host) && !config.token) {
    throw new Error('Refusing to bind LINE gateway to a non-loopback host without LINE_GATEWAY_TOKEN.');
  }
}

export async function startApiServer(gateway: MessagingGateway, config: GatewayConfig): Promise<ApiServer> {
  validateRemoteSafety(config);
  await gateway.start();

  const mcpGateway: McpGateway = {
    status: () => gateway.status(),
    capabilities: () => gateway.capabilities(),
    listChats: (options) => gateway.listChats(options),
    getMessages: (chatId, options) => gateway.getMessages(chatId, options),
    sendMessage: (input) => gateway.sendMessage(input),
    getOperation: (id) => gateway.getOperation(id)
  };
  const mcpHandler = toNodeHandler(createMcpHandler(() => buildMcpServer(mcpGateway)));

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, `http://${req.headers.host ?? `${config.host}:${config.port}`}`);

    try {
      if (url.pathname === '/mcp') {
        authorize(req, config);
        if (!req.method) throw new GatewayError('INVALID_REQUEST', 'HTTP method is required.', 400);
        await mcpHandler(
          req as unknown as Parameters<typeof mcpHandler>[0],
          res as unknown as Parameters<typeof mcpHandler>[1]
        );
        return;
      }

      if (url.pathname === '/openapi.json' && req.method === 'GET') {
        authorize(req, config);
        json(res, 200, buildOpenApi(config.port));
        return;
      }

      if (!url.pathname.startsWith('/v1/')) {
        throw new GatewayError('NOT_FOUND', 'Route not found.', 404);
      }
      authorize(req, config);

      if (url.pathname === '/v1/health' && req.method === 'GET') {
        json(res, 200, { status: 'ok', version: '0.1.0' });
        return;
      }

      if (url.pathname === '/v1/status' && req.method === 'GET') {
        json(res, 200, await gateway.status());
        return;
      }

      if (url.pathname === '/v1/capabilities' && req.method === 'GET') {
        json(res, 200, gateway.capabilities());
        return;
      }

      if (url.pathname === '/v1/chats' && req.method === 'GET') {
        const query = url.searchParams.get('q')?.trim() || undefined;
        const unreadOnly = boolParam(url.searchParams.get('unread'));
        const limit = intParam(url.searchParams.get('limit'), 50, 200);
        const chats = await gateway.listChats({
          ...(query ? { query } : {}),
          ...(unreadOnly !== undefined ? { unreadOnly } : {}),
          limit
        });
        json(res, 200, { data: chats });
        return;
      }

      const messagesMatch = url.pathname.match(/^\/v1\/chats\/([^/]+)\/messages$/);
      if (messagesMatch) {
        const chatId = decodeURIComponent(messagesMatch[1]!);
        if (req.method === 'GET') {
          const limit = intParam(url.searchParams.get('limit'), 50, 500);
          const before = url.searchParams.get('before')?.trim() || undefined;
          json(
            res,
            200,
            await gateway.getMessages(chatId, {
              limit,
              ...(before ? { before } : {})
            })
          );
          return;
        }

        if (req.method === 'POST') {
          const payload = await bodyJson(req);
          const text = typeof payload.text === 'string' ? payload.text : '';
          const replyTo = typeof payload.reply_to === 'string' ? payload.reply_to : undefined;
          const bodyKey = typeof payload.client_request_id === 'string' ? payload.client_request_id : undefined;
          const headerKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
          const idempotencyKey = headerKey || bodyKey;
          const operation = gateway.sendMessage({
            chatId,
            text,
            ...(replyTo ? { replyTo } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {})
          });
          json(res, 202, operation);
          return;
        }
      }

      const operationMatch = url.pathname.match(/^\/v1\/operations\/([^/]+)$/);
      if (operationMatch && req.method === 'GET') {
        const id = decodeURIComponent(operationMatch[1]!);
        const operation = gateway.getOperation(id);
        if (!operation) throw new GatewayError('OPERATION_NOT_FOUND', `Operation ${id} was not found.`, 404);
        json(res, 200, operation);
        return;
      }

      if (url.pathname === '/v1/events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        });
        res.write(': connected\n\n');
        const unsubscribe = gateway.events.subscribe((event) => {
          res.write(`id: ${event.id}\n`);
          res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
        keepAlive.unref?.();
        req.once('close', () => {
          unsubscribe();
          clearInterval(keepAlive);
        });
        return;
      }

      throw new GatewayError('NOT_FOUND', 'Route not found.', 404);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      problem(res, asGatewayError(error), url.pathname);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    address: `http://${config.host}:${config.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await gateway.close();
    }
  };
}
