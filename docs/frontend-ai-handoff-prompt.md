# GreenWay Motors â€” frontend AI handoff prompt

Copy the **Prompt** section into the AI working in the frontend repository. Provide access to this backend's `openapi/openapi.yaml`, `GreenWay_Backend_Master_Spec_v1.md`, and `docs/backend-handover.md`.

---

## Prompt

You are implementing the frontend for GreenWay Motors: global vehicle marketplace, optional customer accounts, and permissioned staff workspace. The backend exists. Inspect the frontend repo first, then connect its existing UI and build missing workflows here.

### Inspect and preserve existing frontend

Inspect framework, routes, scripts, env conventions, API/auth client, components, responsive rules, pages, and the theme the developer already created. Reuse its colors, typography, spacing, buttons, forms, cards, tables, nav, modals, icons, toasts and loading states. **Preserve the existing theme and visual identity. Do not replace it with a generic template or redesign working pages.** Extend existing components, remain in the current framework, avoid unrelated changes. Summarize stack/theme and a short plan, then implement.

### Contract and API client

Use current `openapi/openapi.yaml` for implemented methods/paths; the master spec for product/workflow/security; and route validators/handlers when OpenAPI schemas are incomplete. The spec contains roadmap items: do not implement routes absent from active code/contract. Full documented path/method inventory follows this prompt.

- API base URL follows frontend env convention; local default `http://localhost:4000`. Routes use `/api/v1` except health. Never commit secrets or hardcode production URLs.
- Reuse/build one typed API client centralizing credentials, bearer token, parsing, cancellation and error normalization.
- Success is generally `{ data, meta }`; cursor pagination may be in `meta.pagination` (`limit`, `nextCursor`, `hasMore`), other routes may use offset. Follow each schema. Dashboard metrics come from server aggregates.
- Normalize Problem Details (`type`, `title`, `status`, `code`, `requestId`, optional `detail`). Map validation to fields. Handle 401/403/404/409/422/429/network/server states and retain requestId for diagnostics.
- Never invent routes, fields, filters, enum values or state transitions. Inspect code when schemas are incomplete; isolate unresolved details as TODO.
- URL-sync shareable filters, debounce search, support back/forward and actual server pagination.
- Use `Idempotency-Key` on contract/spec-required commands (lead and commercial quote/reservation/deal operations). Reuse only when retrying the exact same intent/payload; new key after payload change. Prevent double-submit.
- Process quote PDF as documented (binary/private URL), never as JSON/public content.

### Authentication and permissions

Guests browse and submit Get-a-Quote. Registration is optional for customers; staff are invited/created by authorized staff.

- Login can return HTTP 202 MFA challenge. Use response data with `/api/v1/auth/mfa/challenge`; challenge is not a session. Support staff setup/confirmation via `/api/v1/auth/me/mfa/enroll` and `/confirm`.
- Privileged production roles include super_admin, admin, finance, sales_manager. Access tokens are short-lived; refresh rotates HttpOnly `greenway_refresh_token`. Send credentials as required; never read cookie or persist tokens in localStorage. Respect origin checks; implement logout/logout-all and clear user state.
- The current `/api/v1/auth/me` response contains the sanitized user profile but does not include roles or permissions. Do not assume it returns those fields. Until the backend exposes a self-permissions endpoint or adds permissions to this response, treat the server as authoritative, handle 403s, and only show role-sensitive controls from permission data available through an authorized endpoint. Agents have assigned scope, managers may have team scope. Admin lacks costing/RBAC grants that super_admin has.

### Screens and workflows

Adapt paths/layout to existing app; wire existing pages instead of duplicating them.

