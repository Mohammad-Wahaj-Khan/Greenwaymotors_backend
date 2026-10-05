# GreenWay Motors — Backend Master Specification v1.0

**Status:** Authoritative implementation specification  
**Date:** 2026-10-05  
**Architecture:** Modular monolith, REST API `/api/v1`, PostgreSQL, Express 5 + TypeScript, Kysely  
**Purpose:** Backend handover and implementation contract for the complete GreenWay Motors global car-sales lead, quotation, sourcing and deal platform.

---

## 1. Authoritative Product Model

GreenWay Motors is **not a dealer marketplace**. Vendors/suppliers have no account, portal, login, API access, inventory-management access, lead access, or customer interaction through this system.

Vendor information reaches GreenWay Motors **off-platform**. Internal GreenWay staff enter and maintain vehicles through the Admin Portal. A vendor is represented only as an internal `inventory_source` used for sourcing, cost and operational records.

The software has three human actor classes:

1. **Visitor / buyer** — browses eligible inventory and submits Get-a-Quote requests. Login is not required for the primary conversion journey.
2. **Customer account (optional)** — buyer account for favorites, saved searches, request history and notifications.
3. **Internal staff** — inventory, sales, management, content, finance and super-admin roles operating the Admin Portal.

Primary business flow:

```text
OFF-PLATFORM VENDOR/SOURCE
        ↓
INTERNAL INVENTORY TEAM
        ↓
ADMIN: create exact vehicle + source + internal cost + market eligibility
        ↓
PUBLISH
        ↓
PUBLIC WEBSITE: country context → eligible inventory → vehicle detail
        ↓
GET A QUOTE (guest or customer)
        ↓
LEAD
        ↓
SALES ASSIGNMENT → CONTACT → QUALIFICATION
        ↓
INTERNAL COSTING → VERSIONED CUSTOMER QUOTE
        ↓
NEGOTIATION
   ┌────┴────┐
 LOST       WON
             ↓
           DEAL
             ↓
CONFIRM/SOURCE VEHICLE OFF-PLATFORM
             ↓
FULFILLMENT / DOCUMENTATION / DELIVERY
             ↓
          COMPLETED
```

### Non-negotiable invariants

- No vendor-facing APIs.
- No public vendor identity or vendor contact details.
- No public vehicle price.
- Vendor/source cost, margin, quote internals and sourcing notes are staff-only.
- Public inventory is exact vehicle inventory, not merely generic model advertisements.
- Vehicle visibility is controlled by **destination market eligibility**, not simply stock country.
- `stock_country` means where the physical vehicle currently is.
- `market/destination country` means where the vehicle is allowed to be marketed/sold.
- A single exact vehicle may be eligible for multiple destination markets until reserved/sold/withdrawn.
- Lead, Quote and Deal are separate first-class concepts.
- Public clients never submit trusted internal IDs, costs, margins, source IDs, snapshots, statuses or assignment fields.
- Server derives and snapshots authoritative data.
- Sensitive changes are audited.

---

## 2. Existing Backend Takeover Assessment

### Keep

The existing repository has a sound foundation and should be evolved rather than rewritten:

- Express 5 + TypeScript strict mode.
- PostgreSQL as canonical datastore.
- SQL migrations as schema source of truth.
- Kysely typed query layer.
- Zod request validation.
- JWT access token + rotating refresh-session design.
- Argon2 password hashing.
- Redis support for rate limits/idempotency/jobs.
- request IDs, Pino logging, Helmet, CORS, centralized errors.
- health endpoints.
- current auth implementation.
- current public catalog/vehicle reads as a starting point.
- current RBAC foundation.
- `002_single_seller_model.sql` direction: dealer model removed and `inventory_sources` introduced.

### Change / expand

The old database/blueprint was originally dealer-marketplace oriented and later partially corrected. The complete implementation must now add:

- market/country configuration and explicit vehicle-market eligibility;
- admin inventory CRUD (not dealer CRUD);
- inventory source CRUD;
- internal acquisition/vendor cost fields with currency;
- structured lead qualification;
- versioned quotes and quote line items;
- negotiation/quote lifecycle;
- deals after a won lead;
- vehicle reservation/sale protection;
- sourcing/fulfillment tracking;
- CMS/content/SEO APIs;
- dashboards/reporting;
- internal staff management;
- uploads/media completion workflow;
- optional customer features;
- complete OpenAPI contract.

### Remove permanently

Do not restore or implement:

- dealer registration;
- dealer users;
- dealer documents/KYC;
- dealer portal;
- dealer membership/tenant isolation;
- dealer vehicle CRUD;
- dealer CSV imports as an external dealer feature;
- dealer lead routing;
- dealer public profile/contact exposure.

---

## 3. Architecture

Use a **modular monolith**. Microservices are unnecessary for the initial product and would slow handover.

```text
Customer Website ─┐
                  ├── HTTPS/JSON ──> Express API ──> PostgreSQL
Admin Portal ─────┘                    │     │
                                      │     ├── Redis (rate limits, idempotency, queues)
                                      │     ├── S3-compatible object storage
                                      │     └── Email/notification providers
                                      └── background worker(s)
```

Recommended modules:

```text
auth
users
staff-rbac
countries
markets
catalog
inventory-sources
vehicles
vehicle-markets
uploads
customers
favorites
saved-searches
leads
lead-activities
followups
quotes
deals
fulfillment
notifications
cms
analytics
audit
system
```

### API conventions

