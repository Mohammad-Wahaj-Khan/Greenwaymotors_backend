INSERT INTO permissions (code, description) VALUES
  ('staff.read', 'Read staff accounts'),
  ('staff.manage', 'Create and manage ordinary staff accounts'),
  ('customer.read', 'Read customer accounts under administration'),
  ('dashboard.read', 'Read operational dashboard summaries'),
  ('analytics.read', 'Read operational reports'),
  ('analytics.financial.read', 'Read financial and margin reports'),
  ('cms.read', 'Read CMS records'),
  ('cms.manage', 'Create and edit CMS records'),
  ('cms.publish', 'Publish and unpublish CMS records'),
  ('vehicle.import', 'Create and manage internal vehicle imports'),
  ('vehicle.history.read', 'Read vehicle audit history'),
  ('mfa.manage', 'Manage own staff multi-factor authentication'),
  ('notification.read', 'Read and mark own notifications as read')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin' ON CONFLICT DO NOTHING;

-- Admin can run operations but cannot alter roles, permissions, or read confidential cost data.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'staff.read','staff.manage','customer.read','dashboard.read','analytics.read',
  'audit.read','cms.read','cms.manage','cms.publish','vehicle.import',
  'vehicle.history.read','market.read','market.manage','inventory_source.read',
  'inventory_source.manage','vehicle.create','vehicle.read_all','vehicle.update',
  'vehicle.submit','vehicle.publish','vehicle.review','vehicle.reject','vehicle.archive',
  'vehicle.availability.manage','vehicle.media.manage','vehicle_market.manage',
  'lead.read_all','lead.read_assigned','lead.assign','lead.update','lead.activity.create',
  'lead.followup','lead.followup.manage','quote.create','quote.read_all','quote.update',
  'quote.send','quote.accept','quote.reject','quote.cancel','quote.expire',
  'deal.read_all','deal.manage','deal.complete','deal.update','deal.task.manage',
  'deal.cancel','deal.reserve','notification.read'
) WHERE r.name = 'admin' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN
 ('staff.read','dashboard.read','analytics.read','analytics.financial.read','audit.read',
  'lead.read_all','quote.read_all','deal.read_all','vehicle.read_all','market.read','notification.read')
WHERE r.name='sales_manager' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN
 ('dashboard.read','analytics.read','lead.read_assigned','quote.read_assigned','deal.read_assigned','notification.read')
WHERE r.name='sales_agent' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN
 ('cms.read','cms.manage','cms.publish','catalog.manage','vehicle.read_all','notification.read')
WHERE r.name='content_manager' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN
 ('analytics.financial.read','deal.read_all','quote.cost.read','vehicle.cost.read')
WHERE r.name='finance' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN
 ('vehicle.import','vehicle.create','vehicle.read_all','vehicle.update','vehicle.review',
  'vehicle.publish','vehicle.reject','vehicle.archive','vehicle.history.read','vehicle_market.manage',
  'vehicle.media.manage','vehicle.availability.manage','inventory_source.read',
  'inventory_source.manage','catalog.manage','market.read','market.manage','audit.read','notification.read')
WHERE r.name='inventory_manager' ON CONFLICT DO NOTHING;