**Public storefront:** country/market selector, market metadata, advisory `/market-context` (visitor chooses; never force by IP), explicit choice persistence, inventory search/featured/new arrivals/detail/similar. Public inventory requires market slug. Support only documented filters (text, make/model, body type, condition, year/mileage/engine, fuel/transmission/drive/steering, seats/doors, colors, stock country, features, sort). URL-sync, reset dependent filters, cursor paginate. Detail displays public DTO, public media/specs, market price/currency if returned, availability; quote CTA and optional favorites. Guest quote form sends only schema-approved contact, vehicle reference, market/country/city, contact preference, message and consent; show validation and success/reference. Never send source/vendor, cost/margin, snapshots/trusted IDs, quote price, assignment or status. Backend verifies market eligibility. Render published pages/FAQ/blog/banners/SEO only; never expose drafts.

**Customer account:** registration, login, verification, forgot/reset/change password, profile, favorites, saved searches (CRUD/rerun), customer-safe request history/detail, own notifications (list/read/read-all). Backend does not claim guest leads based on matching unverified email. No staff notes, assignments, costs/margins, activities or internal quote data.

**Staff CRM:** dashboards use five server aggregate endpoints; lead inbox/detail with supported filters, cursor pagination, enforced own/team/unassigned scope, qualification, assignment, controlled status, lost reason, authorized reopen, related leads, timeline/notes/follow-ups. Assignment alone does not change status. Follow-ups list/create/edit/reschedule/reassign/complete/reopen/cancel as permitted. Quotes list/detail, draft creation/edit, immutable new versions/history, safe preview, send/accept/reject/cancel/expire/PDF; sent version cannot be edited in place, totals/margin are server-calculated, costs only for authorized roles. Holds/reservations tied to exact vehicle; create/release/manager-extend, explain conflicts. Convert eligible won/accepted lead into deal; controlled deal states/cancel reason/fulfillment tasks/completion. Lead won is not final sale. Never mark sold locally; call deal completion and refresh. Staff notifications only list/read; do not imply push/exhaustive coverage.

**Staff inventory/operations:** inventory search/detail/create/edit/soft-delete/restore; submit review/reject reason, publish/unpublish/archive, available/unavailable/sold, feature/media/history, explicit market eligibility. Follow server state transitions, confirm consequential actions, never infer eligibility from stock/source country. Market mapping inspect/replace/add/remove/bulk only when authorized. Costing is separate permission-gated API; never in public/generic request, shared public cache, logs/analytics/exports. Sources are internal vendor records; **no dealer/vendor portal**â€”do not create /dealer, /dealers, dealer member/document flows. Catalog makes/models/body types/features. Media: presign, PUT to returned storage URL, complete if required, attach/manage/reorder; follow file rules. Imports: current audit says bounded validated CSV/JSON, draft-only, errors/retry; XLSX deferred. Verify active code and expose only working formats.

**Admin/CMS/reports:** staff/user list, create/invite, read/update/suspend/activate, role assignment; RBAC only when authorized. Market create/update/localization/currency/contact/SEO/activate/deactivate. CMS pages/blog/FAQ/banners only supported methods and actions. Reports leads/sales/inventory/vehicles/markets/salespeople/sources/lost reasons use server aggregates and scope. Audit list/detail read-only with redactions preserved.

### Security, money, accessibility

Separate public/customer and staff/internal DTOs/cache keys; clear user caches on logout/account switch. Never expose source/vendor, purchase/internal cost, margin, sourcing/review notes, unpublished market mappings, staff activities, another customer's PII, private quote/audit data. Client permissions are UX only. Never log credentials/MFA/recovery codes/sensitive body.

Money can be minor-unit integer or exact decimal string: no JS float calculations. Use decimal-safe utility; format with market currency/locale. Preserve existing theme desktop/tablet/mobile. Accessible labels, keyboard, focus, dialogs, non-color-only status; meaningful loading/empty/success/validation/denied/not-found/conflict/offline/retry states. Confirm consequential actions without slowing ordinary browsing.

### Completion

Inspect/summarize frontend stack/theme, then implement in current conventions. Configure typed client/models and document frontend env variables. Connect real APIs, not mocks; gate staff actions. Verify actions against this inventory, OpenAPI and code; never call nonexistent routes. Add focused tests for API/session/errors, required market, safe projection, permissions, and critical submits/conflicts. Run lint, typecheck, tests, production build and fix regressions. Report screens/routes, tests, backend limits and env variables.

