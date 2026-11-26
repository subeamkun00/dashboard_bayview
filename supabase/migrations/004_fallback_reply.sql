-- 004_fallback_reply.sql
-- Run once in Supabase > SQL Editor. Safe to re-run.
-- Adds: "fallback" / "replied" statuses and admin-reply fields on chat_logs.
begin;

-- 1) Allow new statuses (drops the old CHECK on response_status whatever its name is)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.chat_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%response_status%'
  loop
    execute format('alter table public.chat_logs drop constraint %I', c);
  end loop;
end $$;

alter table public.chat_logs
  add constraint chat_logs_response_status_check
  check (response_status in ('success', 'failed', 'fallback', 'replied'));

-- 2) Columns that store the human answer
alter table public.chat_logs
  add column if not exists admin_reply text,
  add column if not exists replied_by uuid references public.admins(id) on delete set null,
  add column if not exists replied_by_name text,
  add column if not exists replied_at timestamptz,
  add column if not exists reply_delivery text check (reply_delivery in ('sent', 'failed')),
  add column if not exists reply_error text;

-- 3) Fast lookup of unanswered fallbacks
create index if not exists chat_logs_fallback_idx
  on public.chat_logs (created_at desc)
  where response_status = 'fallback';

-- 4) Let dashboard members write ONLY the reply-related columns
grant update (response_status, admin_reply, replied_by, replied_by_name,
              replied_at, reply_delivery, reply_error)
  on public.chat_logs to authenticated;

drop policy if exists "Members reply to chats" on public.chat_logs;
create policy "Members reply to chats" on public.chat_logs
  for update to authenticated
  using ((select public.is_workspace_member()))
  with check ((select public.is_workspace_member()));

commit;
