-- 005_reply_thread.sql
-- Run once in Supabase > SQL Editor (after 004). Safe to re-run.
-- Adds a reply thread per conversation (many replies, with images/files).
begin;

create table if not exists public.chat_replies (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chat_logs(id) on delete cascade,
  admin_id uuid references public.admins(id) on delete set null,
  admin_name text not null,
  message text not null default '',
  -- [{ name, kind: 'image'|'file', mime, size, path, preview_path }]
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_replies_chat_idx
  on public.chat_replies (chat_id, created_at);

alter table public.chat_replies enable row level security;
revoke all on public.chat_replies from anon;
grant select, insert on public.chat_replies to authenticated;
drop policy if exists "Members read replies" on public.chat_replies;
drop policy if exists "Members add replies" on public.chat_replies;
create policy "Members read replies" on public.chat_replies
  for select to authenticated using ((select public.is_workspace_member()));
create policy "Members add replies" on public.chat_replies
  for insert to authenticated with check ((select public.is_workspace_member()));

-- Private bucket for reply attachments (20 MB per object).
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "Members read chat attachments" on storage.objects;
drop policy if exists "Members upload chat attachments" on storage.objects;
drop policy if exists "Members delete chat attachments" on storage.objects;
create policy "Members read chat attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments' and (select public.is_workspace_member()));
create policy "Members upload chat attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments' and (select public.is_workspace_member()));
create policy "Members delete chat attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-attachments' and (select public.is_workspace_member()));

commit;
