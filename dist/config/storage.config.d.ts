import type { Environment } from './env.js';
export declare function createStorageConfig(environment: Environment): {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
};
