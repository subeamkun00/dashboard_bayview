-- 009_view_invite_code.sql
-- Upgrade for projects that already ran an earlier 008: lets administrators see
-- the pending invite code again in Edit user. Safe to re-run. (A fresh install
-- of the current 008 already contains this.)
begin;

do $$ begin
  if to_regclass('public.employee_invites') is null then
    raise exception 'Run 008_employee_invites_and_claim.sql first. Nothing was changed.';
  end if;
end $$;

alter table public.employee_invites add column if not exists code_plain text;

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

create or replace function public.get_employee_invite(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v public.employee_invites%rowtype;
begin
  if not public.can_manage_employee_users() then
    raise exception 'Only workspace administrators can view invite codes' using errcode = '42501';
  end if;
  select * into v from public.employee_invites
   where user_id = p_user_id and code_plain is not null and expires_at > now();
  if not found then return null; end if;
  return jsonb_build_object('code', v.code_plain, 'expires_at', v.expires_at);
end;
$$;
revoke all on function public.get_employee_invite(uuid) from public, anon;
grant execute on function public.get_employee_invite(uuid) to authenticated;


commit;