Current backend limits: XLSX deferred; notifications partial/no push; no IP geolocation; retained outbox/idempotency rows need no UI; no dealer/vendor portal.

---

## Complete documented endpoint inventory

Generated from current OpenAPI. Coverage checklist, not public nav.
- GET /health/live
- GET /health/ready
- GET /api/v1/countries
- GET /api/v1/markets
- GET /api/v1/markets/{marketSlug}
- GET /api/v1/catalog/makes
- GET /api/v1/catalog/models
- GET /api/v1/catalog/makes/{makeId}/models
- GET /api/v1/catalog/body-types
- GET /api/v1/catalog/features
- GET /api/v1/vehicles
- GET /api/v1/vehicles/{referenceNo}
- POST /api/v1/auth/customers/register
- POST /api/v1/auth/login
- POST /api/v1/auth/mfa/challenge
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout
- POST /api/v1/auth/logout-all
- POST /api/v1/auth/email-verification/request
- POST /api/v1/auth/email-verification/confirm
- POST /api/v1/auth/password/forgot
- POST /api/v1/auth/password/reset
- GET /api/v1/auth/me
- PATCH /api/v1/auth/me
- POST /api/v1/auth/me/mfa/enroll
- POST /api/v1/auth/me/mfa/confirm
- GET /api/v1/admin/roles
- POST /api/v1/admin/roles
- PATCH /api/v1/admin/roles/{id}
- GET /api/v1/admin/permissions
- PUT /api/v1/admin/roles/{id}/permissions
- PUT /api/v1/admin/users/{userId}/roles
- GET /api/v1/admin/inventory-sources
- POST /api/v1/admin/inventory-sources
- GET /api/v1/admin/inventory-sources/{id}
- PATCH /api/v1/admin/inventory-sources/{id}
- POST /api/v1/admin/inventory-sources/{id}/activate
- POST /api/v1/admin/inventory-sources/{id}/deactivate
- POST /api/v1/admin/inventory-sources/{id}/block
- GET /api/v1/admin/inventory-sources/{id}/vehicles
- GET /api/v1/admin/markets
- POST /api/v1/admin/markets
- GET /api/v1/admin/markets/{id}
- PATCH /api/v1/admin/markets/{id}
- POST /api/v1/admin/markets/{id}/activate
- POST /api/v1/admin/markets/{id}/deactivate
- GET /api/v1/admin/vehicles
- POST /api/v1/admin/vehicles
- GET /api/v1/admin/vehicles/{id}
- PATCH /api/v1/admin/vehicles/{id}
- DELETE /api/v1/admin/vehicles/{id}
- POST /api/v1/admin/vehicles/{id}/restore
- POST /api/v1/admin/vehicles/{id}/publish
- POST /api/v1/admin/vehicles/{id}/unpublish
- POST /api/v1/admin/vehicles/{id}/archive
- POST /api/v1/admin/vehicles/{id}/mark-unavailable
- POST /api/v1/admin/vehicles/{id}/mark-available
- POST /api/v1/admin/vehicles/{id}/mark-sold
- GET /api/v1/admin/vehicles/{id}/features
- PUT /api/v1/admin/vehicles/{id}/features
- GET /api/v1/admin/vehicles/{id}/markets
- PUT /api/v1/admin/vehicles/{id}/markets
- GET /api/v1/admin/vehicles/{id}/costing
- PUT /api/v1/admin/vehicles/{id}/costing
- POST /api/v1/admin/uploads/presign
- POST /api/v1/admin/uploads/complete
- GET /api/v1/admin/vehicles/{id}/media
- POST /api/v1/admin/vehicles/{id}/media
- PATCH /api/v1/admin/vehicles/{id}/media/{mediaId}
- DELETE /api/v1/admin/vehicles/{id}/media/{mediaId}
- POST /api/v1/admin/vehicles/{id}/media/reorder
- POST /api/v1/leads
- GET /api/v1/staff/leads
- GET /api/v1/staff/leads/{referenceNo}
- POST /api/v1/staff/leads/{referenceNo}/assign
- PATCH /api/v1/staff/leads/{referenceNo}/status
- PATCH /api/v1/staff/leads/{referenceNo}/qualification
- POST /api/v1/staff/leads/{referenceNo}/mark-lost
- POST /api/v1/staff/leads/{referenceNo}/reopen
- GET /api/v1/staff/leads/{referenceNo}/related
- GET /api/v1/staff/leads/{referenceNo}/activities
- POST /api/v1/staff/leads/{referenceNo}/activities
- POST /api/v1/staff/leads/{referenceNo}/followups
- GET /api/v1/staff/followups
- POST /api/v1/staff/followups/{id}/complete
- PATCH /api/v1/staff/followups/{id}
- DELETE /api/v1/staff/followups/{id}
- POST /api/v1/staff/followups/{id}/reopen
- GET /api/v1/staff/quotes
- POST /api/v1/staff/leads/{referenceNo}/quotes
- GET /api/v1/staff/quotes/{quoteRef}
- PATCH /api/v1/staff/quotes/{quoteRef}
- POST /api/v1/staff/quotes/{quoteRef}/versions
- GET /api/v1/staff/quotes/{quoteRef}/versions
- GET /api/v1/staff/quotes/{quoteRef}/versions/{versionNo}
- POST /api/v1/staff/quotes/{quoteRef}/send
- POST /api/v1/staff/quotes/{quoteRef}/accept
- POST /api/v1/staff/quotes/{quoteRef}/reject
- POST /api/v1/staff/quotes/{quoteRef}/cancel
- POST /api/v1/staff/quotes/{quoteRef}/expire
- GET /api/v1/staff/quotes/{quoteRef}/preview
- GET /api/v1/staff/quotes/{quoteRef}/pdf
- POST /api/v1/staff/quotes/{quoteRef}/pdf
- POST /api/v1/staff/vehicles/{vehicleId}/reservations
- GET /api/v1/staff/vehicles/{vehicleId}/reservation
- POST /api/v1/staff/reservations/{id}/release
- POST /api/v1/staff/reservations/{id}/extend
- GET /api/v1/staff/deals
- POST /api/v1/staff/leads/{referenceNo}/deal
- GET /api/v1/staff/deals/{dealRef}
- PATCH /api/v1/staff/deals/{dealRef}
- PATCH /api/v1/staff/deals/{dealRef}/status
- POST /api/v1/staff/deals/{dealRef}/cancel
- POST /api/v1/staff/deals/{dealRef}/complete
- GET /api/v1/staff/deals/{dealRef}/tasks
- POST /api/v1/staff/deals/{dealRef}/tasks
- PATCH /api/v1/staff/deal-tasks/{id}
- POST /api/v1/staff/deal-tasks/{id}/complete
- GET /api/v1/vehicles/featured
- GET /api/v1/vehicles/new-arrivals
- GET /api/v1/vehicles/{referenceNo}/similar
- POST /api/v1/auth/me/change-password
- GET /api/v1/admin/users
- POST /api/v1/admin/staff
- GET /api/v1/admin/staff/{userId}
- PATCH /api/v1/admin/staff/{userId}
- POST /api/v1/admin/staff/{userId}/suspend
- POST /api/v1/admin/staff/{userId}/activate
- GET /api/v1/admin/audit-logs
- GET /api/v1/admin/audit-logs/{id}
- GET /api/v1/admin/dashboard/summary
- GET /api/v1/admin/dashboard/leads
- GET /api/v1/admin/dashboard/inventory
- GET /api/v1/admin/dashboard/sales
- GET /api/v1/admin/dashboard/followups
- GET /api/v1/admin/reports/leads
- GET /api/v1/admin/reports/sales
- GET /api/v1/admin/reports/inventory
- GET /api/v1/admin/reports/vehicles
- GET /api/v1/admin/reports/markets
- GET /api/v1/admin/reports/salespeople
- GET /api/v1/admin/reports/sources
- GET /api/v1/admin/reports/lost-reasons
- GET /api/v1/content/pages/{slug}
- GET /api/v1/content/faqs
- GET /api/v1/content/blog
- GET /api/v1/content/banners
- GET /api/v1/content/blog/{slug}
- GET /api/v1/admin/content/pages
- POST /api/v1/admin/content/pages
- GET /api/v1/admin/content/pages/{id}
- PATCH /api/v1/admin/content/pages/{id}
- DELETE /api/v1/admin/content/pages/{id}
- POST /api/v1/admin/content/pages/{id}/publish
- POST /api/v1/admin/content/pages/{id}/unpublish
- GET /api/v1/admin/content/blog
- POST /api/v1/admin/content/blog
- GET /api/v1/admin/content/blog/{id}
- PATCH /api/v1/admin/content/blog/{id}
- DELETE /api/v1/admin/content/blog/{id}
- POST /api/v1/admin/content/blog/{id}/publish
- POST /api/v1/admin/content/blog/{id}/unpublish
- GET /api/v1/admin/content/faqs
- POST /api/v1/admin/content/faqs
- GET /api/v1/admin/content/faqs/{id}
- PATCH /api/v1/admin/content/faqs/{id}
- DELETE /api/v1/admin/content/faqs/{id}
- POST /api/v1/admin/content/faqs/{id}/publish
- POST /api/v1/admin/content/faqs/{id}/unpublish
- GET /api/v1/admin/content/banners
- POST /api/v1/admin/content/banners
- GET /api/v1/admin/content/banners/{id}
- PATCH /api/v1/admin/content/banners/{id}
- DELETE /api/v1/admin/content/banners/{id}
- POST /api/v1/admin/content/banners/{id}/publish
- POST /api/v1/admin/content/banners/{id}/unpublish
- GET /api/v1/me/favorites
- PUT /api/v1/me/favorites/{vehicleId}
- DELETE /api/v1/me/favorites/{vehicleId}
- GET /api/v1/me/saved-searches
- POST /api/v1/me/saved-searches
- GET /api/v1/me/saved-searches/{id}
- PATCH /api/v1/me/saved-searches/{id}
- DELETE /api/v1/me/saved-searches/{id}
- GET /api/v1/me/leads
- GET /api/v1/me/leads/{referenceNo}
- GET /api/v1/me/notifications
- PATCH /api/v1/me/notifications/{id}/read
- POST /api/v1/me/notifications/read-all
- GET /api/v1/staff/notifications
- PATCH /api/v1/staff/notifications/{id}/read
- GET /api/v1/admin/catalog/makes
- POST /api/v1/admin/catalog/makes
- PATCH /api/v1/admin/catalog/models/{id}
- GET /api/v1/admin/catalog/models
- POST /api/v1/admin/catalog/models
- GET /api/v1/admin/catalog/body-types
- POST /api/v1/admin/catalog/body-types
- PATCH /api/v1/admin/catalog/body-types/{id}
- GET /api/v1/admin/catalog/features
- POST /api/v1/admin/catalog/features
- PATCH /api/v1/admin/catalog/features/{id}
- POST /api/v1/admin/vehicle-imports
- GET /api/v1/admin/vehicle-imports
- GET /api/v1/admin/vehicle-imports/{id}
- POST /api/v1/admin/vehicle-imports/{id}/retry
- POST /api/v1/admin/vehicles/{id}/submit-review
- POST /api/v1/admin/vehicles/{id}/reject
- GET /api/v1/admin/vehicles/{id}/history
- PUT /api/v1/admin/vehicles/{id}/markets/{marketId}
- DELETE /api/v1/admin/vehicles/{id}/markets/{marketId}
- POST /api/v1/admin/vehicles/bulk-market-assignment
- GET /api/v1/market-context
- PATCH /api/v1/admin/catalog/makes/{id}
