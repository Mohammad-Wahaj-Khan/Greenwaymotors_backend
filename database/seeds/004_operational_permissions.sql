INSERT INTO permissions (code, description) VALUES
  ('vehicle.availability.manage', 'Manage commercial vehicle availability'),
  ('vehicle.media.manage', 'Manage vehicle media and upload intents')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('vehicle.availability.manage', 'vehicle.media.manage')
WHERE r.name = 'inventory_manager' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('vehicle.media.manage')
WHERE r.name = 'content_manager' ON CONFLICT DO NOTHING;
