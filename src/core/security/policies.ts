import type { AuthContext } from '../../modules/auth/auth.types.js';

export function canReadLead(
  auth: AuthContext,
  lead: { assignedTo: string | null; customerId: string | null }
): boolean {
  return (
    auth.permissions.has('lead.read_all') ||
    (auth.permissions.has('lead.read_assigned') && lead.assignedTo === auth.user.id) ||
    lead.customerId === auth.user.id
  );
}

export function canAssignLead(auth: AuthContext): boolean {
  return auth.permissions.has('lead.assign');
}

export function canReviewVehicle(auth: AuthContext): boolean {
  return auth.permissions.has('vehicle.review');
}

export function canManageInventory(auth: AuthContext): boolean {
  return auth.permissions.has('vehicle.create') || auth.permissions.has('vehicle.update');
}
