import type { Kysely } from 'kysely';
import type { DB, Json } from '../../generated/database.types.js';
interface AuditInput {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes: Json;
    ipAddress?: string;
}
export declare class RbacService {
    private readonly database;
    constructor(database: Kysely<DB>);
    listRoles(): Promise<{
        id: number;
        name: string;
        description: string | null;
        permissions: {
            id: number;
            code: string;
            description: string | null;
        }[];
    }[]>;
    listPermissions(): Promise<{
        code: string;
        description: string | null;
        id: number;
    }[]>;
    createRole(input: {
        name: string;
        description?: string | null;
    }, audit: Omit<AuditInput, 'entityId' | 'changes'>): Promise<{
        description: string | null;
        id: number;
        name: string;
    }>;
    updateRole(roleId: number, input: {
        name?: string;
        description?: string | null;
    }, audit: Omit<AuditInput, 'entityId' | 'changes'>): Promise<{
        description: string | null;
        id: number;
        name: string;
    }>;
    replaceRolePermissions(roleId: number, permissionIds: number[], audit: Omit<AuditInput, 'entityId' | 'changes'>): Promise<void>;
    replaceUserRoles(userId: string, roleIds: number[], audit: Omit<AuditInput, 'entityId' | 'changes'>): Promise<void>;
    private writeAudit;
}
export {};