- Business base path: `/api/v1`.
- Liveness/readiness outside business prefix: `/health/live`, `/health/ready`.
- JSON uses camelCase; DB uses snake_case.
- UTC ISO-8601 timestamps.
- Monetary values are stored as integer minor units where currency supports it; never floating point.
- Currency is ISO-4217 code (`USD`, `JPY`, `PKR`, etc.).
- Large collections use opaque cursor pagination.
- Mutation fields are strict/allowlisted.
- Error responses use `application/problem+json`.
- State transitions use explicit command endpoints where business semantics matter.
- OpenAPI is canonical and updated in the same PR as route changes.

Standard success envelope:

```json
{
  "data": {},
  "meta": { "requestId": "req_..." }
}
```

Collection envelope:

```json
{
  "data": [],
  "meta": {
    "requestId": "req_...",
    "pagination": { "limit": 25, "nextCursor": null, "hasMore": false }
  }
}
```

---

## 4. Required Database Model Amendments

The existing schema remains a base, but the following changes are required before feature implementation is considered complete.

### 4.1 Users

Keep `users`, sessions, tokens, roles, permissions and role mappings.

Recommended user types remain:

```text
customer
staff
```

Guest quote requests do not require a `users` row.

### 4.2 Countries and Markets

`countries` is geographic reference data. Add a first-class `markets` table because "country exists" and "GreenWay actively operates this sales market" are different concepts.

Recommended `markets`:

```text
id UUID PK
country_id FK countries UNIQUE
status active|inactive
slug
currency_code
locale
sales_email
sales_phone
sales_whatsapp
seo_title
seo_description
created_at
updated_at
```

Optional later: languages, destination ports, market-specific fees/taxes.

### 4.3 Inventory Sources

Keep `inventory_sources` as internal-only supplier/source records.

Recommended additions:

```text
source_code unique human reference
website
whatsapp
address
status active|inactive|blocked
reliability_rating nullable
payment_terms nullable
internal_notes
created_by
updated_by
```

Never expose this entity through public APIs.

### 4.4 Vehicles

Keep exact vehicle inventory. Add/confirm:

```text
inventory_source_id nullable/internal
source_stock_number
vin/chassis_number
purchase_cost_minor nullable
purchase_cost_currency nullable
estimated_local_cost_minor nullable
cost_notes internal
availability_status
reserved_at
sold_at
```

Separate **editorial publication state** from **commercial availability** if practical:

```text
publication_status: draft | pending_review | published | rejected | archived
availability_status: available | reserved | sourcing_hold | sold | unavailable
```

This is cleaner than overloading one enum with both review and stock states.

### 4.5 Vehicle Market Eligibility — REQUIRED

Add `vehicle_markets`:

```text
vehicle_id UUID FK
market_id UUID FK
is_active boolean
featured boolean
priority integer
available_from timestamptz nullable
available_until timestamptz nullable
market_notes internal nullable
created_by UUID
created_at
updated_at
PRIMARY KEY(vehicle_id, market_id)
```

Public vehicle queries must require/resolve market context and return only vehicles with an active eligibility row for that market plus published + commercially available status.

### 4.6 Leads

Existing lead foundation is useful. Recommended lifecycle:

```text
new
assigned
contacted
qualified
quote_preparing
quote_sent
negotiating
won
lost
unresponsive
spam
cancelled
```

Assignment can remain separate from status if preferred; if so `assigned` should not be an enum value. Recommended implementation: keep assignment orthogonal and use:

```text
new → contacted → qualified → quote_preparing → quote_sent → negotiating → won
```

Closures: `lost | unresponsive | spam | cancelled`.

Add structured fields when useful:

```text
market_id
city
customer_language nullable
qualification_notes
lost_reason_code nullable
lost_reason_text nullable
utm_source/medium/campaign/content/term nullable
landing_page nullable
referrer nullable
```

Preserve `vehicle_snapshot` server-side.

### 4.7 Quotes — REQUIRED

A quote must not be represented only by `lead.status=quote_sent`.

Recommended tables:

`quotes`

```text
id UUID PK
reference_no unique (Q-...)
lead_id FK
vehicle_id FK
status draft|sent|accepted|rejected|expired|superseded|cancelled
currency_code
current_version_no
valid_until
created_by
sent_by nullable
sent_at nullable
accepted_at nullable
created_at
updated_at
```

`quote_versions`

```text
id UUID PK
quote_id FK
version_no
vehicle_snapshot JSONB
source_cost_minor internal
shipping_cost_minor
other_cost_minor
internal_total_cost_minor
customer_total_minor
estimated_margin_minor
estimated_margin_bps nullable
terms_text
internal_notes
customer_notes
created_by
created_at
UNIQUE(quote_id, version_no)
```

`quote_items`

```text
id UUID PK
quote_version_id FK
kind vehicle|freight|inspection|insurance|documentation|service|tax|discount|other
label
quantity
unit_amount_minor
line_total_minor
visibility internal|customer
sort_order
```

Published/sent quote versions are immutable. Editing after send creates a new version and supersedes the old version.

### 4.8 Deals — REQUIRED

A won lead creates a Deal; it should not remain only a `won` lead.

`deals`:

```text
id UUID PK
reference_no unique (DEAL-...)
lead_id FK UNIQUE
accepted_quote_id FK nullable
vehicle_id FK
customer_id nullable
market_id FK
owner_salesperson_id FK
status won|source_confirming|source_confirmed|awaiting_customer|processing|ready_for_delivery|completed|cancelled
agreed_amount_minor
currency_code
source_id snapshot/FK nullable
source_cost_minor internal nullable
margin_minor internal nullable
won_at
completed_at nullable
cancelled_at nullable
cancel_reason nullable
created_at
updated_at
```

### 4.9 Vehicle Reservation

To prevent two salespeople from selling the same exact vehicle, add `vehicle_reservations` or enforce a deal-level hold.

Recommended:

