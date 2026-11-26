-- 019_contact_threads.sql
-- Keep a "ติดต่อแอดมิน" conversation together, like a LINE chat.
--
-- Before: every LINE message sent while the employee was in contact mode became
-- its own chat_logs row (its own "question" in the dashboard).
-- Now: the first row (created by the "ติดต่อแอดมิน" button) is the thread head.
-- Later messages from the same employee are still inserted by the n8n workflow
-- (node "Save Contact Message") exactly as before, but a trigger stamps them
-- with thread_id = head.id. The dashboard hides those rows from the Questions
-- list and shows them inside the head's "Conversation details" instead.
--
-- No n8n change is needed. Safe to re-run.
begin;

alter table public.chat_logs
  add column if not exists thread_id uuid references public.chat_logs(id) on delete cascade,
  add column if not exists last_message_at timestamptz;

create index if not exists chat_logs_thread_idx
  on public.chat_logs (thread_id, created_at)
  where thread_id is not null;

create or replace function public.attach_contact_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  head_id uuid;
begin
  -- Only contact messages that are not already part of a thread.
  if new.category is distinct from 'Contact' or new.thread_id is not null then
    return new;
  end if;
  -- A follow-up is a message saved while the employee is in contact mode.
  -- (The very first "ติดต่อแอดมิน" row is inserted before contact mode starts,
  -- so it stays a thread head.)
  if not exists (
    select 1
    from public.users u
    where u.id = new.user_id
      and u.contact_mode_until is not null
      and u.contact_mode_until > now()
  ) then
    return new;
  end if;
  -- The thread head is this employee's latest contact conversation.
  select c.id
    into head_id
  from public.chat_logs c
  where c.user_id = new.user_id
    and c.category = 'Contact'
    and c.thread_id is null
  order by c.created_at desc
  limit 1;
  if head_id is null then
    return new;
  end if;

  new.thread_id := head_id;
  -- Put the conversation back in the "needs a reply" state and note activity,
  -- so admins notice it and an open conversation window refreshes itself.
  update public.chat_logs
     set last_message_at = now(),
         response_status = case
           when response_status = 'replied' then 'fallback'
           else response_status
         end
   where id = head_id;
  return new;
end;
$$;

drop trigger if exists chat_logs_attach_contact_followup on public.chat_logs;
create trigger chat_logs_attach_contact_followup
  before insert on public.chat_logs
  for each row execute function public.attach_contact_followup();

commit;
