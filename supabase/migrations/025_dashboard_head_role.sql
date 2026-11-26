-- 025_dashboard_head_role.sql
-- Dashboard accounts become: administrator (owner/admin) and department head.
--   * A department head can answer questions and upload documents (like every
--     dashboard member can today) and can ADD employees - only to their own
--     department.
--   * A department head cannot edit employees and can never change
--     "All-department document access" or "Department head" (administrators only).
-- The old hr / it / training roles stay valid so existing accounts keep working.
-- Needs 003, 008/009, 013 and 024. Safe to re-run; nothing is deleted.
begin;

do $$ begin
  if to_regprocedure('public.can_manage_employee_users()') is null then
    raise exception 'Run 003_user_management.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.issue_employee_invite(uuid, boolean)') is null
     or to_regprocedure('public.norm_dept(text)') is null then
    raise exception 'Run 008 and 009 first. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'users' and column_name = 'is_department_head') then
    raise exception 'Run 013_department_heads.sql first. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'users' and column_name = 'can_access_all_documents') then
    raise exception 'Run 024_all_documents_access.sql first. Nothing was changed.';
  end if;
end $$;

-- 1) New role "head" + the department a head belongs to.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.admins'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%training%'  -- only the role check lists 'training'
  loop
    execute format('alter table public.admins drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.admins
  add constraint admins_role_check check (role in ('admin', 'head', 'hr', 'it', 'training'));
alter table public.admins add column if not exists department text;
alter table public.admins drop constraint if exists admins_head_department_check;
alter table public.admins
  add constraint admins_head_department_check
  check (role <> 'head' or nullif(btrim(department), '') is not null);

-- 2) A signed-in person can edit their own admins row, so the department must
--    be protected like the role: only an administrator may change it.
create or replace function public.protect_admin_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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

-- 3) Who may add an employee: any administrator, or a department head for
--    their own department only.
create or replace function public.can_add_employee(p_department text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admins a
    where a.id = (select auth.uid())
      and (a.role = 'admin'
           or (a.role = 'head'
               and nullif(btrim(a.department), '') is not null
               and public.norm_dept(a.department) = public.norm_dept(p_department)))
  );
$$;
revoke all on function public.can_add_employee(text) from public, anon;
grant execute on function public.can_add_employee(text) to authenticated;

drop policy if exists "Department heads add employees" on public.users;
create policy "Department heads add employees" on public.users
  for insert to authenticated
  with check (public.can_add_employee(department));

-- 4) Only administrators may create an employee who is a department head or who
--    has all-department access (also blocks direct Data API calls).
create or replace function public.protect_employee_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'authenticated' and not public.can_manage_employee_users() then
    if coalesce(new.is_department_head, false) or coalesce(new.can_access_all_documents, false) then
      raise exception 'Only workspace administrators can set department head or all-department access'
        using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists protect_employee_insert on public.users;
create trigger protect_employee_insert before insert on public.users
  for each row execute function public.protect_employee_insert();
revoke insert (can_access_all_documents) on public.users from authenticated;

-- 5) Invite code for a NEW employee: administrators as before; a department head
--    only for a not-yet-linked employee of their own department, and never a reset.
create or replace function public.issue_employee_invite(p_user_id uuid, p_reset boolean default false)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  raw bytea := extensions.gen_random_bytes(8);
  code text := '';
  i int;
begin
  if not public.can_manage_employee_users() then
    if p_reset or not exists (
         select 1
           from public.admins a
           join public.users u on u.id = p_user_id
          where a.id = auth.uid() and a.role = 'head'
            and nullif(btrim(a.department), '') is not null
            and public.norm_dept(a.department) = public.norm_dept(u.department)
            and u.claimed_at is null) then
      raise exception 'Only workspace administrators can issue invite codes' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
  end loop;
  perform set_config('app.employee_claim', 'on', true);
  if p_reset then
    update public.users
       set auth_user_id = null, line_user_id = null, claimed_at = null,
           line_id = null, email = null
     where id = p_user_id;
  end if;
  insert into public.employee_invites (user_id, code_hash, code_plain, expires_at)
  values (p_user_id, extensions.crypt(code, extensions.gen_salt('bf')),
          substr(code, 1, 4) || '-' || substr(code, 5, 4), now() + interval '14 days')
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, code_plain = excluded.code_plain,
        expires_at = excluded.expires_at,
        failed_attempts = 0, locked_until = null, created_at = now();
  return substr(code, 1, 4) || '-' || substr(code, 5, 4);
end;
$$;
revoke all on function public.issue_employee_invite(uuid, boolean) from public, anon;
grant execute on function public.issue_employee_invite(uuid, boolean) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Give someone the department-head dashboard role (run in the SQL editor).
-- First create their login in Supabase > Authentication > Users, then:
--
--   insert into public.admins (id, email, display_name, role, department)
--   values ('<auth user id>', '<email>', '<name>', 'head', '<department name>')
--   on conflict (id) do update set role = 'head', department = excluded.department;
--
-- The department must be written the way the organization chart spells it
-- (for example Housekeeping). To check who has which role:
--   select email, role, department from public.admins order by role;
-- ---------------------------------------------------------------------------