```text
id UUID PK
vehicle_id FK
lead_id FK
quote_id nullable
status active|released|converted|expired
expires_at
created_by
created_at
released_at nullable
```

Use a PostgreSQL constraint/transactional lock to ensure at most one active reservation per exact vehicle.

### 4.10 Fulfillment

For initial handover, fulfillment can be operational rather than a full shipping ERP.

`deal_tasks` or `fulfillment_tasks`:

```text
id
 deal_id
 type source_confirmation|documents|payment_followup|inspection|shipping|delivery|other
 status pending|in_progress|completed|cancelled
 assigned_to
 due_at
 notes
 completed_at
```

If the business later requires actual shipping/vessel tracking, add dedicated shipment entities rather than overloading this table.

### 4.11 CMS

Recommended minimal CMS:

```text
pages
blog_posts
faqs
banners
market_content
```

Each should support draft/published status, slug, SEO metadata, author and timestamps.

---

## 5. Authentication and Security

### Authentication

- Access JWT: 10–15 minutes.
- Refresh token: opaque random token in Secure HttpOnly cookie; store only hash.
- Refresh rotation is atomic.
- Passwords: Argon2id.
- Password reset revokes all sessions.
- Suspended/deleted staff cannot use still-valid access tokens indefinitely; authorization checks current account state.
- Staff accounts should support MFA before production if admin portal exposes pricing/margins/customer PII.

### Public lead abuse controls

- rate limit by IP and normalized email/phone;
- `Idempotency-Key` for `POST /leads`;
- Turnstile/hCaptcha when configured;
- server captures IP/user agent/source;
- do not trust customer-provided status/assignment/snapshot/market internals.

### Sensitive data

Never expose publicly:

- inventory source identity/contact;
- purchase/source cost;
- internal landed-cost calculation;
- margin;
- internal notes;
- staff IDs unless required;
- audit metadata;
- customer PII belonging to other leads.

---

## 6. RBAC

Recommended default staff roles:

| Role | Purpose |
|---|---|
| `super_admin` | Full platform administration |
| `admin` | Broad operational administration without security-root actions |
| `inventory_manager` | Sources, vehicles, market eligibility, publication |
| `sales_manager` | All leads, assignment, quotes, deals, reporting |
| `sales_agent` | Assigned leads, quotes and deals within scope |
| `content_manager` | CMS/catalog content; no source costs/margins |
| `finance` | Deal commercial/payment-related views if added |

Recommended permission families:

```text
staff.read / staff.manage
rbac.manage
market.read / market.manage
catalog.read / catalog.manage
inventory_source.read / inventory_source.manage
vehicle.create / vehicle.read_all / vehicle.update / vehicle.publish / vehicle.archive
vehicle.cost.read / vehicle.cost.update
vehicle_market.manage
lead.read_all / lead.read_assigned / lead.assign / lead.update / lead.activity.create
lead.followup.manage / lead.followup.manage_assigned
quote.create / quote.read_all / quote.read_assigned / quote.update / quote.send / quote.cost.read
quote.approve_discount (optional)
deal.read_all / deal.read_assigned / deal.manage / deal.complete
cms.read / cms.manage / cms.publish
analytics.read
customer.read
notification.read
 audit.read
```

Do not authorize by frontend role names. Backend permissions and resource scope are authoritative.

---

# 7. COMPLETE API ENDPOINT CATALOGUE

The following is the target API surface for the project. Not every endpoint must be built in the first sprint, but endpoint naming/domain boundaries should remain stable.

## 7.1 System / Health

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/health/live` | Public/internal | Process liveness |
| GET | `/health/ready` | Internal/public deployment choice | DB/required dependency readiness |
| GET | `/metrics` | Internal only | Prometheus metrics, if enabled |

## 7.2 Authentication

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/customers/register` | Public | Optional customer registration |
| POST | `/api/v1/auth/login` | Public | Customer/staff login |
| POST | `/api/v1/auth/refresh` | Refresh cookie | Rotate session |
| POST | `/api/v1/auth/logout` | Auth | Revoke current session |
| POST | `/api/v1/auth/logout-all` | Auth | Revoke all sessions |
| POST | `/api/v1/auth/email-verification/request` | Public/rate-limited | Send verification token |
| POST | `/api/v1/auth/email-verification/confirm` | Public | Verify email |
| POST | `/api/v1/auth/password/forgot` | Public | Neutral forgot-password flow |
| POST | `/api/v1/auth/password/reset` | Public | Reset password + revoke sessions |
| GET | `/api/v1/auth/me` | Auth | Current identity/profile/permissions summary |
| PATCH | `/api/v1/auth/me` | Auth | Safe profile fields |
| POST | `/api/v1/auth/me/change-password` | Auth | Change known password |

Staff creation should be admin-controlled, not public registration.

## 7.3 Public Countries / Market Context

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/countries` | Geographic country reference list |
| GET | `/api/v1/markets` | Active GreenWay sales markets |
| GET | `/api/v1/markets/:marketSlug` | Public market metadata/contact/localization |
| GET | `/api/v1/market-context` | Resolve suggested market from request/IP where supported; client may override |

`market-context` is advisory. Never force a country solely from IP.

## 7.4 Public Catalog

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/catalog/makes` | Active makes |
| GET | `/api/v1/catalog/makes/:makeId/models` | Models for make |
| GET | `/api/v1/catalog/models` | Optional generic model listing/filter |
| GET | `/api/v1/catalog/body-types` | Body types |
| GET | `/api/v1/catalog/features` | Vehicle features |
| GET | `/api/v1/catalog/colors` | Optional normalized color choices if introduced |

