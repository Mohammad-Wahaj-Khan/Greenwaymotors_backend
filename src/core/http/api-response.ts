import type { Response } from 'express';
import { getRequestContext } from './request-context.js';
import { validationError } from '../errors/http-errors.js';
import { z } from 'zod';

export function sendData(response: Response, data: unknown, status = 200): void {
  response.status(status).json({ data, meta: { requestId: getRequestContext()?.requestId } });
}

export function sendPage(
  response: Response,
  data: unknown[],
  limit: number,
  nextCursor: string | null
): void {
  response.json({
    data,
    meta: {
      requestId: getRequestContext()?.requestId,
      pagination: { limit, nextCursor, hasMore: nextCursor !== null }
    }
  });
}

export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw validationError(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

export const uuid = z.uuid();
export function parseUuid(value: unknown): string {
  return parseInput(uuid, value);
}

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  q: z.string().trim().max(100).optional()
});

export function decodePageCursor(
  cursor: string | undefined
): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parsed = z.object({ createdAt: z.iso.datetime(), id: uuid }).parse(value);
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw validationError('cursor is invalid.');
  }
}

export function encodePageCursor(row: { created_at: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id })
  ).toString('base64url');
}
