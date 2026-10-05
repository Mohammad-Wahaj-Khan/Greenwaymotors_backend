-- Recommended MVP permission seed. Safe to modify before first production deploy.
INSERT INTO permissions (code, description) VALUES
  ('vehicle.create', 'Create Green Way Motors inventory'),
  ('vehicle.read_all', 'Read all vehicles including review queues'),
  ('vehicle.update', 'Update Green Way Motors inventory'),
  ('vehicle.submit', 'Submit inventory for review'),
  ('vehicle.review', 'Review vehicle submissions'),
  ('vehicle.publish', 'Publish inventory'),
  ('vehicle.reject', 'Reject inventory'),
  ('vehicle.archive', 'Archive inventory'),
  ('catalog.manage', 'Manage makes, models, body types and features'),
  ('inventory_source.read', 'Read internal inventory sources'),
  ('inventory_source.manage', 'Manage internal inventory sources'),
  ('lead.read_all', 'Read all sales leads'),
  ('lead.read_assigned', 'Read leads assigned to current user'),
  ('lead.assign', 'Assign or reassign sales leads'),
  ('lead.update', 'Update lead status and activities'),
  ('lead.update_assigned', 'Update assigned lead status'),
  ('lead.activity.create', 'Create lead activities'),
  ('lead.followup', 'Manage lead follow-ups'),
  ('lead.followup.manage', 'Manage all lead follow-ups'),
  ('lead.followup.manage_assigned', 'Manage assigned lead follow-ups'),
  ('sales.dashboard.read', 'Read sales dashboards'),
  ('rbac.manage', 'Manage staff roles and permissions'),
  ('audit.read', 'Read audit logs')
ON CONFLICT (code) DO NOTHING;

-- Super admin receives all permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- Inventory manager.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'vehicle.create','vehicle.read_all','vehicle.update','vehicle.submit','vehicle.review',
  'vehicle.publish','vehicle.reject','vehicle.archive','catalog.manage',
  'inventory_source.read','inventory_source.manage','audit.read'
)
WHERE r.name = 'inventory_manager'
ON CONFLICT DO NOTHING;

-- Sales manager.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'lead.read_all','lead.read_assigned','lead.assign','lead.update','lead.activity.create',
  'lead.followup','lead.followup.manage','sales.dashboard.read'
)
WHERE r.name = 'sales_manager'
ON CONFLICT DO NOTHING;

-- Sales agent.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'lead.read_assigned','lead.update_assigned','lead.activity.create',
  'lead.followup.manage_assigned','sales.dashboard.read'
)
WHERE r.name = 'sales_agent'
ON CONFLICT DO NOTHING;

-- Content managers maintain public catalog content but cannot publish inventory.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('vehicle.read_all', 'catalog.manage')
WHERE r.name = 'content_manager'
ON CONFLICT DO NOTHING;