## 7.5 Public Vehicles

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/vehicles` | Market-aware published inventory search |
| GET | `/api/v1/vehicles/:referenceNo` | Public exact vehicle detail |
| GET | `/api/v1/vehicles/:referenceNo/similar` | Similar eligible vehicles |
| GET | `/api/v1/vehicles/featured` | Featured inventory for selected market |
| GET | `/api/v1/vehicles/new-arrivals` | New arrivals for selected market |

### Required market-aware vehicle filters

```text
market / marketId / destinationCountry
q
makeId
modelId
bodyTypeId
condition
yearFrom / yearTo
mileageFrom / mileageTo
engineCcFrom / engineCcTo
fuel (multi)
transmission (multi)
drive (multi)
steering (multi)
seats
doors
exteriorColor
interiorColor
stockCountryId
featureIds
sort=newest|year_desc|year_asc|mileage_asc|mileage_desc
limit
cursor
```

Public responses contain no `inventorySource`, purchase cost, internal cost, margin, internal notes, review notes or unpublished market mappings.

## 7.6 Public Get-a-Quote / Leads

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/leads` | Optional | Main Get-a-Quote conversion endpoint |

Recommended request:

```json
{
  "vehicleReferenceNo": "GW-100123",
  "marketSlug": "pakistan",
  "contactName": "Buyer Name",
  "contactEmail": "buyer@example.com",
  "contactPhone": "+92...",
  "contactWhatsapp": "+92...",
  "preferredContact": "whatsapp",
  "customerCountryId": 1,
  "destinationCountryId": 1,
  "city": "Karachi",
  "message": "Optional requirements",
  "consentGiven": true,
  "marketingConsent": false
}
```

Server must verify the vehicle is currently eligible for the requested market. Server derives vehicle ID, snapshot, customer ID when authenticated, source metadata, status and timestamps.

Do **not** accept source/vendor ID, costs, price, margin, status, assignment or vehicle snapshot from public clients.

## 7.7 Customer Account — Optional Supporting Features

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/me/favorites` | List favorites |
| PUT | `/api/v1/me/favorites/:vehicleId` | Idempotent favorite |
| DELETE | `/api/v1/me/favorites/:vehicleId` | Remove favorite |
| GET | `/api/v1/me/saved-searches` | List saved searches |
| POST | `/api/v1/me/saved-searches` | Create validated saved search |
| GET | `/api/v1/me/saved-searches/:id` | Read own saved search |
| PATCH | `/api/v1/me/saved-searches/:id` | Update |
| DELETE | `/api/v1/me/saved-searches/:id` | Delete |
| GET | `/api/v1/me/leads` | My quote requests |
| GET | `/api/v1/me/leads/:referenceNo` | Customer-safe request status |
| GET | `/api/v1/me/notifications` | Own notifications |
| PATCH | `/api/v1/me/notifications/:id/read` | Mark read |
| POST | `/api/v1/me/notifications/read-all` | Mark all read |

Guest leads must not be automatically claimed merely because a new account uses the same unverified email.

---

# 8. ADMIN / STAFF API

All endpoints below require authenticated active staff plus permission checks.

## 8.1 Admin Dashboard

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/dashboard/summary` | KPI summary |
| GET | `/api/v1/admin/dashboard/leads` | Lead funnel/time-series |
| GET | `/api/v1/admin/dashboard/inventory` | Inventory summary |
| GET | `/api/v1/admin/dashboard/sales` | Quote/deal performance |
| GET | `/api/v1/admin/dashboard/followups` | Due/overdue follow-up summary |

Metrics should be computed server-side from authoritative data, not by downloading all records to the frontend.

## 8.2 Staff Users

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/users` | List/search staff/customer users according to scope |
| POST | `/api/v1/admin/staff` | Create staff account/invite |
| GET | `/api/v1/admin/staff/:userId` | Staff detail |
| PATCH | `/api/v1/admin/staff/:userId` | Staff profile/status |
| POST | `/api/v1/admin/staff/:userId/suspend` | Explicit suspend |
| POST | `/api/v1/admin/staff/:userId/activate` | Reactivate |
| PUT | `/api/v1/admin/users/:userId/roles` | Replace staff roles |
| GET | `/api/v1/admin/roles` | Roles |
| POST | `/api/v1/admin/roles` | Create role |
| PATCH | `/api/v1/admin/roles/:id` | Update role |
| GET | `/api/v1/admin/permissions` | Permissions |
| PUT | `/api/v1/admin/roles/:id/permissions` | Replace permission set |

## 8.3 Markets

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/markets` | All markets incl. inactive |
| POST | `/api/v1/admin/markets` | Enable/configure a market |
| GET | `/api/v1/admin/markets/:id` | Market detail |
| PATCH | `/api/v1/admin/markets/:id` | Currency/contact/localization/SEO/status |
| POST | `/api/v1/admin/markets/:id/activate` | Activate |
| POST | `/api/v1/admin/markets/:id/deactivate` | Deactivate |

Deactivating a market removes its inventory from public market views without deleting vehicles.

## 8.4 Inventory Sources (Internal Vendors)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/inventory-sources` | Search/list internal sources |
| POST | `/api/v1/admin/inventory-sources` | Create source |
| GET | `/api/v1/admin/inventory-sources/:id` | Internal source detail |
| PATCH | `/api/v1/admin/inventory-sources/:id` | Update source/contact/notes |
| POST | `/api/v1/admin/inventory-sources/:id/activate` | Activate |
| POST | `/api/v1/admin/inventory-sources/:id/deactivate` | Deactivate |
| GET | `/api/v1/admin/inventory-sources/:id/vehicles` | Vehicles sourced from source |

No `/vendor/*` or `/dealer/*` endpoints exist.

