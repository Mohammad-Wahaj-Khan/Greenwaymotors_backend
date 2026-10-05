INSERT INTO permissions (code, description) VALUES
  ('quote.accept', 'Accept a quote and convert its lead into a deal'),
  ('quote.reject', 'Reject a sent quote'),
  ('quote.cancel', 'Cancel a draft or sent quote'),
  ('quote.expire', 'Expire a sent quote'),
  ('quote.cost.input', 'Submit validated internal quote cost components'),
  ('deal.update', 'Update deal fulfillment and operational state'),
  ('deal.task.manage', 'Manage deal fulfillment tasks'),
  ('deal.cancel', 'Cancel a deal and release its reservation'),
  ('deal.reserve', 'Create and manage exact vehicle reservations')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('quote.accept','quote.reject','quote.cancel','quote.expire','quote.cost.input','deal.update','deal.task.manage','deal.cancel','deal.reserve')
WHERE r.name = 'sales_manager' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('quote.accept','deal.reserve')
WHERE r.name = 'sales_agent' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
 ('deal.read_all','deal.update','deal.task.manage','deal.cancel','deal.complete')
WHERE r.name = 'finance' ON CONFLICT DO NOTHING;
