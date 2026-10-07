import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../../src/config/env.js';
import { createObjectStorage } from '../../src/integrations/storage/object-storage.js';

const environment = parseEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://greenway:greenway@localhost:5432/greenway',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  COOKIE_DOMAIN: 'localhost',
  ACCESS_TOKEN_PRIVATE_KEY: 'private-key-for-tests-12345678901234567890',
  ACCESS_TOKEN_PUBLIC_KEY: 'public-key-for-tests-12345678901234567890',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '30',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'greenway',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  MAIL_FROM: 'noreply@example.test',
  MAIL_PROVIDER: 'mailpit',
  STORAGE_PROVIDER: 'cloudinary',
  CLOUDINARY_URL: 'cloudinary://test-key:test-secret@demo-cloud'
});

afterEach(() => vi.unstubAllGlobals());

describe('Cloudinary object storage', () => {
  it('returns a signed multipart upload instruction without exposing the API secret', async () => {
    const storage = createObjectStorage(environment);
    const instruction = await storage.createUpload(
      'vehicle-media/staff-1/asset.jpg',
      'image/jpeg',
      1234
    );
    const fields = instruction.fields!;
    const signed = `overwrite=false&public_id=vehicle-media/staff-1/asset&timestamp=${fields.timestamp}test-secret`;

    expect(instruction.method).toBe('POST');
    expect(instruction.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    expect(instruction.headers).toEqual({});
    expect(fields.api_key).toBe('test-key');
    expect(fields.signature).toBe(createHash('sha1').update(signed).digest('hex'));
    expect(JSON.stringify(instruction)).not.toContain('test-secret');
  });

  it('checks uploaded Cloudinary metadata and builds its public delivery URL', async () => {
    const storage = createObjectStorage(environment);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          public_id: 'vehicle-media/staff-1/asset',
          resource_type: 'image',
          format: 'jpg',
          bytes: 1234
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(storage.head('vehicle-media/staff-1/asset.jpg', 'image/jpeg')).resolves.toEqual({
      mimeType: 'image/jpeg',
      sizeBytes: 1234
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/resources/image/upload/vehicle-media/staff-1/asset'
    );
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('Authorization')).toMatch(/^Basic /);
    expect(storage.publicUrl('vehicle-media/staff-1/asset.jpg', 'image/jpeg')).toBe(
      'https://res.cloudinary.com/demo-cloud/image/upload/vehicle-media/staff-1/asset.jpg'
    );
  });
});
