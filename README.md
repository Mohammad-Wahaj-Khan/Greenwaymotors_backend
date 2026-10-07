# Green Way Motors API

The backend is an independent Express and TypeScript application. It exclusively owns PostgreSQL,
Redis, SQL migrations, server-side integrations, API contracts, and business rules.

## Development

```sh
cp .env.example .env
pnpm install
pnpm dev
```

Run local infrastructure with `docker compose up -d`. The API listens on port 4000; PostgreSQL is
published at port 55432 to avoid clashing with a host PostgreSQL installation. If a local API
process already uses port 4000, run `API_HOST_PORT=4100 docker compose up -d` instead.

## Database

The supplied SQL files are the schema source of truth. Run migrations and the idempotent seed from
the backend directory:

```sh
pnpm db:migrate
pnpm db:seed
pnpm db:types
pnpm db:types:check
```

`db:migrate` applies sequential backend-owned SQL migrations and records filenames in its
infrastructure-only `schema_migrations` table. It refuses a partial schema and the single-seller
transition refuses to silently reclassify dealer users or discard non-empty legacy import records.
Market visibility defaults to off: an active market and an active vehicle-market mapping must both
exist before a published, available vehicle appears in public search or detail responses. Public
vehicle requests require the `market` slug query parameter.

To create the first privileged account, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and a
unique `BOOTSTRAP_ADMIN_PASSWORD` of at least 16 characters, then explicitly set
`BOOTSTRAP_ADMIN_CONFIRM=CREATE_SUPER_ADMIN` and run `pnpm db:bootstrap-admin`. The script refuses
to run if a super admin already exists or the target email is already registered. In production,
also set `ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true` only for this operation, then remove the temporary
bootstrap variables. It does not seed a shared default password. Super admins must enroll in MFA
when required by the production login policy.

Adding another super admin requires the additional explicit
`BOOTSTRAP_ALLOW_ADDITIONAL_SUPER_ADMIN=true` opt-in; the target email must not already belong to
an account.

Database integration tests require `DATABASE_TEST_URL` and reject a target whose database name does
not end in `_test`. Copy `.env.test.example` for local test configuration.

## Quality

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm openapi:validate
```

`GreenWay_Backend_Master_Spec_v1.md` is the product and API roadmap. `openapi/openapi.yaml` documents implemented routes. Database SQL belongs in `database/`.

## Phase 2 and 3 API

Operational inventory, source and market administration, vehicle media, guest Get Quote leads, and staff CRM routes are available under `/api/v1`. The OpenAPI contract is served at `/api/docs/openapi.yaml`, with interactive Swagger UI at `/api/docs/` in development and test environments. API docs are disabled in production. Use the Swagger UI **Authorize** button with a staff access token for protected routes.

Media upload requires S3-compatible object storage. Configure `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` in `.env`; the upload flow issues a presigned PUT URL and checks the uploaded object before attaching media to a vehicle. `TRUST_PROXY_HOPS` must match the number of trusted reverse proxies so the guest lead rate limit uses the correct client IP.

The Phase 2–5 schema changes are in migrations `006_inventory_lead_operations.sql` and `007_commercial_workflow.sql`; do not rewrite migrations already applied in a shared database. Apply migrations, seed permissions, and regenerate Kysely types before starting the API. Guest leads and high-risk commercial commands use idempotency keys. Quote acceptance atomically accepts its current version, reserves the exact vehicle, marks the lead won, and creates a Deal. Deal completion marks that same vehicle sold in the same transaction.

## Phase 4 and 5 commercial APIs

Swagger covers quote versioning and lifecycle, reservation, Deal conversion and lifecycle, and fulfillment task routes. Quote send records that staff dispatched the current version; customer communication remains an off-platform action. Supplier confirmation is also recorded internally after off-platform communication. Quote totals use integer minor units and server-side calculations. Cost, margin, source, and internal notes are permission-filtered. Deal progression is `source_confirming` → `source_confirmed` → `processing` → `ready_for_delivery` → `completed`, with `cancelled` as a reasoned alternate terminal state.

## Phase 6 runbook and release gates

Use Node.js 22+, Corepack/pnpm 10, and Docker Desktop. Copy `.env.example` to `.env`, start local PostgreSQL/Redis/MinIO/Mailpit with `docker compose up -d`, then run `corepack pnpm install --frozen-lockfile`, `corepack pnpm db:migrate`, `corepack pnpm db:seed`, and `corepack pnpm dev`. API port defaults to 4000; PostgreSQL is exposed on 55432. The raw OpenAPI contract is `/api/docs/openapi.yaml`; Swagger UI is `/api/docs/` outside production.

Set a separately managed `DATA_ENCRYPTION_KEY` (32+ characters) and `REDIS_REQUIRED=true` in production. Configure SMTP and S3-compatible credentials from `.env.example`; set `TRUST_PROXY_HOPS` to the real ingress chain. The API starts the PostgreSQL outbox email worker and stops it during graceful shutdown. Never point `DATABASE_TEST_URL` at shared data: tests require an isolated database ending in `_test` and drop/recreate its public schema.

Role boundaries: `super_admin` has all seeded permissions; `admin` cannot modify RBAC or access costing; `inventory_manager` owns inventory/source/catalog/market operations; `sales_manager` has team CRM and financial analytics; `sales_agent` is assignment-scoped; `content_manager` has CMS/catalog only; `finance` has financial/cost reads only. Privileged roles require TOTP MFA in production. SQL schema is migrations 001-009; seed 006 defines the Phase 6 grants.

Run `corepack pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `openapi:validate`, and `db:types:check`. See `docs/backend-handover.md` and `docs/phase6-endpoint-audit.md` for the readiness assessment and explicit deferrals. Privileged staff MFA, customer-safe quote PDF generation/storage, and RFC 4180 CSV import are implemented. XLSX parsing remains deferred. Production deployment must define database backups/PITR and complete a restore drill, alerting/error tracking, and load testing.
