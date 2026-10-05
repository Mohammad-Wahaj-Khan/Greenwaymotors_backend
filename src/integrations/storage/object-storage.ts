import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Environment } from '../../config/env.js';

export interface ObjectStorage {
  presignPut(key: string, mimeType: string, sizeBytes: number): Promise<string>;
  head(key: string): Promise<{ mimeType: string | undefined; sizeBytes: number | undefined }>;
  publicUrl(key: string): string;
}

export function createObjectStorage(environment: Environment): ObjectStorage {
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
    presignPut(key, mimeType, sizeBytes) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: mimeType,
          ContentLength: sizeBytes
        }),
        { expiresIn: 900 }
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
