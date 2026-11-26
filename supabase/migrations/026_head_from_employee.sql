-- 026_head_from_employee.sql
-- Ticking "Department head" on an employee now also gives that person the
-- dashboard "head" role - no manual SQL and no second account:
--   * the employee must have finished sign-up (verified email + LINE link),
--     so they sign in to the dashboard with the same email / password;
--   * un-ticking Department head, disabling the employee, resetting their link
--     or deleting them removes the dashboard access again;
--   * their department is kept in sync with the employee record.
-- Real administrators (role 'admin') and the old hr/it/training accounts are
-- never touched. Needs 025. Safe to re-run; no existing account is changed
-- until an employee row is edited (see the optional backfill at the end).
begin;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'admins' and column_name = 'department') then
    raise exception 'Run 025_dashboard_head_role.sql first. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'users' and column_name = 'claimed_at') then
    raise exception 'Run 008_employee_invites_and_claim.sql first. Nothing was changed.';
  end if;
end $$;

-- 1) Let the sync below change the admins table (same trick 008 uses for sign-up):
--    the identity guard stays active for every other writer.
create or replace function public.protect_admin_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.head_sync', true), '') = 'on' then return new; end if;
  if auth.uid() is null then return new; end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Administrator identity cannot be changed';
  end if;
  if new.role is distinct from old.role then
    if not public.is_workspace_admin() or old.id = auth.uid() then
      raise exception 'Not authorized to change this role';
    end if;
  end if;
  if new.department is distinct from old.department and not public.is_workspace_admin() then
    raise exception 'Not authorized to change this department';
  end if;
  return new;
end; $$;

-- 2) Keep an admins row (role 'head') in step with the employee record.
create or replace function public.sync_head_dashboard_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid;
  v_new uuid;
  v_email text;
  v_confirmed timestamptz;
  v_want boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := old.auth_user_id; end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := new.auth_user_id;
    if coalesce(new.is_department_head, false)
       and coalesce(new.access_enabled, false)
       and v_new is not null
       and new.claimed_at is not null
       and nullif(btrim(new.department), '') is not null then
      select lower(email), email_confirmed_at into v_email, v_confirmed
        from auth.users where id = v_new;
      v_want := v_email is not null
                and v_confirmed is not null          -- email must be verified
                and not exists (select 1 from public.admins a
                                 where lower(a.email) = v_email and a.id <> v_new);
    end if;
  end if;

  perform set_config('app.head_sync', 'on', true);
  -- No longer a head (or the account changed): remove the head role only.
  if v_old is not null and (not v_want or v_old is distinct from v_new) then
    delete from public.admins where id = v_old and role = 'head';
  end if;
  if v_want then
    insert into public.admins (id, email, display_name, role, department)
    values (v_new, v_email, coalesce(nullif(btrim(new.display_name), ''), v_email),
            'head', btrim(new.department))
    on conflict (id) do update
      set display_name = excluded.display_name, department = excluded.department
      where public.admins.role = 'head';
  end if;
  perform set_config('app.head_sync', 'off', true);
  return null;
end; $$;
revoke all on function public.sync_head_dashboard_access() from public, anon, authenticated;

drop trigger if exists sync_head_dashboard_access on public.users;
create trigger sync_head_dashboard_access
  after insert or delete or update of is_department_head, access_enabled, auth_user_id,
                                      claimed_at, department, display_name
  on public.users
  for each row execute function public.sync_head_dashboard_access();

commit;

-- ---------------------------------------------------------------------------
-- OPTIONAL one-time backfill. Department heads who are ALREADY ticked and have
-- already signed up get dashboard access only when their employee row is next
-- edited. To give them access right now (they will be able to answer questions,
-- upload documents and add employees for their department), run:
--
--   update public.users set is_department_head = is_department_head
--   where is_department_head and claimed_at is not null and auth_user_id is not null;
--
-- Check who has the head role afterwards:
--   select email, role, department from public.admins where role = 'head';
-- ---------------------------------------------------------------------------
