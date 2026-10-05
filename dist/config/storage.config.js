export function createStorageConfig(environment) {
    return {
        endpoint: environment.S3_ENDPOINT,
        region: environment.S3_REGION,
        bucket: environment.S3_BUCKET,
        accessKeyId: environment.S3_ACCESS_KEY_ID,
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY
    };
}
//# sourceMappingURL=storage.config.js.map