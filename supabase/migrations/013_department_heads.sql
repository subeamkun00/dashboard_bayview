-- 013_department_heads.sql
-- Documents can be shared with the whole hotel, one department, or one position
-- (set on the Documents page). Employees marked "Department head" can also get
-- answers from every document of their own department, whatever the position.
-- Needs 008 and 010. Safe to re-run; nothing is deleted.
begin;

do $$ begin
  if to_regprocedure('public.norm_dept(text)') is null then
    raise exception 'Run 008_employee_invites_and_claim.sql first. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'document_files' and column_name = 'position') then
    raise exception 'Run 010_document_positions.sql first. Nothing was changed.';
  end if;
end $$;

alter table public.users add column if not exists is_department_head boolean not null default false;
grant update (is_department_head) on public.users to authenticated;
grant insert (is_department_head) on public.users to authenticated;

-- 5) The search the AI uses (n8n: Supabase Vector Store -> Query Name).
--    Built for the real column types of your documents table.
do $$
declare
  id_type text; emb_type text; vec_schema text;
begin
  if to_regclass('public.documents') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'documents' and column_name = 'embedding') then
    raise notice 'No vector table public.documents found: match_documents_scoped was not created.';
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
      where nullif(filter->>'department', '') is not null
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
      order by d.embedding operator(%3$I.<=>) query_embedding
      limit coalesce(match_count, 10)
    $body$
  $f$, emb_type, id_type, vec_schema);
  execute format('revoke all on function public.match_documents_scoped(%s, int, jsonb) from public, anon, authenticated', emb_type);
  execute format('grant execute on function public.match_documents_scoped(%s, int, jsonb) to service_role', emb_type);
end $$;


commit;
