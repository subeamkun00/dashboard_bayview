-- 012_normalize_org_names.sql
-- Writes department names the way the organization chart spells them (for example
-- "Front Office" becomes "Front Office Department") for existing employees and
-- documents, so the Users page, the Documents page and the AI all use one list.
-- Positions are NOT changed (see the report query in the instructions).
-- Needs migration 008 (norm_dept). Safe to re-run.
begin;

do $$ begin
  if to_regprocedure('public.norm_dept(text)') is null then
    raise exception 'Run 008_employee_invites_and_claim.sql first. Nothing was changed.';
  end if;
end $$;

do $$
declare u int; d int;
begin
  with catalog(name) as (values
    ('Executive Office Department'),
    ('Accounting Department'),
    ('Front Office Department'),
    ('Housekeeping Department'),
    ('Food & Beverage Department'),
    ('Main Kitchen Department'),
    ('Engineering Department'),
    ('Human Resources Department'),
    ('IT')
  )
  update public.users x set department = c.name
    from catalog c
   where public.norm_dept(x.department) = public.norm_dept(c.name)
     and x.department is distinct from c.name;
  get diagnostics u = row_count;

  if to_regclass('public.document_files') is not null then
    with catalog(name) as (values
    ('Executive Office Department'),
    ('Accounting Department'),
    ('Front Office Department'),
    ('Housekeeping Department'),
    ('Food & Beverage Department'),
    ('Main Kitchen Department'),
    ('Engineering Department'),
    ('Human Resources Department'),
    ('IT')
    )
    update public.document_files x set department = c.name
      from catalog c
     where public.norm_dept(x.department) = public.norm_dept(c.name)
       and x.department is distinct from c.name;
    get diagnostics d = row_count;
  end if;
  raise notice 'Department names written in catalog form: % employees, % documents.', u, coalesce(d, 0);
end $$;

commit;