## 8.5 Admin Vehicle Inventory

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/vehicles` | Full internal inventory list |
| POST | `/api/v1/admin/vehicles` | Create exact vehicle |
| GET | `/api/v1/admin/vehicles/:id` | Full internal vehicle detail |
| PATCH | `/api/v1/admin/vehicles/:id` | Edit vehicle specs/internal metadata |
| DELETE | `/api/v1/admin/vehicles/:id` | Soft delete where allowed |
| POST | `/api/v1/admin/vehicles/:id/restore` | Restore soft-deleted vehicle |
| POST | `/api/v1/admin/vehicles/:id/submit-review` | Optional editorial review workflow |
| POST | `/api/v1/admin/vehicles/:id/publish` | Publish |
| POST | `/api/v1/admin/vehicles/:id/unpublish` | Remove from public catalogue without deleting |
| POST | `/api/v1/admin/vehicles/:id/reject` | Reject review with reason |
| POST | `/api/v1/admin/vehicles/:id/archive` | Archive |
| POST | `/api/v1/admin/vehicles/:id/mark-sold` | Commercially mark sold |
| POST | `/api/v1/admin/vehicles/:id/mark-unavailable` | Temporarily unavailable |
| POST | `/api/v1/admin/vehicles/:id/mark-available` | Return to availability |
| PUT | `/api/v1/admin/vehicles/:id/features` | Replace feature set |
| GET | `/api/v1/admin/vehicles/:id/media` | Media |
| POST | `/api/v1/admin/vehicles/:id/media` | Attach uploaded media |
| PATCH | `/api/v1/admin/vehicles/:id/media/:mediaId` | Metadata/primary flag |
| DELETE | `/api/v1/admin/vehicles/:id/media/:mediaId` | Remove media |
| POST | `/api/v1/admin/vehicles/:id/media/reorder` | Reorder media |
| GET | `/api/v1/admin/vehicles/:id/history` | Audit/activity history for inventory item |

### Internal vehicle cost endpoint separation

To reduce accidental exposure, cost can be handled via separate permissioned routes:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/vehicles/:id/costing` | Internal source/acquisition cost |
| PUT | `/api/v1/admin/vehicles/:id/costing` | Update internal costing |

## 8.6 Vehicle Market Eligibility

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/vehicles/:id/markets` | Markets currently eligible |
| PUT | `/api/v1/admin/vehicles/:id/markets` | Replace market eligibility atomically |
| PUT | `/api/v1/admin/vehicles/:id/markets/:marketId` | Enable/update one mapping |
| DELETE | `/api/v1/admin/vehicles/:id/markets/:marketId` | Remove one mapping |
| POST | `/api/v1/admin/vehicles/bulk-market-assignment` | Bulk market mapping for selected vehicles |

The API must never infer eligibility solely from source country or stock country.

## 8.7 Uploads

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/admin/uploads/presign` | Authorize short-lived direct upload |
| POST | `/api/v1/admin/uploads/complete` | Verify object metadata/key and mark upload complete if upload records are used |

Purposes can include `vehicle_media`, `cms_media`, `lead_attachment`, `deal_document`, `import_file`.

Do not proxy large files through Express unless there is a specific operational reason.

## 8.8 Internal Inventory Imports

If bulk import is required for internal staff:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/admin/vehicle-imports` | Create internal CSV/XLSX import job after upload |
| GET | `/api/v1/admin/vehicle-imports` | List jobs |
| GET | `/api/v1/admin/vehicle-imports/:id` | Status/counts/errors |
| POST | `/api/v1/admin/vehicle-imports/:id/retry` | Retry failed rows/job safely |

Imports create drafts; never auto-publish.

## 8.9 Catalog Administration

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/admin/catalog/makes` | Create make |
| PATCH | `/api/v1/admin/catalog/makes/:id` | Update/activate/deactivate |
| POST | `/api/v1/admin/catalog/models` | Create model |
| PATCH | `/api/v1/admin/catalog/models/:id` | Update |
| POST | `/api/v1/admin/catalog/body-types` | Create body type |
| PATCH | `/api/v1/admin/catalog/body-types/:id` | Update |
| POST | `/api/v1/admin/catalog/features` | Create feature |
| PATCH | `/api/v1/admin/catalog/features/:id` | Update |

Prefer deactivation to deleting referenced catalog data.

---

# 9. SALES CRM API

Use `/api/v1/staff` for salesperson operational resources. Managers may have broader permissions over the same routes.

## 9.1 Leads

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/staff/leads` | CRM inbox/search |
| GET | `/api/v1/staff/leads/:referenceNo` | Full lead workspace |
| POST | `/api/v1/staff/leads/:referenceNo/assign` | Assign/reassign salesperson |
| PATCH | `/api/v1/staff/leads/:referenceNo/status` | Controlled status transition |
| PATCH | `/api/v1/staff/leads/:referenceNo/qualification` | Structured qualification fields |
| POST | `/api/v1/staff/leads/:referenceNo/mark-lost` | Close with reason |
| POST | `/api/v1/staff/leads/:referenceNo/reopen` | Manager-authorized reopen |
| GET | `/api/v1/staff/leads/:referenceNo/activities` | Timeline |
| POST | `/api/v1/staff/leads/:referenceNo/activities` | Manual note/call/email/WhatsApp summary |
| GET | `/api/v1/staff/leads/:referenceNo/related` | Related leads for same verified contact/customer |

Recommended filters:

```text
status
assignedTo
unassigned
marketId
destinationCountryId
customerCountryId
vehicleReference
makeId/modelId
createdFrom/createdTo
source/utmSource
q
limit/cursor
```

## 9.2 Follow-ups

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/staff/followups` | Own/team tasks |
| POST | `/api/v1/staff/leads/:referenceNo/followups` | Create follow-up |
| PATCH | `/api/v1/staff/followups/:id` | Reschedule/note/assignee within permission |
| POST | `/api/v1/staff/followups/:id/complete` | Complete idempotently |
| POST | `/api/v1/staff/followups/:id/reopen` | Reopen if policy allows |
| DELETE | `/api/v1/staff/followups/:id` | Cancel/delete pending task if allowed |

