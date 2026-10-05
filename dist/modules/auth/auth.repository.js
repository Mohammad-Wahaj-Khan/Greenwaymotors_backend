export const userColumns = [
    'id',
    'user_type',
    'email',
    'full_name',
    'phone',
    'whatsapp',
    'country_id',
    'city',
    'preferred_contact',
    'status',
    'email_verified_at'
];
export async function findUserById(database, id) {
    return database.selectFrom('users').select(userColumns).where('id', '=', id).executeTakeFirst();
}
export async function findUserForLogin(database, email) {
    return database
        .selectFrom('users')
        .select([...userColumns, 'password_hash'])
        .where('email', '=', email)
        .executeTakeFirst();
}
export async function findUserPermissions(database, userId) {
    const rows = await database
        .selectFrom('user_roles')
        .innerJoin('role_permissions', 'role_permissions.role_id', 'user_roles.role_id')
        .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
        .select('permissions.code')
        .where('user_roles.user_id', '=', userId)
        .execute();
    return rows.map((row) => row.code);
}
//# sourceMappingURL=auth.repository.js.map