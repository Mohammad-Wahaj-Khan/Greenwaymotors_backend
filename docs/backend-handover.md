# Backend handover and readiness

## Architecture

The API is an Express 5 modular monolith. `src/app.ts` composes routes; modules under `src/modules/` own HTTP validation and business workflows; Kysely uses generated PostgreSQL types; SQL in `database/migrations/` is authoritative. `src/server.ts` starts HTTP, PostgreSQL, Redis integration, and the PostgreSQL outbox worker. There is no supplier/dealer account or external inventory API.

Core workflows include market-scoped public inventory; internal sources and costing; guest leads; assigned/team CRM and follow-ups; immutable quote versions; durable idempotent quote/deal commands; reservation row locks and unique active-vehicle constraints; Deal snapshots and fulfillment tasks. Quote acceptance and deal completion are transactional against the exact vehicle. Public/customer responses use separate projections.

## Migrations and running

Use Node.js 22+, Corepack/pnpm 10, and Docker Compose. Start services with `docker compose up -d`, copy `.env.example` to `.env`, then run `corepack pnpm install --frozen-lockfile`, `corepack pnpm db:migrate`, `corepack pnpm db:seed`, and `corepack pnpm dev`. Swagger UI is `/api/docs/` and the source contract is `/api/docs/openapi.yaml` in development/test only. The current schema is migration 001 through 009. Seeds may be rerun. Regenerate and verify types with `db:types` and `db:types:check` after schema changes.

For PostgreSQL tests set `DATABASE_TEST_URL` to a disposable database whose name ends `_test`. Test suites drop/recreate its `public` schema. The Phase 6 verification used a dedicated local PostgreSQL 17 cluster, separate from the user's running development API and database.

## Permission matrix

| Role                | Main access                                                                                                            | Explicit restrictions                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `super_admin`       | All seeded permissions, including RBAC and all cost/financial data                                                     | TOTP MFA is enforced before privileged production routes; recovery codes are single-use.                                   |
| `admin`             | Staff/customer administration, operational inventory/market/source, CRM, CMS, dashboards, non-financial reports, audit | No RBAC mutation or costing/margin permissions by default; may only create ordinary sales/content staff through staff API. |
| `inventory_manager` | Sources, markets, catalog, vehicle lifecycle/media/history/import                                                      | No CRM/customer access or cost read unless separately granted.                                                             |
| `sales_manager`     | Team leads/quotes/deals, dashboard, financial analytics, audit, inventory read                                         | Does not administer staff, roles, inventory sources, or CMS.                                                               |
| `sales_agent`       | Assigned leads/quotes/deals, own follow-ups/notifications                                                              | No team-wide CRM, finance, costing, inventory or RBAC access.                                                              |
| `content_manager`   | CMS and catalog, public inventory read, own notifications                                                              | No sales/CRM or cost/margin access.                                                                                        |
| `finance`           | Financial analytics, deal and quote cost read                                                                          | No inventory, staff, role, CMS or CRM mutation access.                                                                     |

`database/seeds/006_phase6_permissions.sql` is repeatable. `admin` intentionally does not receive `rbac.manage`, `vehicle.cost.read`, or `quote.cost.read`. No `operations` role was present, so one was not added.

## Security and background processing

Passwords use Argon2id. Access tokens are short-lived and checked against current account state. Refresh tokens are hashed at rest, rotated on use, and revocable. Privileged staff use AES-GCM encrypted TOTP secrets, short-lived login challenges, one-time hashed recovery codes, and an MFA-satisfied JWT claim; production requests for `super_admin`, `admin`, `finance`, and `sales_manager` are blocked until MFA is complete. Logout-all, reset/change-password session revocation, trusted-origin refresh checks, HTTP-only refresh cookies, strict configured CORS, Helmet, body limits, request IDs, and neutral password-reset/verification responses are in place. Rate limits use Redis when required; production configuration refuses to run with in-memory-only rate limiting.

Guest lead, quote send/accept, deal conversion/completion, and reservation commands have database-backed idempotency or database uniqueness/locking protection. The email outbox stores only AES-GCM ciphertext for verification/reset secrets, claims work with `FOR UPDATE SKIP LOCKED`, retries failures with bounded backoff, retains completed payloads, and stops during graceful shutdown. Outbox and idempotency records have no automatic deletion. Audit APIs are read-only, returned secret-like fields are redacted, and migration 008 adds an append-only database trigger.

## Verification completed

- Migrations 001-009 applied to a fresh isolated PostgreSQL database.
- Seeds applied twice to the isolated verification database; integration setup also reapplies them successfully.
- Kysely generated 45 table interfaces from the isolated database.
- Full test suite passed: 30 tests across 6 files, including MFA route gating/recovery, CSV draft imports, safe PDF projection and scope, outbox payload retention, and commercial completion.
- `lint`, `typecheck`, `build`, `format:check`, OpenAPI validation (170 paths), and `db:types:check` passed.

## Production readiness and explicit blockers

The backend is suitable for frontend integration after the current test/build gates pass, but it is **not production-ready** until the following are addressed:

1. **XLSX imports**: JSON and CSV import are implemented; XLSX parsing remains deferred.
2. **Notifications**: lead creation/assignment, quote send/accept, and deal create/cancel/complete emit transactional notifications. Coverage remains event-specific rather than exhaustive.
3. **Operations**: configure database encryption/TLS, managed secrets, point-in-time backups, and complete a restore drill. Add deployment monitoring/error tracking/alerting and run load tests before public launch. These infrastructure checks cannot be proved by local code tests.
4. **Market suggestion**: `/market-context` honors an explicit client market and provides a deterministic active-market fallback. IP geolocation is not configured.
5. **Data retention**: per user direction, completed and failed outbox events and idempotency records are retained without automatic deletion. Monitor storage growth and protect encryption keys and backups.

No payment/checkout, supplier portal/API, vendor account, shipment tracking, or analytics warehouse is required for V1.
