INSERT INTO permissions (code, description) VALUES
  ('vehicle.pricing.manage', 'Manage customer asking prices and salesperson sale floors'),
  ('vehicle.pricing.floor.read', 'Read salesperson-only minimum sale prices')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin' AND p.code IN ('vehicle.pricing.manage', 'vehicle.pricing.floor.read')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('vehicle.pricing.manage', 'vehicle.pricing.floor.read')
WHERE r.name IN ('admin', 'inventory_manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'vehicle.pricing.floor.read'
WHERE r.name IN ('sales_manager', 'sales_agent')
ON CONFLICT DO NOTHING;
