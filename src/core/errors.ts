export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function asGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  return new GatewayError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
}
