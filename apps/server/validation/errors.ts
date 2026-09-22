export class DomainError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'DomainError';
  }
}

export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new DomainError(status, code, message, details);
}
