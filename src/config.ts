export interface GatewayConfig {
  cdpUrl: string;
  extensionId?: string;
  host: string;
  port: number;
  token?: string;
  maxHistoryScrolls: number;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function int(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(): GatewayConfig {
  const extensionId = optional('LINE_EXTENSION_ID');
  const token = optional('LINE_GATEWAY_TOKEN');
  return {
    cdpUrl: optional('LINE_CDP_URL') ?? 'http://127.0.0.1:9222',
    ...(extensionId ? { extensionId } : {}),
    host: optional('LINE_GATEWAY_HOST') ?? '127.0.0.1',
    port: int('LINE_GATEWAY_PORT', 8787),
    ...(token ? { token } : {}),
    maxHistoryScrolls: int('LINE_MAX_HISTORY_SCROLLS', 60)
  };
}
