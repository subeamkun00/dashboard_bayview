-- 016_chat_images.sql
-- Images the LINE assistant can attach to an answer (e.g. a folding diagram).
-- Admins upload them from the dashboard page "Chat Images"; the n8n reply step
-- reads public.chat_images and sends matching images after the text answer.
-- Images are served from a PUBLIC bucket because LINE must be able to download them
-- without signing in, so never upload anything confidential. Safe to re-run.

-- LINE preview images must be <= 1 MB, so the bucket limit is 1 MB (JPEG/PNG only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('line-images', 'line-images', true, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg', 'image/png'];

drop policy if exists "Members upload chat images" on storage.objects;
drop policy if exists "Members delete chat images" on storage.objects;
create policy "Members upload chat images" on storage.objects for insert to authenticated
  with check (bucket_id = 'line-images' and (select public.is_workspace_member()));
create policy "Members delete chat images" on storage.objects for delete to authenticated
  using (bucket_id = 'line-images' and (select public.is_workspace_member()));

create table if not exists public.chat_images (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  keywords text not null check (char_length(keywords) between 1 and 500),
  file_path text not null unique,
  image_url text not null,
  is_active boolean not null default true,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.chat_images enable row level security;
drop policy if exists "Members manage chat images" on public.chat_images;
create policy "Members manage chat images" on public.chat_images for all to authenticated
  using ((select public.is_workspace_member()))
  with check ((select public.is_workspace_member()));
revoke all on public.chat_images from anon;
grant select, insert, update, delete on public.chat_images to authenticated;
