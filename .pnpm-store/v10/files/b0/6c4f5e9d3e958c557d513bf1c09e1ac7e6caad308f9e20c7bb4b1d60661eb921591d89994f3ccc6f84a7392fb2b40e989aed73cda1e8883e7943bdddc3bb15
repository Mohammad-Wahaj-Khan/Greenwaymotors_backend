import type { Config } from '../config/config';
/**
 * Creates a kysely-codegen command-line interface.
 */
export declare class Cli {
    #private;
    logLevel: "error" | "debug" | "silent" | "warn" | "info";
    generate(options: Config): Promise<string>;
    parseOptions(args: string[], options?: {
        config?: Record<string, unknown>;
        silent?: boolean;
    }): Record<string, unknown>;
    run(options?: {
        argv?: string[];
        config?: Record<string, unknown>;
    }): Promise<string>;
}
