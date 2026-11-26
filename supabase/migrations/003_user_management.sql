-- Apply in the existing Supabase project. Preserve users and question history.
begin;
-- Stop for schema review rather than creating duplicate fields or silently
-- resetting an existing authorization model under a different column name.
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='position')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('job_title','job_position','position_id')) then
    raise exception 'Existing position data detected. Review docs/inspect-employee-schema.sql and reuse that field before applying this migration.';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='access_enabled')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('is_enabled','is_allowed','can_use_ai')) then
    raise exception 'Existing access data detected. Review its meaning before adding a second authorization column.';
  end if;
end $$;
alter table public.users
  add column if not exists nickname text,
  add column if not exists position text,
  add column if not exists access_enabled boolean not null default true;
-- Active/inactive tracks activity, not permission to ask questions.
update public.users set access_enabled = true where access_enabled is null;
alter table public.users alter column access_enabled set default true;
alter table public.users alter column access_enabled set not null;

create or replace function public.can_manage_employee_users() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admins where id = (select auth.uid()) and role = 'admin'); $$;
revoke all on function public.can_manage_employee_users() from public;
grant execute on function public.can_manage_employee_users() to authenticated;

alter table public.users enable row level security;
drop policy if exists "Administrators manage employee profiles and access" on public.users;
create policy "Administrators manage employee profiles and access" on public.users
for update to authenticated
using ((select public.can_manage_employee_users()))
with check ((select public.can_manage_employee_users()));
grant update (department, position, access_enabled) on public.users to authenticated;

-- Guard existing permissive policies and keep routine LINE upserts from
-- accidentally restoring explicitly disabled access.
create or replace function public.protect_employee_management_fields() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.access_enabled is distinct from old.access_enabled
    and not public.can_manage_employee_users() then
    raise exception 'Only workspace administrators can change assistant access' using errcode = '42501';
  end if;
  if auth.role() = 'authenticated' then
    if not public.can_manage_employee_users() then
      raise exception 'Only workspace administrators can manage employees' using errcode = '42501';
    end if;
    if new.id is distinct from old.id or new.line_user_id is distinct from old.line_user_id
      or new.first_seen is distinct from old.first_seen or new.created_at is distinct from old.created_at then
      raise exception 'Integration identifiers and original timestamps cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_employee_management_fields() from public;
drop trigger if exists protect_employee_management_fields on public.users;
create trigger protect_employee_management_fields before update on public.users
for each row execute function public.protect_employee_management_fields();

-- Required pre-AI gate: trusted LINE/n8n calls this after user registration
-- and before retrieval, model invocation, or sending an assistant response.
create or replace function public.can_assistant_respond(p_line_user_id text) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select access_enabled from public.users where line_user_id = p_line_user_id), false); $$;
revoke all on function public.can_assistant_respond(text) from public, anon, authenticated;
grant execute on function public.can_assistant_respond(text) to service_role;

-- Backstop only: prevent new completed questions for disabled users while
-- retaining all existing history. The workflow must ALSO call the pre-AI gate.
create or replace function public.reject_disabled_user_questions() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select access_enabled from public.users where id = new.user_id), false) then
    raise exception 'This user does not have access to the AI assistant' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_disabled_user_questions() from public;
drop trigger if exists reject_disabled_user_questions on public.chat_logs;
create trigger reject_disabled_user_questions before insert on public.chat_logs
for each row execute function public.reject_disabled_user_questions();
commit;
