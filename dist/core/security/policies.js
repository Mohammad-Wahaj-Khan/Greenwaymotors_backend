export function canReadLead(auth, lead) {
    return (auth.permissions.has('lead.read_all') ||
        (auth.permissions.has('lead.read_assigned') && lead.assignedTo === auth.user.id) ||
        lead.customerId === auth.user.id);
}
export function canAssignLead(auth) {
    return auth.permissions.has('lead.assign');
}
export function canReviewVehicle(auth) {
    return auth.permissions.has('vehicle.review');
}
export function canManageInventory(auth) {
    return auth.permissions.has('vehicle.create') || auth.permissions.has('vehicle.update');
}
//# sourceMappingURL=policies.js.map