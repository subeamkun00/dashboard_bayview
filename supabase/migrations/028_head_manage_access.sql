-- 028_head_manage_access.sql
-- A department head can, for employees of THEIR OWN department:
--   * enable / disable their access to the assistant (disabling also unlinks LINE),
--   * issue an invite code and read the pending code,
--   * reset the LINE link.
-- A head can NOT do this for department heads (so never for themselves or another
-- head) - those stay with administrators. Needs 003, 008/009, 018, 025 and 027.
-- Safe to re-run.
begin;

do $$ begin
  if to_regprocedure('public.is_head_of_department(text)') is null then
    raise exception 'Run 027_head_edit_employees.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.disable_employee_and_reset_link(uuid)') is null then
    raise exception 'Run 018_disable_employee_reset_link.sql first. Nothing was changed.';
  end if;
end $$;

-- 1) May the signed-in department head manage this employee?
create or replace function public.head_can_manage(p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.users u
      join public.admins a on a.id = (select auth.uid()) and a.role = 'head'
     where u.id = p_user_id
       and nullif(btrim(a.department), '') is not null
       and public.norm_dept(a.department) = public.norm_dept(u.department)
       and not coalesce(u.is_department_head, false)
  );
$$;
revoke all on function public.head_can_manage(uuid) from public, anon;
grant execute on function public.head_can_manage(uuid) to authenticated;

-- 2) Disable + unlink LINE (same function as 018, wider permission check).
create or replace function public.disable_employee_and_reset_link(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  employee public.users%rowtype;
  previous_claim text := coalesce(current_setting('app.employee_claim', true), '');
begin
  if not public.can_manage_employee_users() and not public.head_can_manage(p_user_id) then
    raise exception 'Only workspace administrators can disable employees'
      using errcode = '42501';
  end if;
  select * into employee from public.users where id = p_user_id for update;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  perform set_config('app.employee_claim', 'on', true);
  update public.users
     set access_enabled = false,
         auth_user_id = null, line_user_id = null, claimed_at = null,
         line_id = null, email = null
   where id = p_user_id
   returning * into employee;
  perform set_config('app.employee_claim', previous_claim, true);
  delete from public.employee_invites where user_id = p_user_id;
  return to_jsonb(employee);
end;
$$;
revoke all on function public.disable_employee_and_reset_link(uuid) from public, anon;
grant execute on function public.disable_employee_and_reset_link(uuid) to authenticated;

-- 3) Read the pending invite code.
create or replace function public.get_employee_invite(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v public.employee_invites%rowtype;
begin
  if not public.can_manage_employee_users() and not public.head_can_manage(p_user_id) then
    raise exception 'Only workspace administrators can view invite codes' using errcode = '42501';
  end if;
  select * into v from public.employee_invites
   where user_id = p_user_id and code_plain is not null and expires_at > now();
  if not found then return null; end if;
  return jsonb_build_object('code', v.code_plain, 'expires_at', v.expires_at);
end;
$$;

-- 4) Issue an invite code / reset the LINE link.
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
  if not public.can_manage_employee_users() and not public.head_can_manage(p_user_id) then
    raise exception 'Only workspace administrators can issue invite codes' using errcode = '42501';
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

-- 5) Enable access: a head may switch access ON (never OFF directly - disabling goes
--    through the function in step 2 so LINE is always unlinked) and only for people
--    they may manage. Everything else in the 027 column guard is unchanged.
create or replace function public.protect_employee_management_fields() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('app.employee_claim', true), '') = 'on' then
    return new;
  end if;
  if new.access_enabled is distinct from old.access_enabled
    and not public.can_manage_employee_users()
    and not (auth.role() = 'authenticated' and new.access_enabled
             and public.head_can_manage(old.id)) then
    raise exception 'Only workspace administrators can change assistant access' using errcode = '42501';
  end if;
  if auth.role() = 'authenticated' then
    if not public.can_manage_employee_users() then
      if not public.is_head_of_department(old.department)
         or (to_jsonb(new) - 'first_name' - 'last_name' - 'display_name' - 'phone' - 'access_enabled' - 'updated_at')
            is distinct from
            (to_jsonb(old) - 'first_name' - 'last_name' - 'display_name' - 'phone' - 'access_enabled' - 'updated_at') then
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