## 9.3 Quotes

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/staff/quotes` | Search quotes within scope |
| POST | `/api/v1/staff/leads/:referenceNo/quotes` | Create draft quote |
| GET | `/api/v1/staff/quotes/:quoteRef` | Quote + current version |
| PATCH | `/api/v1/staff/quotes/:quoteRef` | Draft metadata only |
| POST | `/api/v1/staff/quotes/:quoteRef/versions` | Create a new immutable quote version |
| GET | `/api/v1/staff/quotes/:quoteRef/versions` | Version history |
| GET | `/api/v1/staff/quotes/:quoteRef/versions/:versionNo` | Version detail |
| POST | `/api/v1/staff/quotes/:quoteRef/send` | Mark/send current version |
| POST | `/api/v1/staff/quotes/:quoteRef/accept` | Record accepted quote |
| POST | `/api/v1/staff/quotes/:quoteRef/reject` | Record rejection |
| POST | `/api/v1/staff/quotes/:quoteRef/cancel` | Cancel quote |
| POST | `/api/v1/staff/quotes/:quoteRef/expire` | Manual/admin expiry where needed |
| GET | `/api/v1/staff/quotes/:quoteRef/preview` | Customer-safe rendered data/PDF input |

Quote totals and margin are calculated server-side. Client may propose line-item inputs only when permission allows; it never submits authoritative `margin` as a trusted result.

If PDF generation is needed:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/staff/quotes/:quoteRef/pdf` | Generate/store quote PDF asynchronously/synchronously |
| GET | `/api/v1/staff/quotes/:quoteRef/pdf` | Retrieve signed/private PDF link according to permission |

## 9.4 Vehicle Reservations / Holds

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/staff/vehicles/:vehicleId/reservations` | Create temporary hold for active lead/quote |
| GET | `/api/v1/staff/vehicles/:vehicleId/reservation` | Current active hold |
| POST | `/api/v1/staff/reservations/:id/release` | Release |
| POST | `/api/v1/staff/reservations/:id/extend` | Manager-authorized extension |

Reservation creation must transactionally prevent a second active reservation.

## 9.5 Deals

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/staff/deals` | Search deals within scope |
| POST | `/api/v1/staff/leads/:referenceNo/deal` | Convert won/accepted lead into deal transactionally |
| GET | `/api/v1/staff/deals/:dealRef` | Deal workspace |
| PATCH | `/api/v1/staff/deals/:dealRef` | Safe operational metadata |
| PATCH | `/api/v1/staff/deals/:dealRef/status` | Controlled deal transition |
| POST | `/api/v1/staff/deals/:dealRef/cancel` | Cancel with reason |
| POST | `/api/v1/staff/deals/:dealRef/complete` | Complete final sale |
| GET | `/api/v1/staff/deals/:dealRef/tasks` | Fulfillment tasks |
| POST | `/api/v1/staff/deals/:dealRef/tasks` | Create task |
| PATCH | `/api/v1/staff/deal-tasks/:id` | Update task |
| POST | `/api/v1/staff/deal-tasks/:id/complete` | Complete task |

### Definition of completed sale

A lead becoming `won` is **not** the final completed sale. Recommended semantics:

- `lead.won` = customer commercially agreed / sale opportunity won.
- `deal` = operational transaction created.
- `deal.completed` = agreed internal completion conditions have been met and the sale/fulfillment is closed.

This distinction keeps sales conversion metrics separate from fulfillment completion.

---

# 10. CMS / SEO API

Public:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/content/pages/:slug` | Published page |
| GET | `/api/v1/content/faqs` | Published FAQs, optionally market/category filtered |
| GET | `/api/v1/content/blog` | Published posts |
| GET | `/api/v1/content/blog/:slug` | Published post |
| GET | `/api/v1/content/banners` | Active market-aware banners |

Admin:

| Method | Endpoint | Purpose |
|---|---|---|
| GET/POST | `/api/v1/admin/content/pages` | List/create pages |
| GET/PATCH | `/api/v1/admin/content/pages/:id` | Detail/update |
| POST | `/api/v1/admin/content/pages/:id/publish` | Publish |
| POST | `/api/v1/admin/content/pages/:id/unpublish` | Unpublish |
| GET/POST | `/api/v1/admin/content/blog` | List/create posts |
| GET/PATCH | `/api/v1/admin/content/blog/:id` | Detail/update |
| POST | `/api/v1/admin/content/blog/:id/publish` | Publish |
| GET/POST | `/api/v1/admin/content/faqs` | Manage FAQs |
| PATCH/DELETE | `/api/v1/admin/content/faqs/:id` | Update/delete/deactivate |
| GET/POST | `/api/v1/admin/content/banners` | Manage banners |
| PATCH/DELETE | `/api/v1/admin/content/banners/:id` | Update/delete/deactivate |

---

# 11. Notifications

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/me/notifications` | Own notifications |
| PATCH | `/api/v1/me/notifications/:id/read` | Mark read |
| POST | `/api/v1/me/notifications/read-all` | Mark all read |
| GET | `/api/v1/staff/notifications` | Staff notifications if separate route desired |
| PATCH | `/api/v1/staff/notifications/:id/read` | Staff mark read |

System-generated types should be constants such as:

