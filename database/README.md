# Database folder

The ordered files in `migrations/` are the schema source of truth. `001_initial_schema.sql` contains the original single-seller baseline; `002_single_seller_model.sql` safely converts older dealer schemas; `003_global_sales_foundation.sql` adds destination markets, costing, quotes, reservations and deals; `004_sales_integrity.sql` ensures linked commercial records refer to the same lead and exact vehicle; and `005_quote_history_guard.sql` protects authoritative quote line items. No vehicle is market-visible until staff explicitly enables a market mapping.

The ordered files in `seeds/` contain the staff permission matrix. Review the matrix before production deployment.

`006_inventory_lead_operations.sql` adds operational source fields, upload intents, structured lead qualification and attribution, and durable lead idempotency. It preserves the legacy source `is_active` flag and synchronizes it from the new status field. `007_commercial_workflow.sql` adds quote version lifecycle records, durable command idempotency, Deal commercial snapshots, and fulfillment tasks. Seeds `004` and `005` add operational and commercial permission grants to the super administrator and specialist roles.
