import type { AuthContext } from '../../modules/auth/auth.types.js';
export declare function canReadLead(auth: AuthContext, lead: {
    assignedTo: string | null;
    customerId: string | null;
}): boolean;
export declare function canAssignLead(auth: AuthContext): boolean;
export declare function canReviewVehicle(auth: AuthContext): boolean;
export declare function canManageInventory(auth: AuthContext): boolean;
