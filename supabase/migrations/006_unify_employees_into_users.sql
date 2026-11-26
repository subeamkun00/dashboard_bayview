-- 006_unify_employees_into_users.sql
-- Makes public.users the ONE employee table (roster + LINE activity).
-- ADDITIVE: nothing is dropped or deleted here. Safe to re-run.
-- Run after 003/004/005. Read the NOTICE lines in the SQL Editor output.
begin;

-- 0) Prerequisite: 003_user_management.sql (position, access_enabled and the
--    administrator rules this file builds on). Stop early with a clear message.
do $$ begin
  if to_regprocedure('public.can_manage_employee_users()') is null then
    raise exception 'Run 003_user_management.sql first, then run this file again. Nothing was changed.';
  end if;
end $$;

-- 1) Roster fields + the link to web login (Supabase Auth)
alter table public.users
  add column if not exists employee_id text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

-- A roster employee exists before they ever link LINE, so LINE id may be empty.
alter table public.users alter column line_user_id drop not null;

create unique index if not exists users_employee_id_key
  on public.users (employee_id) where employee_id is not null;
create unique index if not exists users_email_key
  on public.users (lower(email)) where email is not null;
create unique index if not exists users_auth_user_key
  on public.users (auth_user_id) where auth_user_id is not null;

-- 2) Copy the legacy roster (public.employees) into public.users.
--    Works with whatever columns exist; a missing column is treated as empty.
--    The legacy password column is intentionally NOT copied.
do $$
declare
  c text;
  x jsonb := '{}'::jsonb;
  linked int;
  added int;
begin
  if to_regclass('public.employees') is null then
    raise notice 'No public.employees table found: nothing to copy.';
    return;
  end if;
  foreach c in array array['employee_id','name','first_name','last_name',
    'department','position','phone','email','line_user_id'] loop
    x := x || jsonb_build_object(c,
      case when exists(select 1 from information_schema.columns
        where table_schema='public' and table_name='employees' and column_name=c)
      then 'e.' || quote_ident(c) || '::text' else 'null::text' end);
  end loop;

  -- 2a) People who already chatted: attach roster data to their existing row.
  execute format($q$
    update public.users u set
      employee_id  = coalesce(u.employee_id, nullif(trim(%1$s), '')),
      display_name = coalesce(nullif(trim(%2$s), ''), u.display_name),
      first_name   = coalesce(u.first_name, nullif(trim(%3$s), ''),
                       nullif(split_part(trim(%2$s), ' ', 1), '')),
      last_name    = coalesce(u.last_name, nullif(trim(%4$s), ''),
                       nullif(trim(substr(trim(%2$s),
                         length(split_part(trim(%2$s), ' ', 1)) + 1)), '')),
      department   = coalesce(nullif(trim(%5$s), ''), u.department),
      position     = coalesce(nullif(trim(%6$s), ''), u.position),
      phone        = coalesce(u.phone, nullif(trim(%7$s), '')),
      email        = coalesce(u.email, nullif(lower(trim(%8$s)), ''))
    from public.employees e
    where %9$s is not null and u.line_user_id = %9$s
  $q$, x->>'employee_id', x->>'name', x->>'first_name', x->>'last_name',
       x->>'department', x->>'position', x->>'phone', x->>'email',
       x->>'line_user_id');
  get diagnostics linked = row_count;

  -- 2b) Roster people who never chatted: create their row (no LINE id yet).
  execute format($q$
    insert into public.users
      (line_user_id, employee_id, display_name, first_name, last_name,
       department, position, phone, email, status)
    select %9$s, nullif(trim(%1$s), ''),
      coalesce(nullif(trim(%2$s), ''),
               nullif(trim(concat_ws(' ', %3$s, %4$s)), ''), 'Employee'),
      coalesce(nullif(trim(%3$s), ''), nullif(split_part(trim(%2$s), ' ', 1), '')),
      coalesce(nullif(trim(%4$s), ''),
               nullif(trim(substr(trim(%2$s),
                 length(split_part(trim(%2$s), ' ', 1)) + 1)), '')),
      coalesce(nullif(trim(%5$s), ''), 'Unknown'),
      nullif(trim(%6$s), ''), nullif(trim(%7$s), ''),
      nullif(lower(trim(%8$s)), ''), 'inactive'
    from public.employees e
    where not exists (
      select 1 from public.users u
      where (nullif(trim(%1$s), '') is not null
             and u.employee_id = nullif(trim(%1$s), ''))
         or (%9$s is not null and u.line_user_id = %9$s))
  $q$, x->>'employee_id', x->>'name', x->>'first_name', x->>'last_name',
       x->>'department', x->>'position', x->>'phone', x->>'email',
       x->>'line_user_id');
  get diagnostics added = row_count;
  raise notice 'Roster merged: % existing users updated, % new employees added.',
    linked, added;
end $$;

-- 3) Let workspace administrators add and edit employees from the dashboard.
grant insert (employee_id, first_name, last_name, display_name, department,
              position, phone, email, access_enabled, status)
  on public.users to authenticated;
grant update (employee_id, first_name, last_name, display_name, phone, email,
              department, position, access_enabled)
  on public.users to authenticated;
drop policy if exists "Administrators add employees" on public.users;
create policy "Administrators add employees" on public.users
  for insert to authenticated
  with check ((select public.can_manage_employee_users()));

commit;
