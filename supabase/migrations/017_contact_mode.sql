-- 017_contact_mode.sql
-- Two-way "แจ้ง/ติดต่อ" conversations from LINE.
-- While contact_mode_until is in the future, the n8n workflow saves the employee's
-- LINE text messages as chat_logs rows (category 'Contact', status 'fallback') instead
-- of sending them to the AI. Staff reply from the dashboard (existing reply feature).
-- Only the trusted n8n backend (service role) writes this column. Safe to re-run.
alter table public.users
  add column if not exists contact_mode_until timestamptz;
