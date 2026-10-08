-- Create customer-facing notifications for follow-ups that existed before
-- follow-up notifications were introduced. The NOT EXISTS condition makes the
-- migration safe to run once and prevents duplicates for already-notified rows.
INSERT INTO notifications (user_id, type, title, body, data, created_at)
SELECT
  leads.customer_id,
  'lead.followup_scheduled',
  'Follow-up scheduled for your quote request',
  CONCAT(
    'Our sales team will follow up on quote request ',
    leads.reference_no,
    ' on ',
    to_char(lead_followups.due_at AT TIME ZONE 'UTC', 'DD Mon YYYY, HH24:MI'),
    ' UTC.',
    CASE
      WHEN lead_followups.note IS NOT NULL AND lead_followups.note <> ''
        THEN CONCAT(' Note: ', lead_followups.note)
      ELSE ''
    END
  ),
  jsonb_build_object(
    'dueAt', lead_followups.due_at,
    'followupId', lead_followups.id,
    'leadReferenceNo', leads.reference_no,
    'note', lead_followups.note
  ),
  lead_followups.created_at
FROM lead_followups
JOIN leads ON leads.id = lead_followups.lead_id
WHERE leads.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM notifications
    WHERE notifications.user_id = leads.customer_id
      AND notifications.type = 'lead.followup_scheduled'
      AND notifications.data ->> 'followupId' = lead_followups.id::text
  );
