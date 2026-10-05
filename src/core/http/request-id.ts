import { randomUUID } from 'node:crypto';

const requestIdPattern = /^[A-Za-z0-9_-]{8,128}$/;

export function resolveRequestId(value: string | undefined): string {
  return value && requestIdPattern.test(value) ? value : randomUUID();
}
