-- 007_drop_legacy_employees.sql
-- RUN ONLY AFTER: (1) 006 succeeded, (2) the n8n workflow no longer reads
-- public.employees, (3) you checked the roster in the dashboard.
-- It refuses to drop the table if any legacy employee is missing from users.
do $$
declare
  missing int;
  fk record;
begin
  if to_regclass('public.employees') is null then
    raise notice 'public.employees is already gone.';
    return;
  end if;
  if not exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='users'
                  and column_name='employee_id') then
    raise exception 'Run 006_unify_employees_into_users.sql first. Nothing was dropped.';
  end if;
  if exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='employees'
              and column_name='employee_id') then
    execute $q$
      select count(*) from public.employees e
      where nullif(trim(e.employee_id), '') is not null
        and not exists (select 1 from public.users u
                        where u.employee_id = nullif(trim(e.employee_id), ''))
    $q$ into missing;
    if missing > 0 then
      raise exception '% legacy employee(s) are not in public.users yet. Nothing was dropped.', missing;
    end if;
  end if;
  -- Other tables (e.g. corrections.created_by) may point at employees. Drop only
  -- those foreign keys, by name, so the rows in those tables are untouched.
  -- Views or functions that depend on employees are NOT removed: if any exist,
  -- the drop below fails and this whole block is rolled back.
  for fk in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where contype = 'f' and confrelid = 'public.employees'::regclass
  loop
    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    raise notice 'Dropped foreign key % on %', fk.conname, fk.tbl;
  end loop;
  drop table public.employees;
  raise notice 'public.employees dropped.';
end $$;
