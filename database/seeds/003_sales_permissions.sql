INSERT INTO roles (name, description) VALUES
  ('admin', 'Broad internal operations'),
  ('finance', 'Internal deal financial review')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
  ('market.read', 'Read market configuration'),
  ('market.manage', 'Manage destination markets'),
  ('vehicle_market.manage', 'Manage vehicle market eligibility'),
  ('vehicle.cost.read', 'Read sensitive vehicle costing'),
  ('vehicle.cost.update', 'Update sensitive vehicle costing'),
  ('quote.create', 'Create commercial quotes'),
  ('quote.read_all', 'Read all quotes'),
  ('quote.read_assigned', 'Read assigned quotes'),
  ('quote.update', 'Create quote versions'),
  ('quote.send', 'Send quotes'),
  ('quote.cost.read', 'Read quote internal costing'),
  ('deal.read_all', 'Read all deals'),
  ('deal.read_assigned', 'Read assigned deals'),
  ('deal.manage', 'Manage deals and reservations'),
  ('deal.complete', 'Complete deals')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('market.read', 'market.manage', 'vehicle_market.manage', 'vehicle.cost.read', 'vehicle.cost.update')
WHERE r.name = 'inventory_manager' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('market.read', 'quote.create', 'quote.read_all', 'quote.update', 'quote.send', 'quote.cost.read',
   'deal.read_all', 'deal.manage', 'deal.complete', 'vehicle.cost.read')
WHERE r.name = 'sales_manager' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('market.read', 'quote.create', 'quote.read_assigned', 'quote.update', 'quote.send', 'deal.read_assigned')
WHERE r.name = 'sales_agent' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('market.read', 'deal.read_all', 'quote.cost.read', 'vehicle.cost.read')
WHERE r.name = 'finance' ON CONFLICT DO NOTHING;