```text
lead.received
lead.assigned
lead.followup_due
quote.sent
quote.accepted
deal.created
deal.status_changed
vehicle.reserved
vehicle.reservation_expiring
vehicle.published
vehicle.sold
```

Clients cannot create arbitrary notification records.

---

# 12. Analytics / Reports

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/reports/leads` | Lead counts/funnel by date, market, source, salesperson |
| GET | `/api/v1/admin/reports/sales` | Won deals/revenue/margin according to permissions |
| GET | `/api/v1/admin/reports/inventory` | Available/published/sold/aging inventory |
| GET | `/api/v1/admin/reports/vehicles` | Demand by make/model/vehicle |
| GET | `/api/v1/admin/reports/markets` | Leads/conversion by destination market |
| GET | `/api/v1/admin/reports/salespeople` | Response/conversion/quote metrics |
| GET | `/api/v1/admin/reports/sources` | Internal source performance/cost reliability |
| GET | `/api/v1/admin/reports/lost-reasons` | Lost-lead reason distribution |

Margin/revenue endpoints require stricter permissions than general dashboard access.

---

# 13. Audit Logs

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/admin/audit-logs` | Read-only audit search |
| GET | `/api/v1/admin/audit-logs/:id` | Optional detail |

No public/admin API may create/update/delete arbitrary audit records. Audit events are emitted by domain services in the same transaction where possible.

Audit at minimum:

```text
staff role changes
inventory source create/update/status
vehicle create/material update/publish/unpublish/archive/sold
vehicle costing changes
vehicle market eligibility changes
lead assignment/status/lost/reopen
quote version creation/send/accept/cancel
reservation create/release/expire
 deal creation/status/cancel/complete
CMS publish/unpublish
```

---

# 14. State Machines

## Vehicle publication

```text
draft → pending_review → published
  ↑          ↓ rejected
  └──────────┘
published → archived
```

If review is unnecessary for the small initial team, `draft → published` can be permission-controlled; keep explicit publish/unpublish commands.

## Vehicle availability

```text
available → reserved → sold
available → unavailable → available
reserved → available        (released/expired)
reserved → sold             (deal conversion)
```

## Lead

```text
new → contacted → qualified → quote_preparing → quote_sent → negotiating → won
 │       │           │              │              │
 └───────┴───────────┴──────────────┴──────────────┴→ lost/unresponsive/cancelled
new/contacted → spam
```

Do not automatically change lead status merely because it is assigned.

## Quote

```text
draft → sent → accepted
          ├→ rejected
          ├→ expired
          └→ superseded (when a replacement version/quote becomes authoritative)
draft/sent → cancelled
```

## Deal

```text
won → source_confirming → source_confirmed → processing → ready_for_delivery → completed
  └──────────────────────────────────────────────────────────────→ cancelled
```

Exact deal states can be shortened for MVP, but Lead and Deal lifecycles must remain separate.

---

# 15. Critical Transactions and Concurrency

Use PostgreSQL transactions for:

- refresh-token rotation;
- role/permission replacement + audit;
- vehicle publication/availability change + audit;
- market eligibility replacement + audit;
- lead creation + snapshot + activity + notification;
- lead assignment + activity + notification + audit;
- lead status transition + activity + audit;
- quote version creation + totals + audit;
- quote acceptance + lead state update when policy requires;
- vehicle reservation creation with conflict protection;
- deal creation from won lead/accepted quote;
- deal completion + vehicle sold + reservation conversion/release;
- soft delete/restore.

Never perform slow external email/storage/network calls inside DB transactions. Commit first, then enqueue side effects reliably.

---

# 16. Idempotency

Require/support `Idempotency-Key` for high-risk/retry-prone commands:

```text
POST /leads
POST /staff/leads/:ref/quotes
POST /staff/quotes/:ref/send
POST /staff/vehicles/:id/reservations
POST /staff/leads/:ref/deal
POST /staff/deals/:ref/complete
```

Same key + same normalized request returns original result. Same key + different payload returns `409 conflict`.

Longer-term, use a PostgreSQL idempotency table for durable financial/deal commands rather than Redis-only storage.

---

# 17. Search and Pagination

Public vehicle query stable order examples:

```text
newest: published_at DESC, id DESC
year_desc: year DESC, id DESC
mileage_asc: mileage_km ASC NULLS LAST, id ASC
```

CRM:

```text
leads: created_at DESC, id DESC
followups: due_at ASC, id ASC
quotes: created_at DESC, id DESC
deals: created_at DESC, id DESC
```

Cursors are opaque, validated/signed, and encode all ordering keys required to avoid duplicates/skips.

Do not expose arbitrary DB column names as sort parameters.

---

# 18. Error Contract

Use safe problem codes:

```text
400 bad_request
401 unauthenticated
403 forbidden
404 not_found
409 conflict
409 vehicle_unavailable
409 reservation_conflict
409 invalid_state_transition
409 idempotency_conflict
422 validation_error
429 rate_limited
500 internal_error
503 dependency_unavailable
```

Do not leak SQL errors, stack traces, token details, source costs or internal authorization information.

---

# 19. Testing Requirements

## Unit

- validators;
- state-transition matrices;
- quote calculations;
- margin calculations;
- permission/resource-scope policies;
- cursor encode/decode;
- market eligibility rules.

## PostgreSQL integration

- VIN/stock uniqueness;
- vehicle-market mappings;
- one-active-reservation invariant;
- quote version uniqueness;
- lead/deal unique conversion rules;
- transaction rollback;
- audit creation.

## API integration — mandatory examples

