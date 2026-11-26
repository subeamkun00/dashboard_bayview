-- 024_all_documents_access.sql
-- Per-employee switch "all-department document access" (for example IT support).
-- When users.can_access_all_documents is true, that employee gets answers from,
-- and can receive the original file of, ALL documents - whatever the department
-- or position. Everyone else keeps the rules from 010 / 013 / 023.
-- Needs 013 (department heads) and 023 (accessible_documents).
-- Safe to re-run; nothing is deleted.
--
-- The dashboard's Employees page gets an "All-department document access" checkbox.
-- Only administrators can save it (the API route and the database policy both
-- require the admin role).
begin;

do $$ begin
  if to_regprocedure('public.norm_dept(text)') is null then
    raise exception 'Run 008_employee_invites_and_claim.sql first. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'users' and column_name = 'is_department_head') then
    raise exception 'Run 013_department_heads.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.accessible_documents(text, text, boolean)') is null
     and to_regprocedure('public.accessible_documents(text, text, boolean, boolean)') is null then
    raise exception 'Run 023_accessible_documents.sql first. Nothing was changed.';
  end if;
end $$;

-- 1) The switch (default: off for everyone).
alter table public.users
  add column if not exists can_access_all_documents boolean not null default false;

-- Let the dashboard save the checkbox. Only UPDATE is granted (and the users
-- update policy is administrator-only), so nobody else - including department
-- heads - can set it. It is deliberately NOT insertable from the browser.
grant update (can_access_all_documents) on public.users to authenticated;
revoke insert (can_access_all_documents) on public.users from authenticated;

-- 2) The search the AI uses: one extra way in - filter.all_access = 'true'.
do $$
declare
  id_type text; emb_type text; vec_schema text;
begin
  if to_regclass('public.documents') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'documents' and column_name = 'embedding') then
    raise notice 'No vector table public.documents found: match_documents_scoped was not changed.';
    return;
  end if;
  select format_type(a.atttypid, a.atttypmod) into id_type from pg_attribute a
   where a.attrelid = 'public.documents'::regclass and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into emb_type from pg_attribute a
   where a.attrelid = 'public.documents'::regclass and a.attname = 'embedding' and not a.attisdropped;
  select n.nspname into vec_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'vector';
  execute format($f$
    create or replace function public.match_documents_scoped(
      query_embedding %1$s, match_count int default 10, filter jsonb default '{}'::jsonb)
    returns table (id %2$s, content text, metadata jsonb, similarity double precision)
    language sql stable security definer set search_path = ''
    as $body$
      select d.id, d.content, d.metadata,
             (1 - (d.embedding operator(%3$I.<=>) query_embedding))::double precision
      from public.documents d
      where (
        -- employees who may read every document
        lower(coalesce(filter->>'all_access', '')) = 'true'
        or (
          nullif(filter->>'department', '') is not null
          and (
            -- written for the employee's own position
            (nullif(filter->>'position', '') is not null
             and public.norm_text(d.metadata->>'position') = public.norm_text(filter->>'position'))
            -- or for every position of the employee's department, or the whole hotel
            or (public.norm_text(d.metadata->>'position') = ''
                and (public.norm_dept(d.metadata->>'department') = public.norm_dept(filter->>'department')
                     or public.norm_text(d.metadata->>'department') in ('all', 'company', 'all departments')))
            -- department heads: every document of their own department, whatever the position
            or (lower(coalesce(filter->>'head', '')) = 'true'
                and public.norm_dept(d.metadata->>'department') = public.norm_dept(filter->>'department'))
          )
        )
      )
      order by d.embedding operator(%3$I.<=>) query_embedding
      limit coalesce(match_count, 10)
    $body$
  $f$, emb_type, id_type, vec_schema);
  execute format('revoke all on function public.match_documents_scoped(%s, int, jsonb) from public, anon, authenticated', emb_type);
  execute format('grant execute on function public.match_documents_scoped(%s, int, jsonb) to service_role', emb_type);
end $$;

-- 3) The original-file list (LINE "send me the full file"): same extra way in.
--    The old 3-argument version is replaced by one with a 4th argument that
--    defaults to false, so the current Edge Function keeps working until it is redeployed.
drop function if exists public.accessible_documents(text, text, boolean);

create or replace function public.accessible_documents(
  p_department text,
  p_position text,
  p_head boolean default false,
  p_all_access boolean default false
)
returns table (
  id uuid,
  document_name text,
  original_filename text,
  file_url text,
  file_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.document_name, d.original_filename, d.file_url, d.file_type
  from public.document_files d
  where d.processing_status = 'ready'
    and coalesce(d.document_type, '') <> 'Admin Reply'
    and d.file_url is not null
    and (
      -- employees who may read every document
      coalesce(p_all_access, false)
      or (
        nullif(p_department, '') is not null
        and (
          -- written for the employee's own position
          (nullif(p_position, '') is not null
           and public.norm_text(d.position) = public.norm_text(p_position))
          -- or for every position of the employee's department, or the whole hotel
          or (public.norm_text(d.position) = ''
              and (public.norm_dept(d.department) = public.norm_dept(p_department)
                   or public.norm_text(d.department) in ('all', 'company', 'all departments')))
          -- department heads: every document of their own department
          or (coalesce(p_head, false)
              and public.norm_dept(d.department) = public.norm_dept(p_department))
        )
      )
    );
$$;

revoke all on function public.accessible_documents(text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.accessible_documents(text, text, boolean, boolean)
  to service_role;

commit;

-- ---------------------------------------------------------------------------
-- You can also turn the switch on / off by hand (Supabase SQL editor, one person at a time):
--
--   update public.users set can_access_all_documents = true  where employee_id = '<employee id>';
--   update public.users set can_access_all_documents = false where employee_id = '<employee id>';
--
-- See who has it:
--   select employee_id, first_name, last_name, department, "position"
--   from public.users where can_access_all_documents;
-- ---------------------------------------------------------------------------
