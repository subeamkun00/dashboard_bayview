-- Run manually in Supabase SQL Editor after migrations 003, 006 and 008.
-- Only explicit Disable actions are affected; no existing users are bulk reset.
begin;

do $$ begin
  if to_regclass('public.employee_invites') is null
     or to_regprocedure('public.can_manage_employee_users()') is null then
    raise exception 'Apply migrations 003, 006 and 008 first. Nothing was changed.';
  end if;
end $$;

create or replace function public.disable_employee_and_reset_link(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  employee public.users%rowtype;
  previous_claim text := coalesce(current_setting('app.employee_claim', true), '');
begin
  if not public.can_manage_employee_users() then
    raise exception 'Only workspace administrators can disable employees'
      using errcode = '42501';
  end if;

  -- Serialize against employee claims. Keep the same employee ID and history.
  select * into employee from public.users where id = p_user_id for update;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  -- Use the existing trusted claim/reset mechanism for protected LINE fields.
  perform set_config('app.employee_claim', 'on', true);
  update public.users
     set access_enabled = false,
         auth_user_id = null, line_user_id = null, claimed_at = null,
         line_id = null, email = null
   where id = p_user_id
   returning * into employee;
  perform set_config('app.employee_claim', previous_claim, true);

  -- Revoke old invites; enabling access later never restores a previous link.
  delete from public.employee_invites where user_id = p_user_id;
  return to_jsonb(employee);
end;
$$;

revoke all on function public.disable_employee_and_reset_link(uuid) from public, anon;
grant execute on function public.disable_employee_and_reset_link(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
