import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Environment } from '../../config/env.js';

export interface ObjectStorage {
  createUpload(
    key: string,
    mimeType: string,
    sizeBytes: number
  ): Promise<{
    uploadUrl: string;
    method: 'PUT' | 'POST';
    headers: Record<string, string>;
    fields?: Record<string, string>;
  }>;
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
    async createUpload(key, mimeType, sizeBytes) {
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: mimeType,
          ContentLength: sizeBytes
        }),
        { expiresIn: 900 }
      );
      return { uploadUrl, method: 'PUT', headers: { 'Content-Type': mimeType } };
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
    createUpload(key, mimeType) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const id = publicId(key);
      const signedParameters = `overwrite=false&public_id=${id}&timestamp=${timestamp}`;
      const signature = createHash('sha1').update(`${signedParameters}${apiSecret}`).digest('hex');
      return Promise.resolve({
        uploadUrl: `${base}/${resourceType(mimeType)}/upload`,
        method: 'POST',
        headers: {},
        fields: {
          api_key: apiKey,
          timestamp,
          public_id: id,
          overwrite: 'false',
          signature
        }
      });
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
