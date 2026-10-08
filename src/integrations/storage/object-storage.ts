import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Environment } from '../../config/env.js';

export interface ObjectStorage {
  upload(
    key: string,
    mimeType: string,
    sizeBytes: number,
    content: Uint8Array
  ): Promise<void>;
  head(
    key: string,
    expectedMimeType: string
  ): Promise<{ mimeType: string | undefined; sizeBytes: number | undefined }>;
  publicUrl(key: string, mimeType: string): string;
}

export function createObjectStorage(environment: Environment): ObjectStorage {
  if (environment.STORAGE_PROVIDER === 'cloudinary') return createCloudinaryStorage(environment);

  const client = new S3Client({
    region: environment.S3_REGION,
    endpoint: environment.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: environment.S3_ACCESS_KEY_ID,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY
    }
  });
  const bucket = environment.S3_BUCKET;
  const base = environment.S3_ENDPOINT.replace(/\/$/, '');
  return {
    async upload(key, mimeType, sizeBytes, content) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: mimeType,
          ContentLength: sizeBytes
        })
      );
    },
    async head(key) {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { mimeType: result.ContentType, sizeBytes: result.ContentLength };
    },
    publicUrl(key) {
      return `${base}/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
    }
  };
}

function createCloudinaryStorage(environment: Environment): ObjectStorage {
  const parsed = new URL(environment.CLOUDINARY_URL!);
  const cloudName = parsed.hostname;
  const apiKey = decodeURIComponent(parsed.username);
  const apiSecret = decodeURIComponent(parsed.password);
  const base = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}`;

  const resourceType = (mimeType: string) => (mimeType === 'video/mp4' ? 'video' : 'image');
  const publicId = (key: string) => key.replace(/\.[^.]+$/, '');

  return {
    async upload(key, mimeType, _sizeBytes, content) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const id = publicId(key);
      const signedParameters = `overwrite=false&public_id=${id}&timestamp=${timestamp}`;
      const signature = createHash('sha1').update(`${signedParameters}${apiSecret}`).digest('hex');
      const form = new FormData();
      form.set('api_key', apiKey);
      form.set('timestamp', timestamp);
      form.set('public_id', id);
      form.set('overwrite', 'false');
      form.set('signature', signature);
      form.set(
        'file',
        new Blob([content], { type: mimeType }),
        key.split('/').at(-1) ?? 'upload'
      );

      const response = await fetch(`${base}/${resourceType(mimeType)}/upload`, {
        body: form,
        method: 'POST'
      });
      if (!response.ok) throw new Error('Cloudinary upload failed.');
    },
    async head(key, expectedMimeType) {
      const type = resourceType(expectedMimeType);
      const id = publicId(key);
      const encodedId = id.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${base}/resources/${type}/upload/${encodedId}`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
        }
      });
      if (response.status === 404) return { mimeType: undefined, sizeBytes: undefined };
      if (!response.ok)
        throw new Error(`Cloudinary resource verification failed (${response.status}).`);
      const asset = (await response.json()) as {
        public_id?: string;
        resource_type?: string;
        format?: string;
        bytes?: number;
      };
      const expectedFormats: Record<string, string[]> = {
        'image/jpeg': ['jpg', 'jpeg'],
        'image/png': ['png'],
        'image/webp': ['webp'],
        'video/mp4': ['mp4']
      };
      const valid =
        asset.public_id === id &&
        asset.resource_type === type &&
        expectedFormats[expectedMimeType]?.includes(asset.format ?? '') === true;
      return {
        mimeType: valid ? expectedMimeType : undefined,
        sizeBytes: typeof asset.bytes === 'number' ? asset.bytes : undefined
      };
    },
    publicUrl(key, mimeType) {
      const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
      const id = publicId(key);
      return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${resourceType(mimeType)}/upload/${id
        .split('/')
        .map(encodeURIComponent)
        .join('/')}.${extension}`;
    }
  };
}
