#!/usr/bin/env node
import { loadConfig } from './config.js';
import { MessagingGateway } from './core/gateway.js';
import { ChromeLineAdapter } from './line/chrome-adapter.js';
import { startApiServer } from './api/http.js';

const config = loadConfig();
const adapter = new ChromeLineAdapter({
  cdpUrl: config.cdpUrl,
  ...(config.extensionId ? { extensionId: config.extensionId } : {}),
  maxHistoryScrolls: config.maxHistoryScrolls
});
const gateway = new MessagingGateway(adapter);
const api = await startApiServer(gateway, config);

console.error(`[line-gateway] REST: ${api.address}/v1`);
console.error(`[line-gateway] MCP Streamable HTTP: ${api.address}/mcp`);
console.error(`[line-gateway] Events SSE: ${api.address}/v1/events`);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.error(`[line-gateway] ${signal}: shutting down`);
  await api.close().catch((error) => console.error('[line-gateway] shutdown error:', error));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal).finally(() => process.exit(0)));
}
