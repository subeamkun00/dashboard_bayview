-- 027_head_edit_employees.sql
-- A department head can open the employees of THEIR OWN department and correct
-- their contact details: first name, last name (display name) and phone number.
-- Everything else stays administrator-only: department, position, Department head,
-- All-department document access, enabling / disabling access, invite codes.
-- Needs 003, 008, 025. Safe to re-run; no data is changed.
begin;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'admins' and column_name = 'department') then
    raise exception 'Run 025_dashboard_head_role.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.can_manage_employee_users()') is null
     or to_regprocedure('public.norm_dept(text)') is null then
    raise exception 'Run 003 and 008 first. Nothing was changed.';
  end if;
end $$;

-- 1) Is the signed-in dashboard user a department head of this department?
create or replace function public.is_head_of_department(p_department text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admins a
    where a.id = (select auth.uid())
      and a.role = 'head'
      and nullif(btrim(a.department), '') is not null
      and public.norm_dept(a.department) = public.norm_dept(p_department)
  );
$$;
revoke all on function public.is_head_of_department(text) from public, anon;
grant execute on function public.is_head_of_department(text) to authenticated;

-- 2) Row access: a head may update employees of their own department only.
drop policy if exists "Department heads edit their department's employees" on public.users;
create policy "Department heads edit their department's employees" on public.users
  for update to authenticated
  using (public.is_head_of_department(department))
  with check (public.is_head_of_department(department));

-- 3) Column guard: a head may change ONLY first_name, last_name, display_name and phone.
--    (Same function as 008, with one extra branch for department heads.)
create or replace function public.protect_employee_management_fields() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('app.employee_claim', true), '') = 'on' then
    return new;
  end if;
  if new.access_enabled is distinct from old.access_enabled
    and not public.can_manage_employee_users() then
    raise exception 'Only workspace administrators can change assistant access' using errcode = '42501';
  end if;
  if auth.role() = 'authenticated' then
    if not public.can_manage_employee_users() then
      if not public.is_head_of_department(old.department)
         or (to_jsonb(new) - 'first_name' - 'last_name' - 'display_name' - 'phone' - 'updated_at')
            is distinct from
            (to_jsonb(old) - 'first_name' - 'last_name' - 'display_name' - 'phone' - 'updated_at') then
        raise exception 'Only workspace administrators can manage employees' using errcode = '42501';
      end if;
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

commit;
