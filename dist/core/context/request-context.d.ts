export interface RequestContext {
    requestId: string;
    ip?: string;
}
export declare function runWithRequestContext<T>(context: RequestContext, callback: () => T): T;
export declare function getRequestContext(): RequestContext | undefined;
