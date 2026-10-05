import type { Environment } from './env.js';
export declare function createAppConfig(environment: Environment): {
    readonly environment: "development" | "test" | "production";
    readonly port: number;
    readonly webOrigin: string;
    readonly cookieDomain: string;
    readonly logLevel: "error" | "fatal" | "warn" | "info" | "debug" | "trace";
};
