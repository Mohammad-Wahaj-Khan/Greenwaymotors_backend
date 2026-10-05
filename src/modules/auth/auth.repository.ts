import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../generated/database.types.js';

export type DatabaseExecutor = Kysely<DB> | Transaction<DB>;

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
] as const;

export async function findUserById(database: DatabaseExecutor, id: string) {
  return database.selectFrom('users').select(userColumns).where('id', '=', id).executeTakeFirst();
}

export async function findUserForLogin(database: DatabaseExecutor, email: string) {
  return database
    .selectFrom('users')
    .select([...userColumns, 'password_hash'])
    .where('email', '=', email)
    .executeTakeFirst();
}

export async function findUserPermissions(
  database: DatabaseExecutor,
  userId: string
): Promise<string[]> {
  const rows = await database
    .selectFrom('user_roles')
    .innerJoin('role_permissions', 'role_permissions.role_id', 'user_roles.role_id')
    .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
    .select('permissions.code')
    .where('user_roles.user_id', '=', userId)
    .execute();
  return rows.map((row) => row.code);
}
