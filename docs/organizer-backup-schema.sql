-- Reference: migration organizer_account_backups applied to svoya-ai.
create table public.organizer_backups (
 user_id uuid primary key references auth.users(id) on delete cascade,
 state jsonb not null,
 revision bigint not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 constraint organizer_backup_format check (
 jsonb_typeof(state) = 'object' and state ? 'version' and state ? 'tasks'
 and state->>'version' = '1'
 and case when jsonb_typeof(state->'tasks') = 'array' then jsonb_array_length(state->'tasks') <= 200 else false end
 and octet_length(state::text) <= 2097152)
);
alter table public.organizer_backups enable row level security;
revoke all on public.organizer_backups from anon, authenticated;
grant select, insert, update on public.organizer_backups to authenticated;
create policy organizer_backup_read on public.organizer_backups for select to authenticated using ((select auth.uid()) = user_id);
create policy organizer_backup_create on public.organizer_backups for insert to authenticated with check ((select auth.uid()) = user_id);
create policy organizer_backup_update on public.organizer_backups for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create function public.organizer_backup_revision() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP = 'INSERT' then NEW.revision := 1; else NEW.revision := OLD.revision + 1; end if;
 NEW.updated_at := now();
 return NEW;
end;
$$;
revoke all on function public.organizer_backup_revision() from public, anon, authenticated;
create trigger organizer_backup_revision before insert or update on public.organizer_backups for each row execute function public.organizer_backup_revision();
