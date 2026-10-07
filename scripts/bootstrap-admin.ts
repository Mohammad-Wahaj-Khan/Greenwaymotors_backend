import { Pool } from 'pg';
import { z } from 'zod';
import { loadEnvironment } from '../src/config/env.js';
import { hashPassword } from '../src/core/auth/password.js';

const environment = loadEnvironment();
const email = z
  .email()
  .max(320)
  .parse(process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@gmail.com');
const fullName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .parse(process.env.BOOTSTRAP_ADMIN_NAME ?? 'Green Way Motors Admin');
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const allowAdditionalSuperAdmin = process.env.BOOTSTRAP_ALLOW_ADDITIONAL_SUPER_ADMIN === 'true';

if (process.env.BOOTSTRAP_ADMIN_CONFIRM !== 'CREATE_SUPER_ADMIN') {
  throw new Error(
    'Set BOOTSTRAP_ADMIN_CONFIRM=CREATE_SUPER_ADMIN to authorize this one-time action.'
  );
}
if (
  environment.NODE_ENV === 'production' &&
  process.env.ALLOW_PRODUCTION_ADMIN_BOOTSTRAP !== 'true'
) {
  throw new Error('Production bootstrap requires ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true.');
}
if (!password || password.length < 16 || password.length > 256) {
  throw new Error('Set BOOTSTRAP_ADMIN_PASSWORD to a unique password of at least 16 characters.');
}
if (password === 'admin123') {
  throw new Error('The default password admin123 is not allowed for a privileged account.');
}

const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS
});

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('green-way-motors-admin-bootstrap'))"
    );

    const existingSuperAdmin = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'super_admin'
       LIMIT 1`
    );
    if (existingSuperAdmin.rowCount && !allowAdditionalSuperAdmin) {
      throw new Error(
        'A super_admin account already exists; set BOOTSTRAP_ALLOW_ADDITIONAL_SUPER_ADMIN=true to explicitly add another.'
      );
    }

    const role = await client.query<{ id: number }>(
      `SELECT id FROM roles WHERE name = 'super_admin' LIMIT 1`
    );
    if (!role.rows[0]) {
      throw new Error('The super_admin role is missing. Run database migrations and seeds first.');
    }

    const assignedPermissions = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM role_permissions
       WHERE role_id = $1`,
      [role.rows[0].id]
    );
    if (Number(assignedPermissions.rows[0]?.count ?? 0) === 0) {
      throw new Error('The super_admin role has no permissions. Run database seeds first.');
    }

    const existingUser = await client.query(`SELECT 1 FROM users WHERE email = $1 LIMIT 1`, [
      email.toLowerCase()
    ]);
    if (existingUser.rowCount) {
      throw new Error('That email already belongs to an account; bootstrap will not modify it.');
    }

    const user = await client.query<{ id: string }>(
      `INSERT INTO users (user_type, email, password_hash, full_name)
       VALUES ('staff', $1, $2, $3)
       RETURNING id`,
      [email.toLowerCase(), await hashPassword(password), fullName]
    );
    if (!user.rows[0]) {
      throw new Error('The super_admin account was not created.');
    }
    await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
      user.rows[0].id,
      role.rows[0].id
    ]);
    await client.query('COMMIT');
    process.stdout.write(`Created the one-time super_admin account for ${email.toLowerCase()}.\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
