-- 008_employee_invites_and_claim.sql
-- Secure employee sign-up: HR hands out a one-time invite code, the employee
-- proves who they are on the web, and only then are their LINE account and
-- email attached to their roster row.
-- Run after 003-007. Safe to re-run. Nothing is dropped or deleted.
begin;

do $$ begin
  if to_regprocedure('public.can_manage_employee_users()') is null then
    raise exception 'Run 003_user_management.sql first. Nothing was changed.';
  end if;
  if not exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='users'
                  and column_name='employee_id') then
    raise exception 'Run 006_unify_employees_into_users.sql first. Nothing was changed.';
  end if;
end $$;

create extension if not exists pgcrypto with schema extensions;

-- 1) Extra roster fields
alter table public.users
  add column if not exists line_id text,          -- LINE ID the employee typed (display only)
  add column if not exists claimed_at timestamptz; -- when they completed web sign-up

-- 2) Invite codes live in their own table so the hash is never sent to browsers.
create table if not exists public.employee_invites (
  user_id uuid primary key references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
-- code_plain lets administrators look the pending code up again in the dashboard.
-- It is only readable through get_employee_invite() below (administrators only)
-- and disappears as soon as the employee signs up or the code is replaced.
alter table public.employee_invites add column if not exists code_plain text;
alter table public.employee_invites enable row level security;
revoke all on public.employee_invites from anon, authenticated;

-- 3) One-time links created by the LINE bot (n8n, service role) for people whose
--    LINE account is not linked yet. The token identifies the LINE user.
create table if not exists public.line_link_tokens (
  token text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  line_user_id text not null,
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists line_link_tokens_line_idx on public.line_link_tokens (line_user_id);
alter table public.line_link_tokens enable row level security;
revoke all on public.line_link_tokens from anon, authenticated;

-- 4) Let the trusted functions below change LINE/auth fields. The existing
--    protection trigger still blocks every other direct edit from the browser.
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

-- 5) Text helpers for matching what the employee typed against the roster
create or replace function public.norm_text(v text) returns text
language sql immutable set search_path = ''
as $$ select lower(regexp_replace(trim(coalesce(v, '')), '\s+', ' ', 'g')) $$;

-- "Front Office Department" and "Front Office" are the same department.
create or replace function public.norm_dept(v text) returns text
language sql immutable set search_path = ''
as $$ select trim(regexp_replace(public.norm_text(v), ' department$', '')) $$;

-- 6) Administrators: create / replace an employee's invite code.
--    Returns the code ONCE (only its hash is stored). p_reset also unlinks the
--    employee so they can sign up again (new LINE account, new email...).
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

-- Administrators: read the pending invite code of an employee (null if there is
-- none, it expired, or it was created before codes could be viewed).
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

-- 7) Shared check used by both steps of the web sign-up (internal).
--    Compares first name, last name, department, position, employee ID and the
--    invite code. Nickname and mobile are NOT identity checks. A wrong attempt
--    is counted per employee; 5 wrong attempts lock the invite for 30 minutes.
--    Every failure looks identical, so nothing reveals which part was wrong.
create or replace function public._check_roster(
  p_employee_id text, p_first_name text, p_last_name text,
  p_department text, p_position text, p_invite_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.users%rowtype;
  v_inv public.employee_invites%rowtype;
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_ok boolean;
begin
  select * into v_row from public.users
   where lower(employee_id) = lower(nullif(trim(p_employee_id), '')) for update;
  if not found then return null; end if;
  select * into v_inv from public.employee_invites where user_id = v_row.id for update;
  if not found or v_inv.expires_at < now()
     or (v_inv.locked_until is not null and v_inv.locked_until > now()) then
    return null;
  end if;
  v_ok := v_row.auth_user_id is null
    and public.norm_text(v_row.first_name) = public.norm_text(p_first_name)
    and public.norm_text(v_row.last_name) = public.norm_text(p_last_name)
    and public.norm_dept(v_row.department) = public.norm_dept(p_department)
    and public.norm_text(v_row."position") = public.norm_text(p_position)
    and v_code <> ''
    and v_inv.code_hash = extensions.crypt(v_code, v_inv.code_hash);
  if not v_ok then
    update public.employee_invites
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '30 minutes' else null end
     where user_id = v_row.id;
    return null;
  end if;
  return v_row.id;
end;
$$;
revoke all on function public._check_roster(text,text,text,text,text,text) from public, anon, authenticated;

-- 8) Step 1 of the web sign-up (before any email is sent). Callable without
--    login; changes nothing when it succeeds.
create or replace function public.verify_employee_details(
  p_token text, p_employee_id text, p_first_name text, p_last_name text,
  p_department text, p_position text, p_invite_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.line_link_tokens
                 where token = p_token and used_at is null and expires_at > now()) then
    return jsonb_build_object('ok', false, 'code', 'LINK_EXPIRED');
  end if;
  if public._check_roster(p_employee_id, p_first_name, p_last_name,
                          p_department, p_position, p_invite_code) is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_MATCHED');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.verify_employee_details(text,text,text,text,text,text,text) from public;
grant execute on function public.verify_employee_details(text,text,text,text,text,text,text) to anon, authenticated;

-- 9) Step 2: complete the sign-up AFTER the email code was verified (the caller
--    is then logged in with a confirmed email). Re-checks everything, then saves
--    email, LINE account, nickname and mobile number on the roster row.
create or replace function public.claim_employee(
  p_token text, p_employee_id text, p_first_name text, p_last_name text,
  p_department text, p_position text, p_invite_code text,
  p_nickname text, p_phone text, p_line_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_token public.line_link_tokens%rowtype;
  v_id uuid;
  v_stray public.users%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_SIGNED_IN');
  end if;
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null or v_email is null then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_UNVERIFIED');
  end if;
  select * into v_token from public.line_link_tokens
   where token = p_token and used_at is null and expires_at > now() for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'LINK_EXPIRED');
  end if;
  v_id := public._check_roster(p_employee_id, p_first_name, p_last_name,
                               p_department, p_position, p_invite_code);
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_MATCHED');
  end if;
  if exists (select 1 from public.users where lower(email) = lower(v_email) and id <> v_id) then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_IN_USE');
  end if;
  select * into v_stray from public.users
   where line_user_id = v_token.line_user_id and id <> v_id for update;
  if found then
    if v_stray.employee_id is not null then
      return jsonb_build_object('ok', false, 'code', 'LINE_ALREADY_LINKED');
    end if;
    -- An old anonymous row created before sign-up existed: keep its chat history.
    update public.chat_logs set user_id = v_id where user_id = v_stray.id;
    delete from public.users where id = v_stray.id;
  end if;
  perform set_config('app.employee_claim', 'on', true);
  update public.users
     set auth_user_id = v_uid,
         email = lower(v_email),
         line_user_id = v_token.line_user_id,
         line_id = nullif(trim(p_line_id), ''),
         nickname = coalesce(nullif(trim(p_nickname), ''), nickname),
         phone = coalesce(nullif(trim(p_phone), ''), phone),
         claimed_at = now(),
         status = 'active'
   where id = v_id;
  update public.line_link_tokens set used_at = now() where token = v_token.token;
  delete from public.employee_invites where user_id = v_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.claim_employee(text,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.claim_employee(text,text,text,text,text,text,text,text,text,text) to authenticated;

-- 10) Administrators may edit these roster fields in the dashboard.
grant update (phone, line_id, nickname) on public.users to authenticated;

commit;
