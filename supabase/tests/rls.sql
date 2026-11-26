-- Run only on a development Supabase project after the migration.
-- Every fixture and change rolls back. A failed assertion stops execution.
begin;
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-000000001001', 'rls-admin@example.invalid'),
 ('00000000-0000-0000-0000-000000001002', 'rls-training@example.invalid'),
 ('00000000-0000-0000-0000-000000001003', 'rls-outsider@example.invalid');
insert into public.admins(id, email, role) values
 ('00000000-0000-0000-0000-000000001001', 'rls-admin@example.invalid', 'admin'),
 ('00000000-0000-0000-0000-000000001002', 'rls-training@example.invalid', 'training');
insert into public.users(id, line_user_id, display_name) values
 ('00000000-0000-0000-0000-000000002001', 'rls-test-line-id', 'RLS Test Employee');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000001003","role":"authenticated"}', true);
do $$ begin
  if exists(select 1 from public.users) then raise exception 'FAIL: nonmember can read employees'; end if;
  if exists(select 1 from public.admins) then raise exception 'FAIL: nonmember can read admins'; end if;
  if exists(select 1 from public.documents) then raise exception 'FAIL: nonmember can read documents'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000001002","role":"authenticated"}', true);
do $$ begin
  if not exists(select 1 from public.users where line_user_id = 'rls-test-line-id') then raise exception 'FAIL: member cannot read employees'; end if;
end $$;
update public.admins set display_name = 'Updated by self' where id = auth.uid();
do $$ declare denied boolean := false; begin
  begin
    update public.admins set role = 'admin' where id = auth.uid();
  exception when raise_exception then denied := true;
  end;
  if not denied then raise exception 'FAIL: member can escalate their own role'; end if;
  if not exists(select 1 from public.admins where id = auth.uid() and role = 'training') then raise exception 'FAIL: role unexpectedly changed'; end if;
end $$;
do $$ declare changed integer; begin
  update public.system_settings set hotel_name = 'Unauthorized change' where id = 1;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: training role can change system settings'; end if;
end $$;
do $$ declare denied boolean := false; begin
  begin
    insert into public.users(line_user_id, display_name) values ('should-not-insert', 'Unauthorized');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: browser can ingest employee records'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000001001","role":"authenticated"}', true);
update public.admins set role = 'hr' where id = '00000000-0000-0000-0000-000000001002';
do $$ begin
  if not exists(select 1 from public.admins where id = '00000000-0000-0000-0000-000000001002' and role = 'hr') then raise exception 'FAIL: administrator cannot manage roles'; end if;
end $$;
update public.system_settings set hotel_name = 'Authorized test change' where id = 1;
do $$ begin
  if not exists(select 1 from public.system_settings where hotel_name = 'Authorized test change') then raise exception 'FAIL: administrator cannot update configuration'; end if;
end $$;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare denied boolean := false; begin
  begin
    perform 1 from public.users;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: anonymous table access is allowed'; end if;
end $$;
rollback;
