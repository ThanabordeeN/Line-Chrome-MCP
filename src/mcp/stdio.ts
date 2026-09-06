#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildMcpServer } from './build-server.js';
import { RestGatewayClient } from './gateway-client.js';

const baseUrl = process.env.LINE_GATEWAY_URL?.trim() || 'http://127.0.0.1:8787';
const token = process.env.LINE_GATEWAY_TOKEN?.trim() || undefined;
const client = new RestGatewayClient(baseUrl, token);

try {
  await serveStdio(() => buildMcpServer(client));
} catch (error) {
  console.error('[line-mcp] fatal:', error);
  process.exitCode = 1;
}
