-- Run once in the Supabase SQL editor or with `supabase db push`.
create extension if not exists vector with schema extensions;

create table public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default 'Administrator',
  role text not null default 'training' check (role in ('admin', 'hr', 'it', 'training')),
  created_at timestamptz not null default now()
);
create table public.users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null,
  profile_image_url text,
  department text not null default 'Team member',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  document_name text not null,
  document_type text not null check (document_type in ('SOP', 'Job Description', 'Internal Policy', 'Training')),
  file_url text not null,
  processing_status text not null default 'processing' check (processing_status in ('ready', 'processing', 'failed')),
  uploaded_at timestamptz not null default now(),
  file_size bigint not null default 0 check (file_size >= 0),
  embeddings_count integer not null default 0 check (embeddings_count >= 0)
);
create table public.chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  question text not null,
  ai_response text not null default '',
  source_document text not null default '',
  response_status text not null check (response_status in ('success', 'failed')),
  category text not null default 'General',
  created_at timestamptz not null default now()
);
-- Dimension is configured by the ingestion workflow. Keep it consistent with
-- your chosen embedding model; this table does not assume a specific model size.
create table public.document_embeddings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  content text not null,
  embedding extensions.vector,
  metadata jsonb not null default '{}'::jsonb
);
create table public.system_settings (
  id integer primary key default 1 check (id = 1),
  hotel_name text not null default 'Bayview Hotel',
  response_language text not null default 'Match the employee’s language',
  retrieval_limit integer not null default 5 check (retrieval_limit between 1 and 20)
);
insert into public.system_settings (id) values (1);
create index chat_logs_user_created_idx on public.chat_logs(user_id, created_at desc);
create index chat_logs_created_idx on public.chat_logs(created_at desc);
create index users_last_seen_idx on public.users(last_seen desc);
create index embeddings_document_idx on public.document_embeddings(document_id);

-- SECURITY DEFINER avoids recursive policies on admins. Fix the search path,
-- expose only a boolean, and scope all decisions to the verified auth user.
create function public.is_workspace_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admins where id = (select auth.uid())); $$;
create function public.is_workspace_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admins where id = (select auth.uid()) and role = 'admin'); $$;
revoke all on function public.is_workspace_member() from public;
revoke all on function public.is_workspace_admin() from public;
grant execute on function public.is_workspace_member() to authenticated;
grant execute on function public.is_workspace_admin() to authenticated;

alter table public.admins enable row level security;
alter table public.users enable row level security;
alter table public.chat_logs enable row level security;
alter table public.documents enable row level security;
alter table public.document_embeddings enable row level security;
alter table public.system_settings enable row level security;
create policy "Members read admins" on public.admins for select to authenticated using ((select public.is_workspace_member()));
create policy "Members edit self or admins edit roles" on public.admins for update to authenticated
  using (id = (select auth.uid()) or (select public.is_workspace_admin()))
  with check (id = (select auth.uid()) or (select public.is_workspace_admin()));
-- Defense in depth: prevent profile updates from escalating privileges through
-- direct Data API calls, and prevent users changing their own authorization.
create function public.protect_admin_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Administrator identity cannot be changed';
  end if;
  if new.role is distinct from old.role then
    if not public.is_workspace_admin() or old.id = auth.uid() then
      raise exception 'Not authorized to change this role';
    end if;
  end if;
  return new;
end; $$;
create trigger protect_admin_update before update on public.admins for each row execute function public.protect_admin_identity();
create policy "Members read users" on public.users for select to authenticated using ((select public.is_workspace_member()));
create policy "Members read chats" on public.chat_logs for select to authenticated using ((select public.is_workspace_member()));
create policy "Members manage documents" on public.documents for all to authenticated using ((select public.is_workspace_member())) with check ((select public.is_workspace_member()));
create policy "Members read embeddings" on public.document_embeddings for select to authenticated using ((select public.is_workspace_member()));
create policy "Members read configuration" on public.system_settings for select to authenticated using ((select public.is_workspace_member()));
create policy "Admins update configuration" on public.system_settings for update to authenticated using ((select public.is_workspace_admin())) with check ((select public.is_workspace_admin()));

-- No browser policies for inserting/deleting admins or writing employee/chat
-- data. The trusted n8n backend handles ingestion using its server credentials.
revoke all on public.admins, public.users, public.chat_logs, public.documents, public.document_embeddings, public.system_settings from anon;
grant select, update on public.admins to authenticated;
grant select on public.users, public.chat_logs, public.document_embeddings to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, update on public.system_settings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-base', 'knowledge-base', false, 20971520,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'])
on conflict (id) do nothing;
create policy "Members read knowledge files" on storage.objects for select to authenticated using (bucket_id = 'knowledge-base' and (select public.is_workspace_member()));
create policy "Members upload knowledge files" on storage.objects for insert to authenticated with check (bucket_id = 'knowledge-base' and (select public.is_workspace_member()));
create policy "Members delete knowledge files" on storage.objects for delete to authenticated using (bucket_id = 'knowledge-base' and (select public.is_workspace_member()));

-- Enable change notifications consumed by the dashboard. New Supabase projects
-- include this publication; create it if needed for other Postgres installs.
do $$ begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.users, public.chat_logs, public.documents, public.admins;