- public cannot see draft/unpublished/unavailable vehicle;
- Pakistan market request cannot see a vehicle not enabled for Pakistan;
- stock country does not automatically imply destination eligibility;
- public response never includes source/vendor or costing fields;
- guest can submit a lead without account;
- lead cannot be created for ineligible/unpublished vehicle;
- duplicate idempotent lead submission does not duplicate lead;
- sales agent cannot access another agent's lead without permission;
- manager can assign/reassign;
- invalid lead transition fails;
- quote sent version cannot be mutated in place;
- quote margin is server-derived;
- two active reservations for one exact vehicle cannot exist;
- deal creation is idempotent/unique for the intended won sale;
- deal completion marks vehicle sold atomically;
- content manager cannot read internal vehicle cost;
- suspended staff is denied;
- refresh rotation works;
- audit records exist for sensitive mutations.

## CI gate

Every PR:

```text
format check
lint
typecheck
unit tests
PostgreSQL/Redis test services
migrations from empty DB
seed
integration tests
OpenAPI validation
OpenAPI/handler drift check
build
```

---

# 20. Implementation Phases for Fast Handover

## Phase 0 — Baseline takeover

- keep existing repo;
- run current quality gates;
- freeze existing OpenAPI version;
- create migration for new domain model;
- remove stale dealer references from docs/OpenAPI/tests;
- update permission seed.

## Phase 1 — Global inventory foundation

- markets;
- inventory sources;
- admin vehicle CRUD;
- costing permissions;
- vehicle market eligibility;
- media/upload flow;
- catalog admin;
- public market-aware vehicle search/detail.

**Gate:** a staff member can create an exact car, attach its internal source/cost, enable Pakistan and Kenya but not France, publish it, and public queries obey those rules.

## Phase 2 — Lead CRM

- `POST /leads`;
- idempotency/abuse controls;
- CRM inbox/detail;
- assignment;
- activities;
- follow-ups;
- qualification/lost reasons;
- notifications.

**Gate:** Get-a-Quote appears in admin CRM and can be worked end-to-end by sales.

## Phase 3 — Quote engine

- quote schema;
- versioned costing/line items;
- send/accept/reject/expire;
- PDF if required;
- lead transitions.

**Gate:** salesperson can produce a traceable customer quote without exposing internal source cost.

## Phase 4 — Deal + exact-vehicle protection

- reservation/hold;
- won lead → deal;
- sourcing confirmation;
- fulfillment tasks;
- complete/cancel;
- sold inventory state.

**Gate:** one exact vehicle cannot be sold concurrently and won sales are operationally trackable to completion.

## Phase 5 — Admin completeness

- staff management;
- dashboards/reports;
- audit UI APIs;
- CMS/SEO;
- optional customer favorites/saved searches/account request history.

## Phase 6 — Production hardening

- MFA for privileged staff;
- durable outbox;
- backup/restore drill;
- load tests;
- Sentry/metrics/alerts;
- CSP/CORS/security review;
- rate-limit tuning;
- DB query/index review;
- deployment/runbook.

---

# 21. Existing Repository: Immediate Changes Before Continuing Development

1. **Keep** current Express/Kysely/auth/RBAC/public catalog foundation.
2. **Keep** single-seller `inventory_sources` correction.
3. Do not implement any endpoint from old documentation under `/dealer`, `/dealers`, or dealer document/member flows.
4. Replace the old API roadmap with this specification.
5. Add a new migration rather than rewriting a migration already used in a shared/deployed environment. If this database has never left local development and no shared state depends on it, the team may choose to squash before the first production baseline, but that must be deliberate.
6. Add `markets` + `vehicle_markets` before relying on public inventory country filtering.
7. Add internal costing before quote implementation.
8. Add Quotes as first-class entities before declaring `quote_sent` functionality complete.
9. Add Deals/reservation before declaring `won` functionality complete.
10. Regenerate Kysely DB types after migrations.
11. Expand OpenAPI in lockstep with routes.
12. Expand tests around market visibility and sensitive-field projections before frontend integration.

---

# 22. Public vs Internal DTO Boundary

This is a security requirement, not merely frontend formatting.

### `PublicVehicleDto` may contain

```text
referenceNo
title
condition
make/model/variant
bodyType
year
mileageKm
engineCc
fuel
transmission
drive
steering
seats/doors
colors
stockCountry (if product wants to show origin)
features
media
availability-safe display status
```

### It must never contain

```text
inventorySourceId
inventory source company/contact
purchaseCost
sourceCost
internal landed cost
margin
costNotes
internalNotes
createdBy/reviewedBy
private audit data
inactive market mappings
```

Use explicit mappers/projections. Never serialize a raw DB `vehicles` row into public responses.

---

# 23. Recommended Definition of Backend Done

The backend is handover-ready when all of the following work against a clean database:

1. migrations + seeds run from zero;
2. staff auth/RBAC is secure;
3. inventory source and exact vehicle can be created internally;
4. vehicle can be enabled for selected destination markets only;
5. published public search is market-aware and never leaks sensitive fields;
6. guest can Get a Quote;
7. lead appears in CRM with immutable vehicle snapshot;
8. lead can be assigned/contacted/qualified/followed-up;
9. salesperson can create and send versioned quote;
10. quote/customer agreement can create a protected deal/vehicle reservation;
11. deal can be sourced/processed/completed/cancelled;
12. vehicle becomes sold atomically on completed/confirmed sale policy;
13. audit logs cover sensitive operations;
14. OpenAPI describes every implemented endpoint;
15. tests prove authorization, market isolation, concurrency and state machines;
16. CI, readiness, logs, metrics, backups and production configuration are documented.

---

## Final implementation rule

When this specification conflicts with legacy dealer-marketplace documentation, **this specification wins**. When implementation discovers a genuine business ambiguity, do not silently encode an assumption into SQL or an endpoint; document the decision and update the API/schema contract in the same change.
