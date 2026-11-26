-- 011_notify_line_linked.sql
-- When an employee finishes the web sign-up, tell n8n so the bot can send a
-- "you are logged in" message to their LINE chat.
--
-- BEFORE running: import the n8n workflow test2_step5.json, copy the PRODUCTION
-- URL of the node "Line Linked Webhook", then edit the two values below.
-- Uses the pg_net extension (the same one Supabase Database Webhooks use); this
-- file turns it on if needed. Safe to re-run.
do $$
declare
  n8n_url text := 'https://jatuporn.app.n8n.cloud/webhook/bayview-line-linked';   -- <== edit
  secret  text := 'bayview-secret-2026-xK9pL3';                                  -- <== edit (same value as the Header Auth credential in n8n)
begin
  if n8n_url like '%YOUR-N8N-HOST%' or secret like 'YOUR-%' then
    raise exception 'Edit n8n_url and secret at the top of this file first. Nothing was changed.';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    begin
      create extension if not exists pg_net;
    exception when others then
      raise exception 'Could not enable pg_net automatically (%). Turn it on in Supabase > Database > Extensions > pg_net, then run this again. Nothing was changed.', sqlerrm;
    end;
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'pg_net is not available. Turn it on in Supabase > Database > Extensions > pg_net, then run this again. Nothing was changed.';
  end if;

  -- The function carries the URL and secret; nobody but the database owner can read or call it.
  execute format($f$
    create or replace function public.notify_line_linked() returns trigger
    language plpgsql security definer set search_path = '' as $body$
    begin
      perform net.http_post(
        url := %1$L,
        headers := %2$L::jsonb,
        body := jsonb_build_object(
          'type', 'UPDATE', 'table', 'users', 'schema', 'public',
          'record', jsonb_build_object(
            'line_user_id', new.line_user_id, 'first_name', new.first_name,
            'display_name', new.display_name, 'position', new."position",
            'department', new.department, 'claimed_at', new.claimed_at),
          'old_record', jsonb_build_object('claimed_at', old.claimed_at)),
        timeout_milliseconds := 5000);
      return new;
    end
    $body$
  $f$, n8n_url,
    json_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret)::text);
  revoke all on function public.notify_line_linked() from public, anon, authenticated;

  drop trigger if exists notify_line_linked on public.users;
  -- Fires once per sign-up (claimed_at goes from empty to a date), never for normal chat activity.
  create trigger notify_line_linked after update of claimed_at on public.users
    for each row when (old.claimed_at is null and new.claimed_at is not null)
    execute function public.notify_line_linked();
end $$;
